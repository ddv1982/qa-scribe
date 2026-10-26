use qa_scribe_core::{domain::*, services::SessionService};
use serde_json::{Value, json};

fn scope(chat: &ChatState) -> ChatRevision {
    ChatRevision {
        session_id: chat.session_id.clone(),
        draft_id: chat.draft_id.clone(),
        expected_revision: chat.revision,
    }
}
fn offered(service: &SessionService, chat: ChatState, target: ChatTarget, kind: &str) -> ChatState {
    let chat = service
        .save_chat_composer(ChatComposerRequest {
            scope: scope(&chat),
            composer: "Review this source".into(),
            intent: ChatComposerIntent::RefineRecord,
            mode: ChatMode::Chat,
            attachment_ids: vec![],
        })
        .unwrap();
    let start = service
        .start_chat_turn_with_response(
            ChatStartRequest {
                scope: scope(&chat),
            },
            target,
            ChatRequestIntent::RefineRecord,
        )
        .unwrap();
    let contract = service
        .response_contract(&start.chat.messages.last().unwrap().id)
        .unwrap()
        .unwrap();
    let mut response = json!({"version":contract.version(),"requestId":contract.request_id(),"markdown":"Reviewed source"});
    let patch = json!({"kind":kind,"title":"Suggested"});
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
fn resolve(
    service: &SessionService,
    chat: &ChatState,
    id: &str,
    action: RefinementAction,
) -> qa_scribe_core::Result<ChatState> {
    service.resolve_refinement(RefinementRequest {
        scope: scope(chat),
        proposal_id: id.into(),
        action,
    })
}
fn legacy_stage(
    service: &SessionService,
    proposal: &RefinementProposal,
    id: &str,
) -> (EditorStage, String) {
    let stage = EditorStage {
        id: id.into(),
        before: proposal.before.clone(),
        after: proposal.after.clone(),
        stored_base_token: proposal
            .target
            .snapshot()
            .unwrap()
            .stored_base_token
            .clone(),
    };
    let mut proposal = proposal.clone();
    proposal.state = RefinementState::Staged {
        stage: stage.clone(),
    };
    let raw = serde_json::to_string(&stage).unwrap();
    service
        .database()
        .connection()
        .execute(
            "INSERT INTO chat_editor_stages(id,proposal_id,stage_json) VALUES (?1,?2,?3)",
            rusqlite::params![id, proposal.id, raw],
        )
        .unwrap();
    service
        .database()
        .connection()
        .execute(
            "UPDATE chat_refinements SET proposal_json=?1 WHERE id=?2",
            rusqlite::params![serde_json::to_string(&proposal).unwrap(), proposal.id],
        )
        .unwrap();
    (stage, raw)
}
#[test]
fn legacy_competing_stages_require_explicit_resolution() {
    for kind in ["finding", "test_cases_draft"] {
        let service = SessionService::in_memory().unwrap();
        let session = service
            .create_session(SessionDraft {
                title: "Legacy competitors".into(),
                ..Default::default()
            })
            .unwrap();
        let record: Value = if kind == "finding" {
            serde_json::to_value(
                service
                    .create_finding(FindingDraft {
                        session_id: session.id.clone(),
                        title: "Before".into(),
                        body: "Literal stored body".into(),
                        body_json: None,
                        body_format: None,
                        kind: FindingKind::Bug,
                        metadata_json: None,
                    })
                    .unwrap(),
            )
            .unwrap()
        } else {
            serde_json::to_value(service.create_draft(serde_json::from_value(json!({"sessionId":session.id,"title":"Before","body":"Literal stored body","kind":"testware","aiRunId":null})).unwrap()).unwrap()).unwrap()
        };
        let record_id = record["id"].as_str().unwrap();
        let target: ChatTarget = serde_json::from_value(json!({"kind":kind,"snapshot":{"sessionId":session.id,"recordId":record_id,"title":"Before","documentJson":"{\"schemaVersion\":1,\"doc\":{\"type\":\"doc\",\"content\":[]}}","metadataJson":null,"recordKind":if kind=="finding" {"bug"} else {"testware"},"origin":"saved","localFingerprint":"","storedBaseToken":""}})).unwrap();
        let notes = offered(
            &service,
            service.load_chat(&session.id).unwrap(),
            target.clone(),
            kind,
        );
        let notes = offered(&service, notes, target.clone(), kind);
        let a_id = notes.proposals[0].id.clone();
        let b_id = notes.proposals[1].id.clone();
        let (a, a_json) = legacy_stage(&service, &notes.proposals[0], "legacy-A");
        let (_, b_json) = legacy_stage(&service, &notes.proposals[1], "legacy-B");
        let reference = ChatRef {
            session_id: session.id.clone(),
            draft_id: notes.draft_id.clone(),
        };
        let notes = service.read_chat(&reference).unwrap();
        assert_eq!(
            resolve(&service, &notes, &a_id, RefinementAction::Stage).unwrap(),
            notes
        );
        let history = service
            .list_chat_history(ChatHistoryScope::Session {
                session_id: session.id.clone(),
            })
            .unwrap();
        assert_eq!(
            history
                .iter()
                .map(|entry| entry.unresolved_stages.len())
                .sum::<usize>(),
            2
        );
        let c = service
            .begin_record_chat(BeginRecordChatRequest {
                session_id: session.id.clone(),
                draft_id: uuid::Uuid::new_v4().to_string(),
                record: serde_json::from_value(json!({"kind":kind,"recordId":record_id})).unwrap(),
            })
            .unwrap();
        let c = offered(&service, c, target, kind);
        let c_id = c.proposals[0].id.clone();
        assert!(resolve(&service, &c, &c_id, RefinementAction::Stage).is_err());
        let notes = resolve(&service, &notes, &b_id, RefinementAction::Abandon).unwrap();
        assert!(resolve(&service, &c, &c_id, RefinementAction::Stage).is_err());
        let guard = RecordWriteGuard {
            session_id: session.id.clone(),
            expected_stored_base: a.stored_base_token.clone(),
            origin: RecordWriteOrigin::Proposal {
                stage_id: a.id.clone(),
            },
        };
        let saved = if kind == "finding" {
            serde_json::to_value(
                service
                    .update_finding(
                        record_id,
                        FindingPatch {
                            title: Some("Before".into()),
                            ..Default::default()
                        },
                        guard,
                    )
                    .unwrap()
                    .into_saved()
                    .unwrap(),
            )
            .unwrap()
        } else {
            serde_json::to_value(
                service
                    .update_draft(
                        record_id,
                        DraftPatch {
                            title: Some("Before".into()),
                            ..Default::default()
                        },
                        guard,
                    )
                    .unwrap()
                    .into_saved()
                    .unwrap(),
            )
            .unwrap()
        };
        assert_eq!(saved["title"], "Before");
        assert_eq!(saved["body"], "Literal stored body");
        let staged = resolve(&service, &c, &c_id, RefinementAction::Stage).unwrap();
        assert!(matches!(
            staged.proposals[0].state,
            RefinementState::Staged { .. }
        ));
        assert!(matches!(
            service.read_chat(&reference).unwrap().proposals[0].state,
            RefinementState::Saved { .. }
        ));
        assert!(matches!(
            notes.proposals[1].state,
            RefinementState::Abandoned { .. }
        ));
        for (id, raw) in [("legacy-A", a_json), ("legacy-B", b_json)] {
            let stored: String = service
                .database()
                .connection()
                .query_row(
                    "SELECT stage_json FROM chat_editor_stages WHERE id=?1",
                    [id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(stored, raw);
        }
    }
}
