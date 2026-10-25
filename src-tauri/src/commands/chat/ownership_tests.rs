use super::*;
use qa_scribe_core::services::SessionService;
use tauri::Manager;

#[test]
fn conversation_adapters_keep_notes_separate_and_enforce_boundary_guards() {
    let service = SessionService::in_memory().unwrap();
    let session = service
        .create_session(SessionDraft {
            title: "Command ownership".into(),
            ..Default::default()
        })
        .unwrap();
    let finding = service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Finding".into(),
            body: "Body".into(),
            body_json: None,
            body_format: None,
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .unwrap();
    let note = service.get_or_create_note_entry(&session.id).unwrap();
    let root = std::env::temp_dir().join(format!("qa-ownership-adapter-{}", uuid::Uuid::new_v4()));
    let app = tauri::test::mock_app();
    app.manage(AppState::new(service, root));
    let notes = get_chat(app.state(), session.id.clone()).unwrap();
    let request = BeginRecordChatRequest {
        session_id: session.id.clone(),
        draft_id: uuid::Uuid::new_v4().to_string(),
        record: ConversationRecord::Finding {
            record_id: finding.id,
        },
    };
    let record = begin_record_chat(app.state(), request.clone()).unwrap();
    let reference = ChatRef {
        session_id: session.id.clone(),
        draft_id: record.draft_id.clone(),
    };
    assert_eq!(
        get_conversation(app.state(), reference.clone()).unwrap(),
        record
    );
    assert_eq!(begin_record_chat(app.state(), request).unwrap(), record);
    let active = activate_conversation(app.state(), reference.clone()).unwrap();
    assert!(active.last_active_order > record.last_active_order);
    assert_eq!(active.revision, 0);
    assert_eq!(get_chat(app.state(), session.id.clone()).unwrap(), notes);
    let history = list_chat_history(
        app.state(),
        ChatHistoryScope::Session {
            session_id: session.id.clone(),
        },
    )
    .unwrap();
    assert_eq!(
        history
            .iter()
            .map(|h| h.reference.draft_id.as_str())
            .collect::<Vec<_>>(),
        vec![record.draft_id.as_str(), notes.draft_id.as_str()]
    );
    let scope = ChatRevision {
        session_id: session.id,
        draft_id: record.draft_id,
        expected_revision: 0,
    };
    assert!(
        restart_chat(
            app.state(),
            ChatRestartRequest {
                scope: scope.clone()
            }
        )
        .is_err()
    );
    assert!(
        submit_chat(
            app.state(),
            ChatSubmitRequest {
                scope,
                note_id: note.id,
                expected_note_body: note.body,
                expected_note_body_json: note.body_json,
                expected_note_body_format: note.body_format
            }
        )
        .is_err()
    );
    assert!(
        get_conversation(
            app.state(),
            ChatRef {
                session_id: "wrong-session".into(),
                ..reference
            }
        )
        .is_err()
    );
}
