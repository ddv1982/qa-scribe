use super::*;
use qa_scribe_core::ai::{GenerationOutputFormat, ProviderGenerationOutput};
use serde_json::json;

#[test]
fn ordinary_record_assistance_crosses_preparation_and_completion_with_tagged_outcomes() {
    for test_cases in [false, true] {
        for with_patch in [false, true] {
            let (service, notes, _, mut request) = conversation_ownership_tests::fixture();
            if test_cases {
                let draft = service
                    .create_draft(DraftCreate {
                        session_id: notes.session_id.clone(),
                        ai_run_id: None,
                        kind: DraftKind::Testware,
                        title: "Synthetic cases".into(),
                        body: "Original cases".into(),
                        body_json: None,
                        body_format: None,
                        metadata_json: None,
                    })
                    .unwrap();
                let chat = service
                    .begin_record_chat(BeginRecordChatRequest {
                        session_id: notes.session_id.clone(),
                        draft_id: uuid::Uuid::new_v4().to_string(),
                        record: ConversationRecord::TestCasesDraft {
                            record_id: draft.id.clone(),
                        },
                    })
                    .unwrap();
                let saved = service
                    .save_chat_composer(ChatComposerRequest {
                        scope: lifecycle::scope(&chat),
                        composer: "Please help".into(),
                        intent: ChatComposerIntent::Message,
                        mode: ChatMode::Chat,
                        attachment_ids: vec![],
                    })
                    .unwrap();
                request.scope = lifecycle::scope(&saved);
                let ChatTarget::Finding { mut snapshot } = request.context else {
                    unreachable!()
                };
                snapshot.record_id = draft.id;
                snapshot.record_kind = "testware".into();
                request.context = ChatTarget::TestCasesDraft { snapshot };
            }
            let findings_before = service.list_findings(&notes.session_id).unwrap();
            let drafts_before = service.list_drafts(&notes.session_id).unwrap();
            let prepared =
                lifecycle::prepare_with_images(&service, &request, &std::env::temp_dir()).unwrap();
            assert!(
                prepared
                    .input
                    .text()
                    .contains("For requested improvements or edits, use outcome kind edit")
            );
            let user = &prepared.started.chat.messages[0];
            let patch = with_patch.then(|| json!({"kind":if test_cases {"test_cases_draft"} else {"finding"},"title":"Literal suggested title"}));
            let completed = lifecycle::finish(&service, &prepared, ProviderGenerationOutput {
                model_report: None, exit_success: Some(true), stdout: vec![], stderr: vec![],
                assistant_text: Some(json!({"version":3,"requestId":user.id,"markdown":"Literal ordinary answer","outcome":if with_patch {json!({"kind":"edit","patch":patch})} else {json!({"kind":"answer"})}}).to_string()),
                output_format: GenerationOutputFormat::PlainText, cancelled: false,
            }).unwrap();
            assert_eq!(
                completed.messages.last().unwrap().text,
                "Literal ordinary answer"
            );
            assert_eq!(completed.proposals.len(), usize::from(with_patch));
            if with_patch {
                assert_eq!(
                    completed.proposals[0].after.title,
                    "Literal suggested title"
                );
            }
            assert!(
                completed
                    .messages
                    .last()
                    .unwrap()
                    .response
                    .as_ref()
                    .unwrap()
                    .warning
                    .is_none()
            );
            assert_eq!(
                service.list_findings(&notes.session_id).unwrap(),
                findings_before
            );
            assert_eq!(
                service.list_drafts(&notes.session_id).unwrap(),
                drafts_before
            );
            assert_eq!(service.load_chat(&notes.session_id).unwrap(), notes);
        }
    }
}
