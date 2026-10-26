use qa_scribe_core::{domain::*, services::SessionService, storage::Database};

#[path = "chat_conversation_ownership/activity.rs"]
mod activity;
#[path = "chat_conversation_ownership/assistance.rs"]
mod assistance;
#[path = "chat_conversation_ownership/migration.rs"]
mod migration;
#[path = "chat_conversation_ownership/operations.rs"]
mod operations;
#[path = "chat_conversation_ownership/protections.rs"]
mod protections;

fn session(service: &SessionService) -> String {
    service
        .create_session(SessionDraft {
            title: "Ownership".into(),
            ..Default::default()
        })
        .unwrap()
        .id
}
fn reference(chat: &ChatState) -> ChatRef {
    ChatRef {
        session_id: chat.session_id.clone(),
        draft_id: chat.draft_id.clone(),
    }
}
fn scope(chat: &ChatState) -> ChatRevision {
    ChatRevision {
        session_id: chat.session_id.clone(),
        draft_id: chat.draft_id.clone(),
        expected_revision: chat.revision,
    }
}
fn composer(chat: &ChatState, text: &str, intent: ChatComposerIntent) -> ChatComposerRequest {
    ChatComposerRequest {
        scope: scope(chat),
        composer: text.into(),
        mode: chat.mode,
        attachment_ids: chat
            .composer_images
            .iter()
            .map(|i| i.attachment_id.clone())
            .collect(),
        intent,
    }
}
fn finding(service: &SessionService, session_id: &str) -> ConversationRecord {
    let record = service
        .create_finding(FindingDraft {
            session_id: session_id.into(),
            title: "Synthetic finding".into(),
            body: "<p>Original</p>".into(),
            body_json: None,
            body_format: None,
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .unwrap();
    ConversationRecord::Finding {
        record_id: record.id,
    }
}
fn launch(session_id: &str, record: &ConversationRecord) -> BeginRecordChatRequest {
    BeginRecordChatRequest {
        session_id: session_id.into(),
        draft_id: uuid::Uuid::new_v4().to_string(),
        record: record.clone(),
    }
}
fn owned_context(chat: &ChatState) -> ChatTarget {
    let ConversationOwner::Record { session_id, record } = &chat.owner else {
        return ChatTarget::Session;
    };
    let (record_id, title, record_kind) = match record {
        ConversationRecord::Finding { record_id } => (record_id, "Synthetic finding", "bug"),
        ConversationRecord::TestCasesDraft { record_id } => {
            (record_id, "Synthetic test cases", "testware")
        }
    };
    let snapshot = RecordContextSnapshot {
        session_id: session_id.clone(),
        record_id: record_id.clone(),
        title: title.into(),
        document_json: serde_json::json!({"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Original"}]}]}}).to_string(),
        metadata_json: None,
        record_kind: record_kind.into(),
        origin: RecordSnapshotOrigin::Saved,
        local_fingerprint: String::new(),
        stored_base_token: String::new(),
    };
    match record {
        ConversationRecord::Finding { .. } => ChatTarget::Finding { snapshot },
        ConversationRecord::TestCasesDraft { .. } => ChatTarget::TestCasesDraft { snapshot },
    }
}
fn complete(service: &SessionService, chat: &ChatState) -> ChatState {
    let chat = service
        .save_chat_composer(composer(chat, "Question", ChatComposerIntent::Message))
        .unwrap();
    let started = service
        .start_chat_turn_with_context(
            ChatStartRequest {
                scope: scope(&chat),
            },
            owned_context(&chat),
        )
        .unwrap();
    service
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            assistant_text: "Answer".into(),
        })
        .unwrap()
}
fn submit(chat: &ChatState, note: &Entry) -> ChatSubmitRequest {
    ChatSubmitRequest {
        scope: scope(chat),
        note_id: note.id.clone(),
        expected_note_body: note.body.clone(),
        expected_note_body_json: note.body_json.clone(),
        expected_note_body_format: note.body_format.clone(),
    }
}
fn frozen_service() -> (std::path::PathBuf, SessionService) {
    let dir = std::env::temp_dir().join(format!("qa-scribe-ownership-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("qa-scribe.sqlite");
    std::fs::write(&path, include_bytes!("fixtures/ask-ai-schema18/v18.sqlite")).unwrap();
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    (dir, service)
}

#[test]
fn equal_composer_save_is_a_content_and_activity_noop() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let chat = service.load_chat(&id).unwrap();
    let saved = service
        .save_chat_composer(composer(&chat, "", ChatComposerIntent::Message))
        .unwrap();
    assert_eq!(saved, chat);
    let edited = service
        .save_chat_composer(composer(&saved, "Authored", ChatComposerIntent::Message))
        .unwrap();
    assert_eq!(edited.revision, 1);
    assert!(edited.last_active_order > saved.last_active_order);
    assert_eq!(
        service
            .save_chat_composer(composer(&edited, "Authored", ChatComposerIntent::Message))
            .unwrap(),
        edited
    );
}
