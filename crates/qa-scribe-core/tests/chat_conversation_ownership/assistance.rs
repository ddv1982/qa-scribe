use super::*;
use serde_json::json;

#[test]
fn ordinary_record_assistance_accepts_edit_and_answer_outcomes_for_both_kinds() {
    for test_cases in [false, true] {
        for with_patch in [false, true] {
            let service = SessionService::in_memory().unwrap();
            let session_id = session(&service);
            let notes = service.load_chat(&session_id).unwrap();
            let record = if test_cases {
                let draft = service
                    .create_draft(DraftCreate {
                        session_id: session_id.clone(),
                        ai_run_id: None,
                        kind: DraftKind::Testware,
                        title: "Synthetic test cases".into(),
                        body: "Original".into(),
                        body_json: None,
                        body_format: None,
                        metadata_json: None,
                    })
                    .unwrap();
                ConversationRecord::TestCasesDraft {
                    record_id: draft.id,
                }
            } else {
                finding(&service, &session_id)
            };
            let chat = service
                .begin_record_chat(launch(&session_id, &record))
                .unwrap();
            let chat = service
                .save_chat_composer(composer(
                    &chat,
                    "Please help with this record",
                    ChatComposerIntent::Message,
                ))
                .unwrap();
            let started = service
                .start_chat_turn_with_response(
                    ChatStartRequest {
                        scope: scope(&chat),
                    },
                    owned_context(&chat),
                    ChatRequestIntent::Message,
                )
                .unwrap();
            let user = &started.chat.messages[0];
            let contract = service.response_contract(&user.id).unwrap().unwrap();
            assert_eq!(
                contract.purpose(),
                ChatResponsePurpose::Refinement {
                    record_kind: if test_cases {
                        RefinementRecordKind::TestCasesDraft
                    } else {
                        RefinementRecordKind::Finding
                    }
                }
            );
            let patch = with_patch.then(|| json!({"kind": if test_cases {"test_cases_draft"} else {"finding"}, "bodyMarkdown":"Literal suggested expected result"}));
            let completed = service.finish_chat_turn(ChatFinishRequest { scope: scope(&started.chat), turn_id: started.turn_id, assistant_text: json!({"version":contract.version(),"requestId":user.id,"markdown":"Literal helpful answer", "outcome":if with_patch {json!({"kind":"edit","patch":patch})} else {json!({"kind":"answer"})}}).to_string() }).unwrap();
            assert_eq!(
                completed.messages.last().unwrap().text,
                "Literal helpful answer"
            );
            assert_eq!(completed.proposals.len(), usize::from(with_patch));
            if with_patch {
                assert!(
                    completed.proposals[0]
                        .after
                        .document_json
                        .contains("Literal suggested expected result")
                );
            }
            assert_eq!(service.load_chat(&session_id).unwrap(), notes);
            assert_eq!(
                if test_cases {
                    service.list_drafts(&session_id).unwrap()[0].body.clone()
                } else {
                    service.list_findings(&session_id).unwrap()[0].body.clone()
                },
                if test_cases {
                    "Original"
                } else {
                    "<p>Original</p>"
                }
            );
        }
    }
}
