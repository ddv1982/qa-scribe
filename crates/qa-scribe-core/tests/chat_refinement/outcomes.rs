use super::*;

pub(super) fn begin(
    test_cases: bool,
    composer: &str,
    unsaved: bool,
) -> (SessionService, Finding, Option<Draft>, ChatTurnStarted) {
    let (service, finding) = setup();
    let draft = test_cases.then(|| {
        service
            .create_draft(DraftCreate {
                session_id: finding.session_id.clone(),
                ai_run_id: None,
                kind: DraftKind::Testware,
                title: "Before".into(),
                body: "Original test cases".into(),
                body_json: None,
                body_format: None,
                metadata_json: Some("{\"custom\":true}".into()),
            })
            .unwrap()
    });
    let mut context = target(&finding);
    if let Some(draft) = &draft {
        let mut snapshot = context.snapshot().unwrap().clone();
        snapshot.record_id = draft.id.clone();
        snapshot.record_kind = "testware".into();
        snapshot.metadata_json = draft.metadata_json.clone();
        context = ChatTarget::TestCasesDraft { snapshot };
    }
    if unsaved {
        match &mut context {
            ChatTarget::Finding { snapshot } | ChatTarget::TestCasesDraft { snapshot } => {
                snapshot.origin = RecordSnapshotOrigin::UnsavedEditor
            }
            ChatTarget::Session => unreachable!(),
        }
    }
    let chat = service
        .begin_record_chat(BeginRecordChatRequest {
            session_id: finding.session_id.clone(),
            draft_id: uuid::Uuid::new_v4().to_string(),
            record: if let Some(draft) = &draft {
                ConversationRecord::TestCasesDraft {
                    record_id: draft.id.clone(),
                }
            } else {
                ConversationRecord::Finding {
                    record_id: finding.id.clone(),
                }
            },
        })
        .unwrap();
    let chat = service
        .save_chat_composer(ChatComposerRequest {
            scope: scope(&chat),
            intent: ChatComposerIntent::Message,
            composer: composer.into(),
            mode: ChatMode::Chat,
            attachment_ids: vec![],
        })
        .unwrap();
    let start = service
        .start_chat_turn_with_response(
            ChatStartRequest {
                scope: scope(&chat),
            },
            context,
            ChatRequestIntent::Message,
        )
        .unwrap();
    (service, finding, draft, start)
}

pub(super) fn finish(
    service: &SessionService,
    start: ChatTurnStarted,
    outcome: serde_json::Value,
) -> ChatState {
    let contract = service
        .response_contract(&start.chat.messages[0].id)
        .unwrap()
        .unwrap();
    assert_eq!(contract.version(), 3);
    service.finish_chat_turn(ChatFinishRequest {
        scope: scope(&start.chat), turn_id: start.turn_id,
        assistant_text: json!({"version":3,"requestId":contract.request_id(),"markdown":"Readable explanation.","outcome":outcome}).to_string(),
    }).unwrap()
}

#[test]
fn record_outcomes_validate_edits_answers_and_clarifications_for_both_kinds() {
    for test_cases in [false, true] {
        for mode in ["edit", "answer", "clarification"] {
            let (service, finding, draft, start) =
                begin(test_cases, "Improve the expected result", false);
            let kind = if test_cases {
                "test_cases_draft"
            } else {
                "finding"
            };
            let outcome = match mode {
                "edit" => {
                    json!({"kind":"edit","patch":{"kind":kind,"title":"Clear expected result","bodyMarkdown":"The error remains visible after Retry."}})
                }
                "answer" => json!({"kind":"answer"}),
                _ => {
                    json!({"kind":"clarification","question":{"prompt":"Which retry?","choices":["First retry","Every retry"]}})
                }
            };
            let chat = finish(&service, start, outcome);
            let response = chat.messages.last().unwrap().response.as_ref().unwrap();
            assert!(response.warning.is_none());
            assert_eq!(chat.messages.last().unwrap().text, "Readable explanation.");
            assert_eq!(chat.proposals.len(), usize::from(mode == "edit"));
            assert_eq!(
                response.question.as_ref().map(|q| q.prompt.as_str()),
                (mode == "clarification").then_some("Which retry?")
            );
            if mode == "edit" {
                assert_eq!(chat.proposals[0].after.title, "Clear expected result");
                assert!(
                    chat.proposals[0]
                        .after
                        .document_json
                        .contains("The error remains visible after Retry.")
                );
                assert!(
                    chat.proposals[0]
                        .after
                        .document_json
                        .contains("qa-scribe-attachment://original")
                );
                assert_eq!(
                    chat.proposals[0].after.metadata_json,
                    chat.proposals[0].before.metadata_json
                );
            }
            assert_eq!(
                service.list_findings(&finding.session_id).unwrap(),
                vec![finding.clone()]
            );
            assert_eq!(
                service.list_drafts(&finding.session_id).unwrap(),
                draft.into_iter().collect::<Vec<_>>()
            );
        }
    }
}

