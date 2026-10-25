use base64::{Engine, engine::general_purpose::STANDARD};
use qa_scribe_core::{
    attachments::chat::import_chat_image_data_url, domain::*, services::SessionService,
    storage::Database,
};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy)]
pub enum Kind {
    Finding,
    TestCases,
}

#[derive(Clone, Copy)]
pub enum Terminal {
    Failed,
    Cancelled,
    Interrupted,
}

#[path = "support/record.rs"]
mod record;
#[path = "support/security.rs"]
mod security;
pub use record::Record;
pub use security::{forged_snapshot, replace_source};

pub fn session(service: &SessionService) -> String {
    service
        .create_session(SessionDraft {
            title: "Retry context boundary".into(),
            ..Default::default()
        })
        .unwrap()
        .id
}

pub fn scope(chat: &ChatState) -> ChatRevision {
    ChatRevision {
        session_id: chat.session_id.clone(),
        draft_id: chat.draft_id.clone(),
        expected_revision: chat.revision,
    }
}

pub fn compose(service: &SessionService, chat: &ChatState, composer: &str) -> ChatState {
    service
        .save_chat_composer(ChatComposerRequest {
            scope: scope(chat),
            composer: composer.into(),
            attachment_ids: chat
                .composer_images
                .iter()
                .map(|i| i.attachment_id.clone())
                .collect(),
            mode: ChatMode::Chat,
        })
        .unwrap()
}

pub fn attach_image(service: &SessionService, dir: &Path, chat: &ChatState) -> ChatState {
    let data = STANDARD.encode(include_bytes!(
        "../../../../e2e/fixtures/chat-image-pixels.png"
    ));
    import_chat_image_data_url(
        service,
        dir,
        scope(chat),
        "evidence.png".into(),
        &format!("data:image/png;base64,{data}"),
    )
    .unwrap()
}

pub struct Fixture {
    pub service: SessionService,
    pub chat: ChatState,
    pub record: Record,
    pub dir: PathBuf,
    pub old_run: AiRun,
}

impl Fixture {
    pub fn new(kind: Kind, terminal: Terminal) -> Self {
        let dir = std::env::temp_dir().join(format!("qa-retry-context-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("chat.sqlite");
        let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
        let id = session(&service);
        let record = Record::create(&service, &id, kind);
        let chat = service.load_chat(&id).unwrap();
        let chat = attach_image(&service, &dir, &chat);
        let chat = compose(&service, &chat, "Review the pinned evidence\n");
        let started = service
            .start_chat_turn_with_response(
                ChatStartRequest {
                    scope: scope(&chat),
                },
                record.target(),
                ChatRequestIntent::RefineRecord,
            )
            .unwrap();
        let run = service
            .create_ai_run(AiRunCreate {
                session_id: id.clone(),
                generation_context_id: None,
                provider: AiProvider::CodexCli,
                model: "gpt-6.1".into(),
                reasoning_effort: None,
                prompt_version: "retry-context-test".into(),
            })
            .unwrap();
        let associated = service
            .associate_chat_turn_ai_run(ChatAssociateRunRequest {
                scope: scope(&started.chat),
                turn_id: started.turn_id.clone(),
                ai_run_id: run.id.clone(),
            })
            .unwrap();
        let (service, chat) = match terminal {
            Terminal::Interrupted => {
                drop(service);
                let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
                let chat = service.load_chat(&id).unwrap();
                assert_eq!(chat.messages[0].status, ChatTurnStatus::Interrupted);
                (service, chat)
            }
            Terminal::Failed | Terminal::Cancelled => {
                let kind = match terminal {
                    Terminal::Failed => ChatFailureKind::Failed,
                    _ => ChatFailureKind::Cancelled,
                };
                let chat = service
                    .fail_chat_turn_with_ai_run(
                        ChatFailRequest {
                            scope: scope(&associated),
                            turn_id: started.turn_id,
                            kind,
                            error_message: "Synthetic stopped response".into(),
                        },
                        &run.id,
                    )
                    .unwrap();
                (service, chat)
            }
        };
        let old_run = service.get_ai_run(&run.id).unwrap().unwrap();
        Self {
            service,
            chat,
            record,
            dir,
            old_run,
        }
    }

    pub fn assert_retried(&self, chat: &ChatState, associated: bool) {
        assert_eq!(chat.messages.len(), 1);
        let mut expected = self.chat.messages[0].clone();
        assert_ne!(chat.messages[0].turn_id, expected.turn_id);
        expected.turn_id = chat.messages[0].turn_id.clone();
        expected.status = ChatTurnStatus::Running;
        expected.error_message = None;
        expected.ai_run_id = if associated {
            chat.messages[0].ai_run_id.clone()
        } else {
            None
        };
        assert_eq!(chat.messages[0], expected);
        assert_eq!(chat.composer, "");
        assert!(chat.composer_images.is_empty());
        assert_eq!(
            chat.revision,
            self.chat.revision + if associated { 2 } else { 1 }
        );
        assert_eq!(
            self.service.get_ai_run(&self.old_run.id).unwrap().unwrap(),
            self.old_run
        );
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

pub fn rows(service: &SessionService) -> Value {
    let connection = service.database().connection();
    let mut names = connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .unwrap();
    let names = names
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    let mut dump = serde_json::Map::new();
    for name in names {
        let mut statement = connection
            .prepare(&format!("SELECT * FROM \"{}\"", name.replace('"', "\"\"")))
            .unwrap();
        let columns = statement.column_count();
        let mut values = statement
            .query_map([], |r| {
                Ok((0..columns)
                    .map(|i| format!("{:?}", r.get_ref(i).unwrap()))
                    .collect::<Vec<_>>())
            })
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        values.sort();
        dump.insert(name, json!(values));
    }
    Value::Object(dump)
}

pub fn pinned_rows(service: &SessionService) -> Value {
    let all = rows(service);
    json!({"contexts":all["chat_message_contexts"],"contracts":all["chat_response_contracts"],"images":all["chat_message_images"],"answers":all["chat_answers"]})
}
