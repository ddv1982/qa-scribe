use qa_scribe_core::{
    domain::*,
    services::SessionService,
    storage::{Database, SCHEMA_VERSION},
};
use serde_json::json;

fn session(service: &SessionService) -> String {
    service
        .create_session(SessionDraft {
            title: "Synthetic context Session".into(),
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
fn compose(service: &SessionService, chat: &ChatState) -> ChatState {
    service
        .save_chat_composer(ChatComposerRequest {
            intent: qa_scribe_core::domain::ChatComposerIntent::Message,
            scope: scope(chat),
            composer: "Review this record".into(),
            attachment_ids: vec![],
            mode: ChatMode::Chat,
        })
        .unwrap()
}
fn finding(service: &SessionService, session_id: &str) -> Finding {
    service
        .create_finding(FindingDraft {
            session_id: session_id.into(),
            title: "Saved checkout finding".into(),
            body: "<p>Saved evidence</p>".into(),
            body_json: None,
            body_format: None,
            kind: FindingKind::Bug,
            metadata_json: Some("{\"severity\":\"high\"}".into()),
        })
        .unwrap()
}
fn context(finding: &Finding, text: &str) -> ChatTarget {
    ChatTarget::Finding { snapshot: RecordContextSnapshot {
        session_id: finding.session_id.clone(), record_id: finding.id.clone(), title: "Locally edited checkout finding".into(),
        document_json: json!({"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":text}]}]}}).to_string(),
        metadata_json: finding.metadata_json.clone(), record_kind: "bug".into(), origin: RecordSnapshotOrigin::UnsavedEditor,
        local_fingerprint: "untrusted local fingerprint".into(), stored_base_token: "untrusted stored base".into(),
    }}
}
fn start(service: &SessionService, chat: &ChatState, context: ChatTarget) -> ChatTurnStarted {
    service
        .start_chat_turn_with_context(ChatStartRequest { scope: scope(chat) }, context)
        .unwrap()
}

#[test]
fn chat_context_retry_pins_original_message_and_unsaved_document_without_saving_record() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let finding = finding(&service, &id);
    let chat = compose(&service, &service.load_chat(&id).unwrap());
    let started = start(&service, &chat, context(&finding, "Unsaved evidence"));
    let original = &started.chat.messages[0];
    let snapshot = original.context.snapshot().unwrap();
    assert_eq!(snapshot.title, "Locally edited checkout finding");
    assert_eq!(snapshot.origin, RecordSnapshotOrigin::UnsavedEditor);
    assert_eq!(snapshot.local_fingerprint.len(), 64);
    assert_eq!(snapshot.stored_base_token.len(), 64);
    assert_ne!(snapshot.local_fingerprint, snapshot.stored_base_token);
    assert_eq!(service.list_findings(&id).unwrap(), vec![finding.clone()]);
    let failed = service
        .fail_chat_turn(ChatFailRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id.clone(),
            kind: ChatFailureKind::Failed,
            error_message: "Synthetic stopped response".into(),
        })
        .unwrap();
    service
        .update_finding(
            &finding.id,
            FindingPatch {
                title: Some("New saved title".into()),
                ..Default::default()
            },
            qa_scribe_core::domain::RecordWriteGuard::finding(&finding),
        )
        .unwrap()
        .into_saved()
        .unwrap();
    let retried = service
        .retry_chat_turn(ChatStartRequest {
            scope: scope(&failed),
        })
        .unwrap();
    assert_eq!(retried.chat.messages[0].id, original.id);
    assert_ne!(retried.turn_id, started.turn_id);
    assert_eq!(retried.chat.messages[0].context, original.context);
    assert_eq!(
        service.load_chat(&id).unwrap().messages[0].context,
        original.context
    );
    assert!(
        service
            .database()
            .connection()
            .execute(
                "UPDATE chat_message_contexts SET context_json = '{}' WHERE message_id = ?1",
                [&original.id]
            )
            .is_err()
    );
}

#[test]
fn chat_context_rejects_foreign_missing_wrong_kind_and_oversized_without_consuming_input() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let foreign_id = session(&service);
    let local = finding(&service, &id);
    let foreign = finding(&service, &foreign_id);
    let chat = compose(&service, &service.load_chat(&id).unwrap());
    let report = service
        .create_draft(DraftCreate {
            session_id: id.clone(),
            ai_run_id: None,
            kind: DraftKind::SessionReport,
            title: "Report".into(),
            body: "Report".into(),
            body_json: None,
            body_format: None,
            metadata_json: None,
        })
        .unwrap();
    let mut missing = context(&local, "Evidence");
    if let ChatTarget::Finding { snapshot } = &mut missing {
        snapshot.record_id = "missing".into();
    }
    let mut report_snapshot = context(&local, "Evidence").snapshot().unwrap().clone();
    report_snapshot.record_id = report.id;
    report_snapshot.record_kind = "testware".into();
    for invalid in [
        context(&foreign, "Foreign evidence"),
        missing,
        ChatTarget::TestCasesDraft {
            snapshot: report_snapshot,
        },
        context(&local, &"x".repeat(33 * 1024)),
    ] {
        assert!(
            service
                .start_chat_turn_with_context(
                    ChatStartRequest {
                        scope: scope(&chat)
                    },
                    invalid
                )
                .is_err()
        );
        assert_eq!(service.load_chat(&id).unwrap(), chat);
    }
}

