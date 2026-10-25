use super::*;
use qa_scribe_core::{
    ai::{GenerationOutputFormat, ProviderGenerationOutput},
    services::SessionService,
};
use serde_json::json;

fn setup() -> (SessionService, StartChatJobRequest) {
    let service = SessionService::in_memory().unwrap();
    let session = service
        .create_session(SessionDraft {
            title: "Jira preflight".into(),
            ..Default::default()
        })
        .unwrap();
    let record = service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Original source".into(),
            body: "Original receipt evidence".into(),
            body_json: None,
            body_format: None,
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .unwrap();
    let chat = service.load_chat(&session.id).unwrap();
    let context = ChatTarget::Finding {
        snapshot: RecordContextSnapshot {
            session_id: session.id,
            record_id: record.id,
            title: record.title,
            document_json: json!({"schemaVersion":1,"doc":{"type":"doc","content":[]}}).to_string(),
            metadata_json: None,
            record_kind: "bug".into(),
            origin: RecordSnapshotOrigin::Saved,
            local_fingerprint: String::new(),
            stored_base_token: String::new(),
        },
    };
    (
        service,
        StartChatJobRequest {
            scope: lifecycle::scope(&chat),
            intent: ChatRequestIntent::DraftJira,
            context,
            provider: AiProvider::CodexCli,
            model: "fixture".into(),
            reasoning_effort: None,
        },
    )
}
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
fn question_preflight_commit_and_provider_input_share_the_original_snapshot() {
    let (service, mut request) = setup();
    let initial =
        lifecycle::prepare_with_images(&service, &request, &std::env::temp_dir()).unwrap();
    let original = initial.started.chat.messages[0].context.clone();
    let id = &initial.started.chat.messages[0].id;
    let chat=lifecycle::finish(&service,&initial,output(json!({"version":2,"requestId":id,"markdown":"Original draft","question":{"prompt":"Type?","choices":["Finding subtask","Other"]}}).to_string())).unwrap();
    request.scope = lifecycle::scope(&chat);
    request.intent = ChatRequestIntent::QuestionReply {
        assistant_message_id: chat.messages.last().unwrap().id.clone(),
        text: "Finding subtask".into(),
    };
    if let ChatTarget::Finding { snapshot } = &mut request.context {
        snapshot.title = "Newer local title".into();
    }
    let reply = lifecycle::prepare_with_images(&service, &request, &std::env::temp_dir()).unwrap();
    assert_eq!(
        reply.started.chat.messages.last().unwrap().context,
        original
    );
    assert_eq!(
        reply.started.chat.messages.last().unwrap().text,
        "Finding subtask"
    );
    assert!(reply.input.text().contains("Original source"));
    assert!(!reply.input.text().contains("Newer local title"));
    assert!(reply.input.text().contains("Type?"));
    assert!(reply.started.chat.messages.last().unwrap().answer.is_some());
}
#[test]
fn wrong_nonce_preserves_readable_text_only_after_successful_associated_completion() {
    let (service, request) = setup();
    let prepared =
        lifecycle::prepare_with_images(&service, &request, &std::env::temp_dir()).unwrap();
    let chat=lifecycle::finish(&service,&prepared,output(json!({"version":2,"requestId":"wrong","markdown":"Please clarify the receipt requirement.","question":{"prompt":"Wrong","choices":["Create"]}}).to_string())).unwrap();
    assert_eq!(
        chat.messages.last().unwrap().text,
        "Please clarify the receipt requirement."
    );
    assert!(
        chat.messages
            .last()
            .unwrap()
            .response
            .as_ref()
            .unwrap()
            .question
            .is_none()
    );
    assert_eq!(
        service
            .get_ai_run(&prepared.ai_run.id)
            .unwrap()
            .unwrap()
            .status,
        AiRunStatus::Completed
    );
}
