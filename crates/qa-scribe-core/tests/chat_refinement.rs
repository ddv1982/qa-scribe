use qa_scribe_core::{domain::*, services::SessionService};
use serde_json::json;

fn scope(chat: &ChatState) -> ChatRevision {
    ChatRevision {
        session_id: chat.session_id.clone(),
        draft_id: chat.draft_id.clone(),
        expected_revision: chat.revision,
    }
}
fn setup() -> (SessionService, Finding) {
    let service = SessionService::in_memory().unwrap();
    let session = service
        .create_session(SessionDraft {
            title: "Synthetic R1".into(),
            ..Default::default()
        })
        .unwrap();
    let record = service
        .create_finding(FindingDraft {
            session_id: session.id,
            title: "Before".into(),
            body: "<p>Before body</p>".into(),
            body_json: None,
            body_format: None,
            kind: FindingKind::Bug,
            metadata_json: Some(json!({"unknown":{"keep":true},"severity":"low"}).to_string()),
        })
        .unwrap();
    (service, record)
}
fn target(record: &Finding) -> ChatTarget {
    ChatTarget::Finding { snapshot: RecordContextSnapshot { session_id: record.session_id.clone(), record_id: record.id.clone(), title: record.title.clone(), document_json: json!({"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Before body"}]},{"type":"image","attrs":{"attachmentId":"original","src":"qa-scribe-attachment://original","alt":"Evidence"}}]}}).to_string(), metadata_json: record.metadata_json.clone(), record_kind: "bug".into(), origin: RecordSnapshotOrigin::Saved, local_fingerprint: String::new(), stored_base_token: String::new() } }
}
fn started(service: &SessionService, record: &Finding) -> ChatTurnStarted {
    let chat = service.load_chat(&record.session_id).unwrap();
    let chat = service
        .save_chat_composer(ChatComposerRequest {
            intent: qa_scribe_core::domain::ChatComposerIntent::Message,
            scope: scope(&chat),
            composer: "Refine the expected result".into(),
            mode: ChatMode::Chat,
            attachment_ids: vec![],
        })
        .unwrap();
    service
        .start_chat_turn_with_response(
            ChatStartRequest {
                scope: scope(&chat),
            },
            target(record),
            ChatRequestIntent::RefineRecord,
        )
        .unwrap()
}
fn complete(
    service: &SessionService,
    start: ChatTurnStarted,
    patch: serde_json::Value,
) -> ChatState {
    let contract = service
        .response_contract(&start.chat.messages[0].id)
        .unwrap()
        .unwrap();
    let mut response = json!({"version":contract.version(),"requestId":contract.request_id(),"markdown":"Suggested clearer expected result."});
    if contract.version() == 3 {
        response["outcome"] = json!({"kind":"edit","patch":patch});
    } else {
        response["refinement"] = patch;
    }
    service
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&start.chat),
            turn_id: start.turn_id,
            assistant_text: response.to_string(),
        })
        .unwrap()
}
fn action(service: &SessionService, chat: &ChatState, action: RefinementAction) -> ChatState {
    service
        .resolve_refinement(RefinementRequest {
            scope: scope(chat),
            proposal_id: chat.proposals[0].id.clone(),
            action,
        })
        .unwrap()
}