#[test]
fn malformed_record_outcomes_preserve_explanation_without_proposal_or_record_write() {
    for test_cases in [false, true] {
        let kind = if test_cases {
            "test_cases_draft"
        } else {
            "finding"
        };
        for outcome in [
            json!({"kind":"edit"}),
            json!(null),
            json!({"kind":"edit","patch":null}),
            json!({"kind":"edit","patch":{"kind":kind}}),
            json!({"kind":"edit","patch":{"kind":kind,"title":" "}}),
            json!({"kind":"edit","patch":{"kind":kind,"bodyMarkdown":" "}}),
            json!({"kind":"edit","patch":{"kind":kind,"title":"Before"}}),
            json!({"kind":"edit","patch":{"kind":if test_cases {"finding"} else {"test_cases_draft"},"title":"After"}}),
            json!({"kind":"answer","patch":{"kind":kind,"title":"After"}}),
            json!({"kind":"clarification","patch":{"kind":kind,"title":"After"}}),
            json!({"kind":"clarification","question":{"prompt":"Which?","choices":[]}}),
            json!({"kind":"edit","patch":{"kind":kind,"title":"After"},"question":{"prompt":"Which?","choices":["One"]}}),
        ] {
            let (service, finding, draft, start) =
                begin(test_cases, "Improve the expected result", false);
            let chat = finish(&service, start, outcome);
            assert!(chat.proposals.is_empty());
            assert_eq!(chat.messages.last().unwrap().text, "Readable explanation.");
            assert_eq!(
                chat.messages
                    .last()
                    .unwrap()
                    .response
                    .as_ref()
                    .unwrap()
                    .warning
                    .as_deref(),
                Some(
                    "The AI reply could not be processed. No changes were applied from this reply. Try again."
                )
            );
            assert_eq!(
                service.list_findings(&finding.session_id).unwrap(),
                vec![finding.clone()]
            );
            assert_eq!(
                service.list_drafts(&finding.session_id).unwrap(),
                draft.into_iter().collect::<Vec<_>>()
            );
        }
    }
}

#[test]
fn malformed_non_edit_record_outcomes_preserve_explanation_without_controls_or_record_write() {
    for test_cases in [false, true] {
        for (composer, outcome) in [
            (
                "Why does retry need an expected result?",
                json!({"kind":"answer","patch":{"kind":"finding","title":"After"}}),
            ),
            (
                "Which retry do you mean?",
                json!({"kind":"clarification","question":{"prompt":"Which?","choices":[]}}),
            ),
        ] {
            let (service, finding, draft, start) = begin(test_cases, composer, false);
            let chat = finish(&service, start, outcome);
            let message = chat.messages.last().unwrap();
            let response = message.response.as_ref().unwrap();
            assert_eq!(message.text, "Readable explanation.");
            assert_eq!(
                response.warning.as_deref(),
                Some(
                    "The AI reply could not be processed. No changes were applied from this reply. Try again."
                )
            );
            assert!(response.question.is_none());
            assert!(chat.proposals.is_empty());
            assert_eq!(
                service.list_findings(&finding.session_id).unwrap(),
                vec![finding.clone()]
            );
            assert_eq!(
                service.list_drafts(&finding.session_id).unwrap(),
                draft.into_iter().collect::<Vec<_>>()
            );
        }
    }
}

#[test]
fn v2_record_contract_remains_readable_with_optional_patch() {
    for patch in [
        json!(null),
        json!({"kind":"finding","title":"Legacy title"}),
    ] {
        let (service, finding, _, start) = begin(false, "Improve the expected result", false);
        let id = &start.chat.messages[0].id;
        let db = service.database().connection();
        db.execute_batch("DROP TRIGGER chat_contract_immutable")
            .unwrap();
        db.execute("UPDATE chat_response_contracts SET contract_json=?1 WHERE message_id=?2", rusqlite::params![json!({"version":2,"requestId":id,"purpose":{"kind":"refinement","recordKind":"finding"}}).to_string(), id]).unwrap();
        let chat = service.finish_chat_turn(ChatFinishRequest {
            scope: scope(&start.chat), turn_id: start.turn_id,
            assistant_text: json!({"version":2,"requestId":id,"markdown":"Historical answer","refinement":patch}).to_string(),
        }).unwrap();
        assert_eq!(chat.messages.last().unwrap().text, "Historical answer");
        assert_eq!(chat.proposals.len(), usize::from(!patch.is_null()));
        assert!(
            chat.messages
                .last()
                .unwrap()
                .response
                .as_ref()
                .unwrap()
                .warning
                .is_none()
        );
        assert_eq!(
            service.list_findings(&finding.session_id).unwrap(),
            vec![finding]
        );
    }
}

#[test]
fn record_envelope_rejects_wrong_version_nonce_unknown_fields_blank_markdown_and_missing_outcome() {
    for field in ["version", "requestId", "unknown", "markdown", "outcome"] {
        let (service, finding, _, start) = begin(false, "Explain the expected result", false);
        let mut response = json!({"version":3,"requestId":start.chat.messages[0].id,"markdown":"Readable explanation.","outcome":{"kind":"answer"}});
        match field {
            "version" => response["version"] = json!(2),
            "requestId" => response["requestId"] = json!("another-request"),
            "unknown" => response["unknown"] = json!(true),
            "markdown" => response["markdown"] = json!(" "),
            _ => {
                response.as_object_mut().unwrap().remove("outcome");
            }
        }
        let chat = service
            .finish_chat_turn(ChatFinishRequest {
                scope: scope(&start.chat),
                turn_id: start.turn_id,
                assistant_text: response.to_string(),
            })
            .unwrap();
        assert!(chat.proposals.is_empty());
        assert_eq!(
            chat.messages
                .last()
                .unwrap()
                .response
                .as_ref()
                .unwrap()
                .warning
                .as_deref(),
            Some(
                "The AI reply could not be processed. No changes were applied from this reply. Try again."
            )
        );
        assert_eq!(
            service.list_findings(&finding.session_id).unwrap(),
            vec![finding]
        );
    }
}
