use super::*;
use qa_scribe_core::ai::{GenerationOutputFormat, ProviderGenerationOutput};
use serde_json::json;

fn output(text: String) -> ProviderGenerationOutput {
    ProviderGenerationOutput {
        model_report: None,
        exit_success: Some(true),
        stdout: vec![],
        stderr: vec![],
        assistant_text: Some(text),
        output_format: GenerationOutputFormat::CodexJsonl,
        cancelled: false,
    }
}

#[test]
fn conversation_ownership_question_replies_pin_the_original_record_snapshot() {
    for direct in [false, true] {
        let (service, notes, record, mut request) = super::conversation_ownership_tests::fixture();
        let saved = service
            .save_chat_composer(ChatComposerRequest {
                scope: lifecycle::scope(&record),
                composer: "Draft content".into(),
                intent: ChatComposerIntent::DraftJira,
                mode: ChatMode::Chat,
                attachment_ids: vec![],
            })
            .unwrap();
        request.scope = lifecycle::scope(&saved);
        let prepared =
            lifecycle::prepare_with_images(&service, &request, &std::env::temp_dir()).unwrap();
        let original = prepared.started.chat.messages[0].context.clone();
        let user_id = &prepared.started.chat.messages[0].id;
        let chat = lifecycle::finish(&service, &prepared, output(json!({"version":2,"requestId":user_id,"markdown":"Record-specific draft","question":{"prompt":"Which type?","choices":["Finding subtask","Bug"]}}).to_string())).unwrap();
        assert_eq!(chat.messages[1].text, "Record-specific draft");
        let assistant_id = chat.messages[1].id.clone();
        let saved = service
            .save_chat_composer(ChatComposerRequest {
                scope: lifecycle::scope(&chat),
                composer: if direct { "" } else { "Finding subtask" }.into(),
                intent: ChatComposerIntent::Message,
                mode: ChatMode::Chat,
                attachment_ids: vec![],
            })
            .unwrap();
        request.scope = lifecycle::scope(&saved);
        if direct {
            request.intent = ChatSendIntent::QuestionReply {
                assistant_message_id: assistant_id.clone(),
                text: "Finding subtask".into(),
            };
        }
        if let ChatTarget::Finding { snapshot } = &mut request.context {
            snapshot.title = "New editor contents".into();
        }
        let reply =
            lifecycle::prepare_with_images(&service, &request, &std::env::temp_dir()).unwrap();
        let message = reply.started.chat.messages.last().unwrap();
        assert_eq!(message.text, "Finding subtask");
        assert_eq!(message.context, original);
        assert_eq!(
            message.answer.as_ref().unwrap().assistant_message_id,
            assistant_id
        );
        assert_eq!(
            service
                .response_contract(&message.id)
                .unwrap()
                .unwrap()
                .purpose(),
            ChatResponsePurpose::JiraDrafting
        );
        assert_eq!(service.load_chat(&notes.session_id).unwrap(), notes);
    }
}