#[test]
fn completed_review_stage_dirty_save_and_note_handoff_preserve_images_and_unknown_metadata() {
    let (service, record) = setup();
    let chat = complete(
        &service,
        started(&service, &record),
        json!({"kind":"finding","title":"After","bodyMarkdown":"**Expected:** Show a receipt. <script>alert(1)</script>","metadata":{"severity":"high"}}),
    );
    assert_eq!(chat.proposals.len(), 1);
    assert_eq!(chat.proposals[0].before.title, "Before");
    assert_eq!(chat.proposals[0].after.title, "After");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(
            chat.proposals[0].after.metadata_json.as_deref().unwrap()
        )
        .unwrap(),
        json!({"unknown":{"keep":true},"severity":"high"})
    );
    let doc: serde_json::Value =
        serde_json::from_str(&chat.proposals[0].after.document_json).unwrap();
    assert_eq!(
        doc["doc"]["content"][1]["attrs"]["attachmentId"],
        "original"
    );
    assert!(
        !chat.proposals[0]
            .after
            .document_json
            .contains("\"type\":\"script\"")
    );
    let staged = action(&service, &chat, RefinementAction::Stage);
    let repeated = action(&service, &staged, RefinementAction::Stage);
    assert_eq!(staged.proposals, repeated.proposals);
    assert_eq!(
        service.list_findings(&record.session_id).unwrap(),
        vec![record.clone()]
    );
    let stage = match &staged.proposals[0].state {
        RefinementState::Staged { stage } => stage,
        _ => panic!("stage"),
    };
    let mut guard = RecordWriteGuard::finding(&record);
    guard.origin = RecordWriteOrigin::Proposal {
        stage_id: stage.id.clone(),
    };
    let saved = service
        .update_finding(
            &record.id,
            FindingPatch {
                title: Some("After".into()),
                body: Some("<p>Expected receipt</p>".into()),
                body_json: Some(Some(stage.after.document_json.clone())),
                body_format: Some(Some("tiptap_json".into())),
                metadata_json: Some(stage.after.metadata_json.clone()),
                ..Default::default()
            },
            guard,
        )
        .unwrap();
    assert!(matches!(saved, RecordWriteOutcome::Saved { .. }));
    let chat = service.load_chat(&record.session_id).unwrap();
    assert!(matches!(
        chat.proposals[0].state,
        RefinementState::Saved { .. }
    ));
}

#[test]
fn whole_envelope_only_wrong_kind_unknown_fields_empty_patch_and_fences_fall_back() {
    for patch in [
        json!({"kind":"test_cases_draft","title":"No"}),
        json!({"kind":"finding","recordId":"invented","title":"No"}),
        json!({"kind":"finding"}),
        json!({"kind":"finding","metadata":{"severity":"invented"}}),
    ] {
        let (service, record) = setup();
        let chat = complete(&service, started(&service, &record), patch);
        assert!(chat.proposals.is_empty());
        assert!(
            chat.messages
                .last()
                .unwrap()
                .response
                .as_ref()
                .unwrap()
                .warning
                .as_ref()
                .unwrap()
                .starts_with("No editable proposal")
        );
    }
    for raw in [
        "Please replace the title with After",
        "```json\n{\"version\":1}\n```",
        "{\"version\":1",
        "{\"version\":1,\"requestId\":\"wrong\",\"markdown\":\"x\"}",
    ] {
        let (service, record) = setup();
        let start = started(&service, &record);
        let chat = service
            .finish_chat_turn(ChatFinishRequest {
                scope: scope(&start.chat),
                turn_id: start.turn_id,
                assistant_text: raw.into(),
            })
            .unwrap();
        assert!(chat.proposals.is_empty());
        assert_eq!(
            service.list_findings(&record.session_id).unwrap()[0].title,
            "Before"
        );
    }
}

