use qa_scribe_core::{
    QaScribeError,
    domain::{
        ChatComposerRequest, ChatFailRequest, ChatFailureKind, ChatFinishRequest, ChatMode,
        ChatRestartRequest, ChatRevision, ChatRole, ChatStartRequest, ChatState, ChatSubmitRequest,
        ChatTurnStatus, Entry, EntryPatch, SessionDraft,
    },
    services::SessionService,
    storage::{Database, SCHEMA_VERSION},
};
use serde_json::{Value, json};

#[path = "session_storage/helpers.rs"]
mod helpers;

#[path = "chat_storage/boundaries.rs"]
mod boundaries;
#[path = "chat_storage/image_limits.rs"]
mod image_limits;
#[path = "chat_storage/image_migration.rs"]
mod image_migration;
#[path = "chat_storage/images.rs"]
mod images;
#[path = "chat_storage/lifecycle.rs"]
mod lifecycle;
#[path = "chat_storage/retry_and_ai_run.rs"]
mod retry_and_ai_run;
#[path = "chat_storage/submission.rs"]
mod submission;

fn session(service: &SessionService) -> String {
    service
        .create_session(SessionDraft {
            title: "Chat testing".into(),
            ..Default::default()
        })
        .unwrap()
        .id
}

fn scope(chat: &ChatState) -> ChatRevision {
    ChatRevision {
        session_id: chat.session_id.clone(),
        draft_id: chat.draft_id.clone(),
        expected_revision: chat.revision,
    }
}

fn save(service: &SessionService, chat: &ChatState, text: &str) -> ChatState {
    service
        .save_chat_composer(ChatComposerRequest {
            attachment_ids: vec![],
            scope: scope(chat),
            composer: text.into(),
            mode: ChatMode::Chat,
        })
        .unwrap()
}

fn complete(service: &SessionService, chat: &ChatState, user: &str, assistant: &str) -> ChatState {
    let saved = save(service, chat, user);
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&saved),
        })
        .unwrap();
    service
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            assistant_text: assistant.into(),
        })
        .unwrap()
}

fn submit_request(chat: &ChatState, note: &Entry) -> ChatSubmitRequest {
    ChatSubmitRequest {
        scope: scope(chat),
        note_id: note.id.clone(),
        expected_note_body: note.body.clone(),
        expected_note_body_json: note.body_json.clone(),
        expected_note_body_format: note.body_format.clone(),
    }
}

fn validation<T: std::fmt::Debug>(result: qa_scribe_core::Result<T>) {
    assert!(
        matches!(result, Err(QaScribeError::Validation(_))),
        "{result:?}"
    );
}

#[test]
fn version_nine_upgrade_preserves_note_and_adds_session_owned_chat_tables() {
    let dir = helpers::unique_temp_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("chat.sqlite");
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let id = session(&service);
    let note = service.get_or_create_note_entry(&id).unwrap();
    let note = service
        .update_entry(
            &note.id,
            EntryPatch {
                body: Some("<p>Keep this Note</p>".into()),
                ..Default::default()
            },
        )
        .unwrap();
    service.database().connection().execute_batch(
        "DROP TABLE IF EXISTS chat_composer_images; DROP TABLE IF EXISTS chat_message_images; DROP TRIGGER IF EXISTS chat_image_attachment_immutable; DROP TABLE IF EXISTS chat_messages; DROP TABLE IF EXISTS chat_drafts; PRAGMA user_version = 9;"
    ).unwrap();
    drop(service);
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    assert_eq!(SCHEMA_VERSION, 14);
    let version: i32 = service
        .database()
        .connection()
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, 14);
    assert_eq!(service.get_or_create_note_entry(&id).unwrap(), note);
    let chat = service.load_chat(&id).unwrap();
    let chat = complete(&service, &chat, "Question", "Answer");
    assert_eq!(chat.messages.len(), 2);
    service.delete_session(&id).unwrap();
    assert_eq!(
        helpers::count_rows(service.database().connection(), "chat_drafts"),
        0
    );
    assert_eq!(
        helpers::count_rows(service.database().connection(), "chat_messages"),
        0
    );
    helpers::assert_no_foreign_key_violations(service.database().connection());
    drop(service);
    std::fs::remove_dir_all(dir).unwrap();
}
