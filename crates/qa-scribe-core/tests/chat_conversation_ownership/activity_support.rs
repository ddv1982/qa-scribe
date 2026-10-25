use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use qa_scribe_core::attachments::chat::import_chat_image_data_url;
use serde_json::json;

#[derive(Clone, Copy, Debug)]
pub(super) enum Kind {
    Finding,
    TestCases,
}
impl Kind {
    pub(super) const ALL: [Self; 2] = [Self::Finding, Self::TestCases];
    fn create(self, service: &SessionService, id: &str) -> ConversationRecord {
        match self {
            Self::Finding => finding(service, id),
            Self::TestCases => ConversationRecord::TestCasesDraft {
                record_id: service
                    .create_draft(DraftCreate {
                        session_id: id.into(),
                        ai_run_id: None,
                        kind: DraftKind::Testware,
                        title: "Synthetic test cases".into(),
                        body: "<p>Original</p>".into(),
                        body_json: None,
                        body_format: None,
                        metadata_json: None,
                    })
                    .unwrap()
                    .id,
            },
        }
    }
    pub(super) fn target(self, id: &str, record: &ConversationRecord) -> ChatTarget {
        let (record_id, kind, title) = match record {
            ConversationRecord::Finding { record_id } => (record_id, "bug", "Synthetic finding"),
            ConversationRecord::TestCasesDraft { record_id } => {
                (record_id, "testware", "Synthetic test cases")
            }
        };
        let snapshot = RecordContextSnapshot { session_id: id.into(), record_id: record_id.clone(), title: title.into(),
            document_json: json!({"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Original"}]}]}}).to_string(),
            metadata_json: None, record_kind: kind.into(), origin: RecordSnapshotOrigin::Saved, local_fingerprint: String::new(), stored_base_token: String::new() };
        match self {
            Self::Finding => ChatTarget::Finding { snapshot },
            Self::TestCases => ChatTarget::TestCasesDraft { snapshot },
        }
    }
    pub(super) fn patch_kind(self) -> &'static str {
        match self {
            Self::Finding => "finding",
            Self::TestCases => "test_cases_draft",
        }
    }
}

pub(super) struct TempRoot(pub std::path::PathBuf);
impl Drop for TempRoot {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

pub(super) struct Fixture {
    pub service: SessionService,
    pub id: String,
    pub record: ConversationRecord,
    pub a: ChatState,
    pub b: ChatState,
    pub root: TempRoot,
}
impl Fixture {
    pub(super) fn new(kind: Kind) -> Self {
        let root = TempRoot(
            std::env::temp_dir().join(format!("qa-scribe-activity-{}", uuid::Uuid::new_v4())),
        );
        std::fs::create_dir(&root.0).unwrap();
        let service =
            SessionService::new(Database::open(root.0.join("activity.sqlite")).unwrap()).unwrap();
        let id = session(&service);
        let record = kind.create(&service, &id);
        let a = service.begin_record_chat(launch(&id, &record)).unwrap();
        let b = service.begin_record_chat(launch(&id, &record)).unwrap();
        Self {
            service,
            id,
            record,
            a,
            b,
            root,
        }
    }
    pub(super) fn read(&self, chat: &ChatState) -> ChatState {
        self.service.read_chat(&reference(chat)).unwrap()
    }
    pub(super) fn save(&self, chat: &ChatState, text: &str) -> ChatState {
        self.service
            .save_chat_composer(composer(chat, text, chat.composer_intent))
            .unwrap()
    }
    pub(super) fn other(&self) -> ChatState {
        let b = self.read(&self.b);
        self.save(&b, &format!("Other input {}", b.revision + 1))
    }
    pub(super) fn history(&self, ids: [&str; 2], orders: [i64; 2]) {
        let entries = self
            .service
            .list_chat_history(ChatHistoryScope::Record {
                session_id: self.id.clone(),
                record: self.record.clone(),
            })
            .unwrap();
        assert_eq!(
            entries
                .iter()
                .map(|e| e.reference.draft_id.as_str())
                .collect::<Vec<_>>(),
            ids
        );
        assert_eq!(
            entries
                .iter()
                .map(|e| e.last_active_order)
                .collect::<Vec<_>>(),
            orders
        );
    }
    pub(super) fn import(&self, chat: &ChatState) -> qa_scribe_core::Result<ChatState> {
        import_chat_image_data_url(
            &self.service,
            &self.root.0,
            scope(chat),
            "activity.png".into(),
            &image_url(),
        )
    }
    pub(super) fn failed(&self) -> ChatState {
        let chat = self.save(&self.read(&self.a), "Retry this literal question");
        let started = self
            .service
            .start_chat_turn(ChatStartRequest {
                scope: scope(&chat),
            })
            .unwrap();
        self.service
            .fail_chat_turn(ChatFailRequest {
                scope: scope(&started.chat),
                turn_id: started.turn_id,
                kind: ChatFailureKind::Failed,
                error_message: "Synthetic failure".into(),
            })
            .unwrap()
    }
    pub(super) fn offered(&self, kind: Kind) -> ChatState {
        let chat = self.save(&self.a, "Refine this record");
        let started = self
            .service
            .start_chat_turn_with_response(
                ChatStartRequest {
                    scope: scope(&chat),
                },
                kind.target(&self.id, &self.record),
                ChatRequestIntent::RefineRecord,
            )
            .unwrap();
        let contract = self
            .service
            .response_contract(&started.chat.messages[0].id)
            .unwrap()
            .unwrap();
        let completed = self.service.finish_chat_turn(ChatFinishRequest { scope: scope(&started.chat), turn_id: started.turn_id,
            assistant_text: json!({"version":contract.version(),"requestId":contract.request_id(),"markdown":"Review this refinement.","refinement":{"kind":kind.patch_kind(),"title":"Refined title"}}).to_string(),
        }).unwrap();
        assert_eq!(completed.proposals.len(), 1);
        assert_eq!(completed.proposals[0].state, RefinementState::Offered);
        assert_eq!(activity(&completed), activity(&started.chat));
        completed
    }
    pub(super) fn action(
        &self,
        chat: &ChatState,
        action: RefinementAction,
    ) -> qa_scribe_core::Result<ChatState> {
        self.service.resolve_refinement(RefinementRequest {
            scope: scope(chat),
            proposal_id: chat.proposals[0].id.clone(),
            action,
        })
    }
    pub(super) fn fail_activity(&self) {
        self.service.database().connection().execute_batch("CREATE TRIGGER fail_activity BEFORE UPDATE OF last_active_order ON chat_drafts BEGIN SELECT RAISE(ABORT,'Injected activity failure'); END").unwrap();
    }
    pub(super) fn allow_activity(&self) {
        self.service
            .database()
            .connection()
            .execute_batch("DROP TRIGGER fail_activity")
            .unwrap();
    }
}
pub(super) fn activity(chat: &ChatState) -> (i64, &str) {
    (chat.last_active_order, &chat.last_active_at)
}
pub(super) fn image_url() -> String {
    format!(
        "data:image/png;base64,{}",
        STANDARD.encode(include_bytes!(
            "../../../../e2e/fixtures/chat-image-pixels.png"
        ))
    )
}
