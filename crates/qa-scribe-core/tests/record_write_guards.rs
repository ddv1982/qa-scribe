use qa_scribe_core::{domain::*, services::SessionService, storage::Database};
use serde_json::json;

fn scope(chat: &ChatState) -> ChatRevision {
    ChatRevision {
        session_id: chat.session_id.clone(),
        draft_id: chat.draft_id.clone(),
        expected_revision: chat.revision,
    }
}
fn patch(record: &Finding) -> FindingPatch {
    FindingPatch {
        title: Some(record.title.clone()),
        body: Some(record.body.clone()),
        body_json: Some(record.body_json.clone()),
        body_format: Some(record.body_format.clone()),
        kind: Some(record.kind),
        metadata_json: Some(record.metadata_json.clone()),
    }
}
fn fixture(service: &SessionService) -> (Finding, ChatState) {
    let session = service
        .create_session(SessionDraft {
            title: "Guarded refinement".into(),
            ..Default::default()
        })
        .unwrap();
    let record = service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Original".into(),
            body: "<p>Original</p>".into(),
            body_json: None,
            body_format: None,
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .unwrap();
    let chat = service.load_chat(&session.id).unwrap();
    let chat = service
        .save_chat_composer(ChatComposerRequest {
            scope: scope(&chat),
            composer: "Refine".into(),
            mode: ChatMode::Chat,
            attachment_ids: vec![],
        })
        .unwrap();
    let target = ChatTarget::Finding { snapshot: RecordContextSnapshot { session_id: session.id, record_id: record.id.clone(), title: record.title.clone(), document_json: json!({"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Original"}]}]}}).to_string(), metadata_json: None, record_kind: "bug".into(), origin: RecordSnapshotOrigin::Saved, local_fingerprint: String::new(), stored_base_token: String::new() } };
    let started = service
        .start_chat_turn_with_response(
            ChatStartRequest {
                scope: scope(&chat),
            },
            target,
            true,
        )
        .unwrap();
    let request_id = &started.chat.messages[0].id;
    let chat = service.finish_chat_turn(ChatFinishRequest { scope: scope(&started.chat), turn_id: started.turn_id.clone(), assistant_text: json!({"version":1,"requestId":request_id,"markdown":"Suggested title.","refinement":{"kind":"finding","title":"Suggested"}}).to_string() }).unwrap();
    let chat = service
        .resolve_refinement(RefinementRequest {
            scope: scope(&chat),
            proposal_id: chat.proposals[0].id.clone(),
            action: RefinementAction::Stage,
        })
        .unwrap();
    (record, chat)
}

#[test]
fn proposal_save_second_save_compensation_and_repeat_have_explicit_idempotent_outcomes() {
    let service = SessionService::in_memory().unwrap();
    let (original, chat) = fixture(&service);
    let stage = match &chat.proposals[0].state {
        RefinementState::Staged { stage } => stage.clone(),
        _ => panic!("stage"),
    };
    let mut guard = RecordWriteGuard::finding(&original);
    guard.origin = RecordWriteOrigin::Proposal {
        stage_id: stage.id.clone(),
    };
    let mut edit = original.clone();
    edit.title = "Suggested".into();
    let saved = service
        .update_finding(&edit.id, patch(&edit), guard)
        .unwrap()
        .into_saved()
        .unwrap();
    assert!(matches!(
        service.load_chat(&original.session_id).unwrap().proposals[0].state,
        RefinementState::Saved { .. }
    ));
    let mut second_guard = RecordWriteGuard::finding(&saved);
    second_guard.origin = RecordWriteOrigin::Proposal {
        stage_id: stage.id.clone(),
    };
    let mut second = saved.clone();
    second.title = "User adjusted suggestion".into();
    let second = service
        .update_finding(&second.id, patch(&second), second_guard)
        .unwrap()
        .into_saved()
        .unwrap();
    assert!(matches!(
        service.load_chat(&original.session_id).unwrap().proposals[0].state,
        RefinementState::Saved { .. }
    ));
    let mut compensation = RecordWriteGuard::finding(&second);
    compensation.origin = RecordWriteOrigin::Compensation {
        stage_id: Some(stage.id),
        restored_base: RecordWriteGuard::finding(&original).expected_stored_base,
    };
    let restored = service
        .update_finding(&original.id, patch(&original), compensation.clone())
        .unwrap()
        .into_saved()
        .unwrap();
    assert_eq!(restored.title, "Original");
    let settled = service.load_chat(&original.session_id).unwrap();
    assert!(matches!(
        settled.proposals[0].state,
        RefinementState::Reverted { .. }
    ));
    let repeated = service
        .update_finding(&original.id, patch(&original), compensation)
        .unwrap()
        .into_saved()
        .unwrap();
    assert_eq!(repeated, restored);
    assert_eq!(
        service.load_chat(&original.session_id).unwrap().revision,
        settled.revision
    );
}