#[test]
fn stale_storage_and_stage_dismiss_do_not_overwrite_and_undo_is_durable() {
    let (service, record) = setup();
    let chat = complete(
        &service,
        started(&service, &record),
        json!({"kind":"finding","title":"After"}),
    );
    let chat = action(&service, &chat, RefinementAction::Stage);
    assert!(
        service
            .resolve_refinement(RefinementRequest {
                scope: scope(&chat),
                proposal_id: chat.proposals[0].id.clone(),
                action: RefinementAction::Dismiss
            })
            .is_err()
    );
    service
        .update_finding(
            &record.id,
            FindingPatch {
                title: Some("Newer stored".into()),
                ..Default::default()
            },
            RecordWriteGuard::finding(&record),
        )
        .unwrap();
    let mut guard = RecordWriteGuard::finding(&record);
    guard.origin = match &chat.proposals[0].state {
        RefinementState::Staged { stage } => RecordWriteOrigin::Proposal {
            stage_id: stage.id.clone(),
        },
        _ => RecordWriteOrigin::Editor,
    };
    let result = service
        .update_finding(
            &record.id,
            FindingPatch {
                title: Some("After".into()),
                ..Default::default()
            },
            guard,
        )
        .unwrap();
    match result {
        RecordWriteOutcome::Conflict { current } => assert_eq!(current.title, "Newer stored"),
        _ => panic!("expected conflict"),
    }
    let current = service.load_chat(&record.session_id).unwrap();
    let undone = action(&service, &current, RefinementAction::Undo);
    assert!(matches!(
        undone.proposals[0].state,
        RefinementState::Undone { .. }
    ));
    assert_eq!(
        service.list_findings(&record.session_id).unwrap()[0].title,
        "Newer stored"
    );
}

#[test]
fn draft_guards_compare_all_body_representations_and_session() {
    let (service, finding) = setup();
    let record = service
        .create_draft(DraftCreate {
            session_id: finding.session_id.clone(),
            ai_run_id: None,
            kind: DraftKind::Testware,
            title: "Cases".into(),
            body: "Old".into(),
            body_json: None,
            body_format: None,
            metadata_json: Some("{\"private\":true}".into()),
        })
        .unwrap();
    let guard = RecordWriteGuard::draft(&record);
    let saved = service
        .update_draft(
            &record.id,
            DraftPatch {
                title: Some("New cases".into()),
                ..Default::default()
            },
            guard.clone(),
        )
        .unwrap();
    assert!(matches!(saved, RecordWriteOutcome::Saved { .. }));
    let conflict = service
        .update_draft(
            &record.id,
            DraftPatch {
                body: Some("Must not overwrite".into()),
                ..Default::default()
            },
            guard,
        )
        .unwrap();
    match conflict {
        RecordWriteOutcome::Conflict { current } => {
            assert_eq!(current.title, "New cases");
            assert_eq!(current.body, "Old");
        }
        _ => panic!("expected conflict"),
    }
    let mut guard = RecordWriteGuard::draft(&record);
    guard.session_id = "wrong".into();
    assert!(
        service
            .update_draft(&record.id, DraftPatch::default(), guard)
            .is_err()
    );
}

#[test]
fn competing_stage_is_atomic_across_conversations() {
    let (service, record) = setup();
    let a = complete(
        &service,
        started(&service, &record),
        json!({"kind":"finding","title":"A suggestion"}),
    );
    let b = service
        .begin_record_chat(BeginRecordChatRequest {
            session_id: record.session_id.clone(),
            draft_id: uuid::Uuid::new_v4().to_string(),
            record: ConversationRecord::Finding {
                record_id: record.id.clone(),
            },
        })
        .unwrap();
    let b = service
        .save_chat_composer(ChatComposerRequest {
            scope: scope(&b),
            composer: "B request".into(),
            intent: ChatComposerIntent::RefineRecord,
            mode: ChatMode::Chat,
            attachment_ids: vec![],
        })
        .unwrap();
    let b = service
        .start_chat_turn_with_response(
            ChatStartRequest { scope: scope(&b) },
            target(&record),
            ChatRequestIntent::RefineRecord,
        )
        .unwrap();
    let b = complete(
        &service,
        b,
        json!({"kind":"finding","title":"B suggestion"}),
    );
    let staged = action(&service, &a, RefinementAction::Stage);
    let error = service.resolve_refinement(RefinementRequest {
        scope: scope(&b),
        proposal_id: b.proposals[0].id.clone(),
        action: RefinementAction::Stage,
    });
    assert!(
        error.is_err(),
        "a second conversation must not stage the same record"
    );
    assert_eq!(
        service
            .read_chat(&ChatRef {
                session_id: b.session_id.clone(),
                draft_id: b.draft_id.clone()
            })
            .unwrap(),
        b
    );
    let replay = action(&service, &staged, RefinementAction::Stage);
    assert_eq!(replay, staged);
    assert_eq!(
        service.list_findings(&record.session_id).unwrap(),
        vec![record.clone()]
    );
    let abandoned = action(&service, &staged, RefinementAction::Abandon);
    assert!(matches!(
        abandoned.proposals[0].state,
        RefinementState::Abandoned { .. }
    ));
    let b = action(&service, &b, RefinementAction::Stage);
    assert!(matches!(
        b.proposals[0].state,
        RefinementState::Staged { .. }
    ));
}