#[test]
fn chat_context_aggregate_limit_retains_composer_and_completed_history() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let record = finding(&service, &id);
    let mut chat = service.load_chat(&id).unwrap();
    for _ in 0..4 {
        chat = compose(&service, &chat);
        let started = start(&service, &chat, context(&record, &"x".repeat(28 * 1024)));
        chat = service
            .finish_chat_turn(ChatFinishRequest {
                scope: scope(&started.chat),
                turn_id: started.turn_id,
                assistant_text: "Synthetic review".into(),
            })
            .unwrap();
    }
    chat = compose(&service, &chat);
    let error = service
        .start_chat_turn_with_context(
            ChatStartRequest {
                scope: scope(&chat),
            },
            context(&record, &"x".repeat(28 * 1024)),
        )
        .unwrap_err();
    assert!(error.to_string().contains("128 KiB"));
    assert_eq!(service.load_chat(&id).unwrap(), chat);
}

#[test]
fn chat_context_survives_source_deletion_and_schema15_migrates_old_messages_to_session() {
    let directory = std::env::temp_dir().join(format!("qa-chat-context-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("context.sqlite");
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let id = session(&service);
    let record = finding(&service, &id);
    let started = start(
        &service,
        &compose(&service, &service.load_chat(&id).unwrap()),
        context(&record, "Pinned evidence"),
    );
    let saved = service
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            assistant_text: "Synthetic response".into(),
        })
        .unwrap();
    service.delete_finding(&record.id).unwrap();
    assert_eq!(service.load_chat(&id).unwrap(), saved);
    drop(service);
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    assert_eq!(service.load_chat(&id).unwrap(), saved);
    service
        .database()
        .connection()
        .execute_batch("DROP TABLE chat_message_contexts; PRAGMA user_version = 15;")
        .unwrap();
    drop(service);
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let legacy = service.load_chat(&id).unwrap();
    assert_eq!(legacy.messages[0].text, "Review this record");
    assert_eq!(legacy.messages[0].context, ChatTarget::Session);
    assert_eq!(
        service
            .database()
            .connection()
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i32>(0))
            .unwrap(),
        SCHEMA_VERSION
    );
    service.delete_session(&id).unwrap();
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn chat_context_deliberate_reset_clears_input_and_submitted_history_remains_frozen() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let record = finding(&service, &id);
    let started = start(
        &service,
        &compose(&service, &service.load_chat(&id).unwrap()),
        context(&record, "Evidence"),
    );
    let completed = service
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            assistant_text: "Synthetic response".into(),
        })
        .unwrap();
    let note = service.get_or_create_note_entry(&id).unwrap();
    service
        .submit_chat(ChatSubmitRequest {
            scope: scope(&completed),
            note_id: note.id.clone(),
            expected_note_body: note.body,
            expected_note_body_json: note.body_json,
            expected_note_body_format: note.body_format,
        })
        .unwrap();
    let submitted = service.load_chat(&id).unwrap();
    assert!(
        service
            .start_chat_turn_with_context(
                ChatStartRequest {
                    scope: scope(&submitted)
                },
                context(&record, "Other")
            )
            .is_err()
    );
    let next = service
        .restart_chat(ChatRestartRequest {
            scope: scope(&submitted),
        })
        .unwrap();
    let input = compose(&service, &next);
    let restarted = service
        .restart_chat(ChatRestartRequest {
            scope: scope(&input),
        })
        .unwrap();
    assert_eq!(restarted.composer, "");
    assert!(restarted.messages.is_empty());
    let note = service.get_or_create_note_entry(&id).unwrap();
    assert!(
        note.body
            .contains("Finding context: Locally edited checkout finding (unsaved editor snapshot)")
    );
}

#[test]
fn chat_context_insert_failure_rolls_back_user_message_and_composer_together() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let record = finding(&service, &id);
    let chat = compose(&service, &service.load_chat(&id).unwrap());
    service.database().connection().execute_batch("CREATE TRIGGER reject_context BEFORE INSERT ON chat_message_contexts BEGIN SELECT RAISE(ABORT, 'Synthetic context failure'); END;").unwrap();
    assert!(
        service
            .start_chat_turn_with_context(
                ChatStartRequest {
                    scope: scope(&chat)
                },
                context(&record, "Evidence")
            )
            .is_err()
    );
    assert_eq!(service.load_chat(&id).unwrap(), chat);
    assert_eq!(
        service
            .database()
            .connection()
            .query_row("SELECT COUNT(*) FROM chat_messages", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn chat_context_retry_after_process_reopen_uses_the_interrupted_snapshot() {
    let directory =
        std::env::temp_dir().join(format!("qa-chat-retry-context-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("context.sqlite");
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let id = session(&service);
    let record = finding(&service, &id);
    let started = start(
        &service,
        &compose(&service, &service.load_chat(&id).unwrap()),
        context(&record, "Original unsaved evidence"),
    );
    let original = started.chat.messages[0].clone();
    drop(service);
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let interrupted = service.load_chat(&id).unwrap();
    assert_eq!(interrupted.messages[0].status, ChatTurnStatus::Interrupted);
    service
        .update_finding(
            &record.id,
            FindingPatch {
                title: Some("New saved content after reopen".into()),
                ..Default::default()
            },
            qa_scribe_core::domain::RecordWriteGuard::finding(&record),
        )
        .unwrap()
        .into_saved()
        .unwrap();
    let retried = service
        .retry_chat_turn(ChatStartRequest {
            scope: scope(&interrupted),
        })
        .unwrap();
    assert_eq!(retried.chat.messages[0].id, original.id);
    assert_eq!(retried.chat.messages[0].context, original.context);
    assert_ne!(retried.turn_id, original.turn_id);
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