#[test]
fn second_client_and_failed_stage_settlement_leave_newer_row_and_stage_atomic() {
    let directory = std::env::temp_dir().join(format!("qa-scribe-r1-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("db.sqlite");
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let (original, chat) = fixture(&service);
    let other = Database::open(&path).unwrap();
    other
        .connection()
        .execute(
            "UPDATE findings SET title='Second client' WHERE id=?1",
            [&original.id],
        )
        .unwrap();
    let conflict = service
        .update_finding(
            &original.id,
            patch(&original),
            RecordWriteGuard::finding(&original),
        )
        .unwrap();
    match conflict {
        RecordWriteOutcome::Conflict { current } => assert_eq!(current.title, "Second client"),
        _ => panic!("conflict"),
    }
    assert_eq!(
        service.load_chat(&original.session_id).unwrap().proposals,
        chat.proposals
    );
    other
        .connection()
        .execute(
            "UPDATE findings SET title='Original' WHERE id=?1",
            [&original.id],
        )
        .unwrap();
    service.database().connection().execute_batch("CREATE TRIGGER fail_stage BEFORE UPDATE ON chat_refinements BEGIN SELECT RAISE(ABORT, 'synthetic stage failure'); END;").unwrap();
    let mut guard = RecordWriteGuard::finding(&original);
    guard.origin = match &chat.proposals[0].state {
        RefinementState::Staged { stage } => RecordWriteOrigin::Proposal {
            stage_id: stage.id.clone(),
        },
        _ => panic!("stage"),
    };
    let mut edit = original.clone();
    edit.title = "Must roll back".into();
    assert!(
        service
            .update_finding(&original.id, patch(&edit), guard)
            .is_err()
    );
    assert_eq!(
        service.list_findings(&original.session_id).unwrap()[0].title,
        "Original"
    );
    assert_eq!(
        service.load_chat(&original.session_id).unwrap().proposals,
        chat.proposals
    );
    drop(other);
    drop(service);
    let reopened = SessionService::new(Database::open(&path).unwrap()).unwrap();
    assert_eq!(
        reopened.load_chat(&original.session_id).unwrap().proposals,
        chat.proposals
    );
    assert_eq!(
        reopened.list_findings(&original.session_id).unwrap()[0].title,
        "Original"
    );
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn staged_reset_and_note_handoff_are_blocked_and_readonly_settlement_cannot_write_a_record() {
    let service = SessionService::in_memory().unwrap();
    let (record, chat) = fixture(&service);
    let stage_id = match &chat.proposals[0].state {
        RefinementState::Staged { stage } => stage.id.clone(),
        _ => panic!("stage"),
    };
    assert!(
        service
            .restart_chat(ChatRestartRequest {
                scope: scope(&chat)
            })
            .unwrap_err()
            .to_string()
            .contains("Save, Undo, or Discard")
    );
    assert_eq!(service.load_chat(&record.session_id).unwrap(), chat);
    let note = service
        .get_or_create_note_entry(&record.session_id)
        .unwrap();
    let submit = ChatSubmitRequest {
        scope: scope(&chat),
        note_id: note.id.clone(),
        expected_note_body: note.body,
        expected_note_body_json: note.body_json,
        expected_note_body_format: note.body_format,
    };
    assert!(
        service
            .submit_chat(submit)
            .unwrap_err()
            .to_string()
            .contains("Save, Undo, or Discard")
    );
    let mut guard = RecordWriteGuard::finding(&record);
    guard.origin = RecordWriteOrigin::Proposal { stage_id };
    let mut edit = record.clone();
    edit.title = "Must not write".into();
    service
        .database()
        .connection()
        .execute(
            "UPDATE chat_drafts SET archived=1 WHERE id=?1",
            [&chat.draft_id],
        )
        .unwrap();
    assert!(
        service
            .update_finding(&record.id, patch(&edit), guard.clone())
            .unwrap_err()
            .to_string()
            .contains("read-only")
    );
    assert_eq!(
        service.list_findings(&record.session_id).unwrap()[0],
        record
    );
    service.database().connection().execute("UPDATE chat_drafts SET archived=0,submitted_note_id=?1,submitted_at='synthetic' WHERE id=?2", [&note.id, &chat.draft_id]).unwrap();
    assert!(
        service
            .update_finding(&record.id, patch(&edit), guard)
            .unwrap_err()
            .to_string()
            .contains("read-only")
    );
    assert_eq!(
        service.list_findings(&record.session_id).unwrap()[0],
        record
    );
}

#[test]
fn readable_note_handoff_records_the_outcome_without_reapplying_and_is_idempotent() {
    let service = SessionService::in_memory().unwrap();
    let (record, chat) = fixture(&service);
    let chat = service
        .resolve_refinement(RefinementRequest {
            scope: scope(&chat),
            proposal_id: chat.proposals[0].id.clone(),
            action: RefinementAction::Undo,
        })
        .unwrap();
    let note = service
        .get_or_create_note_entry(&record.session_id)
        .unwrap();
    let submit = ChatSubmitRequest {
        scope: scope(&chat),
        note_id: note.id.clone(),
        expected_note_body: note.body,
        expected_note_body_json: note.body_json,
        expected_note_body_format: note.body_format,
    };
    let receipt = service.submit_chat(submit.clone()).unwrap();
    assert_eq!(service.submit_chat(submit).unwrap(), receipt);
    let note = service
        .get_or_create_note_entry(&record.session_id)
        .unwrap();
    assert!(note.body.contains("Proposed title: Suggested"));
    assert!(note.body.contains("Undone or discarded"));
    assert!(!note.body.contains("requestId"));
    assert_eq!(
        service.list_findings(&record.session_id).unwrap()[0],
        record
    );
}

#[test]
fn migration_seventeen_preserves_sixteen_context_and_never_reparses_history() {
    let directory =
        std::env::temp_dir().join(format!("qa-scribe-r1-upgrade-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("db.sqlite");
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let (record, chat) = fixture(&service);
    service.database().connection().execute_batch("DROP TABLE chat_editor_stages; DROP TABLE chat_refinements; DROP TABLE chat_response_contracts; PRAGMA user_version=16;").unwrap();
    drop(service);
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let reopened = service.load_chat(&record.session_id).unwrap();
    assert_eq!(reopened.messages, chat.messages);
    assert!(reopened.proposals.is_empty());
    assert!(
        service
            .refinement_contract(&chat.messages[0].id)
            .unwrap()
            .is_none()
    );
    assert_eq!(
        service
            .database()
            .connection()
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i32>(0))
            .unwrap(),
        17
    );
    drop(service);
    std::fs::remove_dir_all(directory).unwrap();
}