#[test]
fn failed_stage_transaction_retains_offer_and_stored_body() {
    let (service, record) = setup();
    let chat = complete(
        &service,
        started(&service, &record),
        json!({"kind":"finding","title":"Rollback suggestion"}),
    );
    service.database().connection().execute_batch("CREATE TRIGGER fail_stage_write BEFORE UPDATE OF proposal_json ON chat_refinements BEGIN SELECT RAISE(ABORT, 'controlled stage write failure'); END;").unwrap();
    assert!(
        service
            .resolve_refinement(RefinementRequest {
                scope: scope(&chat),
                proposal_id: chat.proposals[0].id.clone(),
                action: RefinementAction::Stage
            })
            .is_err()
    );
    assert_eq!(
        service
            .read_chat(&ChatRef {
                session_id: chat.session_id.clone(),
                draft_id: chat.draft_id.clone()
            })
            .unwrap(),
        chat
    );
    let stages: i64 = service
        .database()
        .connection()
        .query_row("SELECT COUNT(*) FROM chat_editor_stages", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(stages, 0);
    assert_eq!(
        service.list_findings(&record.session_id).unwrap(),
        vec![record]
    );
}

#[test]
fn newer_snapshot_stage_cannot_replace_an_older_editor_base() {
    let (service, original) = setup();
    let pinned = RecordWriteGuard::finding(&original);
    let newer = service
        .update_finding(
            &original.id,
            FindingPatch {
                title: Some("Remote title B".into()),
                body: Some("Literal remote body B".into()),
                ..Default::default()
            },
            pinned.clone(),
        )
        .unwrap()
        .into_saved()
        .unwrap();
    let chat = complete(
        &service,
        started(&service, &newer),
        json!({"kind":"finding","title":"Proposed from local A"}),
    );
    let staged = action(&service, &chat, RefinementAction::Stage);
    let stage = match &staged.proposals[0].state {
        RefinementState::Staged { stage } => stage,
        _ => panic!("stage"),
    };
    assert_eq!(
        stage.stored_base_token,
        RecordWriteGuard::finding(&newer).expected_stored_base
    );
    assert_ne!(stage.stored_base_token, pinned.expected_stored_base);
    let attempted = service
        .update_finding(
            &original.id,
            FindingPatch {
                title: Some("Unsaved local A".into()),
                body: Some("Local A body must not overwrite B".into()),
                ..Default::default()
            },
            RecordWriteGuard {
                origin: RecordWriteOrigin::Proposal {
                    stage_id: stage.id.clone(),
                },
                ..pinned
            },
        )
        .unwrap();
    assert!(matches!(attempted, RecordWriteOutcome::Conflict { .. }));
    let stored = service.list_findings(&original.session_id).unwrap();
    assert_eq!(stored[0].title, "Remote title B");
    assert_eq!(stored[0].body, "Literal remote body B");
    assert_eq!(
        RecordWriteGuard::finding(&stored[0]),
        RecordWriteGuard::finding(&newer)
    );
    assert_eq!(
        service.load_chat(&original.session_id).unwrap().proposals,
        staged.proposals
    );
}

#[path = "chat_refinement/outcomes.rs"]
mod outcomes;
