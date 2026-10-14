use super::*;
use crate::jobs::{GenerationJobState, JobStore};
use qa_scribe_core::ai::GenerationOutputFormat;

fn setup() -> (SessionService, StartChatJobRequest) {
    let service = SessionService::in_memory().unwrap();
    let session = service
        .create_session(SessionDraft {
            title: "Chat shell test".into(),
            ..Default::default()
        })
        .unwrap();
    let chat = service.load_chat(&session.id).unwrap();
    let chat = service
        .save_chat_composer(ChatComposerRequest {
            scope: scope(&chat),
            composer: "Actual behavior differs".into(),
            mode: ChatMode::Chat,
        })
        .unwrap();
    (
        service,
        StartChatJobRequest {
            scope: scope(&chat),
            retry: false,
            provider: AiProvider::ClaudeCode,
            model: "sonnet".into(),
            reasoning_effort: Some("high".into()),
        },
    )
}

fn output(text: &str) -> ProviderGenerationOutput {
    ProviderGenerationOutput {
        exit_success: Some(true),
        stdout: Vec::new(),
        stderr: Vec::new(),
        assistant_text: Some(text.into()),
        output_format: GenerationOutputFormat::ClaudeStreamJson,
        cancelled: false,
    }
}

#[test]
fn preparation_persists_user_and_durable_attribution_before_execution() {
    let (service, request) = setup();
    let prepared = prepare(&service, &request).unwrap();
    let chat = service.load_chat(&request.scope.session_id).unwrap();
    assert_eq!(chat.messages.len(), 1);
    assert_eq!(chat.messages[0].status, ChatTurnStatus::Running);
    assert!(chat.composer.is_empty());
    let run = service.get_ai_run(&prepared.ai_run.id).unwrap().unwrap();
    assert_eq!(run.provider, request.provider);
    assert_eq!(run.reasoning_effort, request.reasoning_effort);
    assert_eq!(run.prompt_version, CHAT_PROMPT_VERSION);
    assert_eq!(chat.messages[0].ai_run_id.as_deref(), Some(run.id.as_str()));
    assert_eq!(prepared.started.chat, chat);
    assert!(
        prepare(
            &service,
            &StartChatJobRequest {
                scope: scope(&chat),
                ..request
            }
        )
        .is_err()
    );
}

#[test]
fn finalizer_preserves_composer_and_mode_changed_during_execution_without_testware() {
    let (service, request) = setup();
    let prepared = prepare(&service, &request).unwrap();
    let chat = service
        .save_chat_composer(ChatComposerRequest {
            scope: scope(&prepared.started.chat),
            composer: "Next question".into(),
            mode: ChatMode::WriteNote,
        })
        .unwrap();
    let finished = finish(&service, &prepared, output("What did you expect?")).unwrap();
    assert_eq!(finished.composer, chat.composer);
    assert_eq!(finished.mode, ChatMode::WriteNote);
    assert_eq!(finished.messages.len(), 2);
    assert!(
        finished
            .messages
            .iter()
            .all(|message| message.status == ChatTurnStatus::Completed)
    );
    assert!(
        finished
            .messages
            .iter()
            .all(|message| message.ai_run_id.as_deref() == Some(prepared.ai_run.id.as_str()))
    );
    assert_eq!(
        service
            .get_ai_run(&prepared.ai_run.id)
            .unwrap()
            .unwrap()
            .status,
        AiRunStatus::Completed
    );
    assert!(
        service
            .list_drafts(&request.scope.session_id)
            .unwrap()
            .is_empty()
    );
    assert!(
        service
            .list_findings(&request.scope.session_id)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn oversized_send_preserves_composer_without_persisting_user() {
    let (service, request) = setup();
    let chat = service.load_chat(&request.scope.session_id).unwrap();
    let chat = service
        .save_chat_composer(ChatComposerRequest {
            scope: scope(&chat),
            composer: "x".repeat(qa_scribe_core::chat::MAX_CHAT_MESSAGE_BYTES + 1),
            mode: ChatMode::Chat,
        })
        .unwrap();
    assert!(
        prepare(
            &service,
            &StartChatJobRequest {
                scope: scope(&chat),
                ..request.clone()
            }
        )
        .is_err()
    );
    let current = service.load_chat(&request.scope.session_id).unwrap();
    assert_eq!(current, chat);
    assert!(current.messages.is_empty());
}

#[test]
fn cancellation_gate_suppresses_late_assistant_and_finishes_user_terminal() {
    let (service, request) = setup();
    let prepared = prepare(&service, &request).unwrap();
    let jobs = JobStore::default();
    let (_, control) = jobs
        .insert_generation_job(
            "job".into(),
            request.scope.session_id.clone(),
            "chat".into(),
        )
        .unwrap();
    jobs.mark_running("job", prepared.ai_run.id.clone(), "Running")
        .unwrap();
    jobs.cancel("job").unwrap();
    assert!(
        control
            .run_if_not_cancelled(|| finish(&service, &prepared, output("Late answer")))
            .unwrap()
            .is_none()
    );
    fail(
        &service,
        &prepared,
        ChatFailureKind::Cancelled,
        "Generation cancelled.",
    )
    .unwrap();
    assert_eq!(
        jobs.mark_cancelled("job").unwrap().state,
        GenerationJobState::Cancelled
    );
    let chat = service.load_chat(&request.scope.session_id).unwrap();
    assert_eq!(chat.messages.len(), 1);
    assert_eq!(chat.messages[0].status, ChatTurnStatus::Cancelled);
    assert_eq!(
        chat.messages[0].ai_run_id.as_deref(),
        Some(prepared.ai_run.id.as_str())
    );
    assert_eq!(
        service
            .get_ai_run(&prepared.ai_run.id)
            .unwrap()
            .unwrap()
            .status,
        AiRunStatus::Failed
    );
}

#[test]
fn omitted_retry_defaults_to_false_on_the_bridge() {
    let (_, request) = setup();
    let decoded: StartChatJobRequest = serde_json::from_value(serde_json::json!({
        "scope": request.scope, "provider": "claude_code", "model": "sonnet", "reasoningEffort": null,
    })).unwrap();
    assert!(!decoded.retry);
}

#[test]
fn retry_reuses_failed_user_message_and_associates_new_run() {
    let (service, mut request) = setup();
    let initial = prepare(&service, &request).unwrap();
    let chat = fail(
        &service,
        &initial,
        ChatFailureKind::Failed,
        "Provider unavailable",
    )
    .unwrap();
    request.scope = scope(&chat);
    request.retry = true;
    let retried = prepare(&service, &request).unwrap();
    assert_eq!(retried.started.chat.messages.len(), 1);
    assert_eq!(
        retried.started.chat.messages[0].id,
        initial.started.chat.messages[0].id
    );
    assert_eq!(
        retried.started.chat.messages[0].text,
        initial.started.chat.messages[0].text
    );
    assert_ne!(retried.started.turn_id, initial.started.turn_id);
    assert_ne!(retried.ai_run.id, initial.ai_run.id);
    assert_eq!(
        retried.started.chat.messages[0].ai_run_id.as_deref(),
        Some(retried.ai_run.id.as_str())
    );
    assert_eq!(
        service
            .get_ai_run(&initial.ai_run.id)
            .unwrap()
            .unwrap()
            .status,
        AiRunStatus::Failed
    );
    let chat = finish(&service, &retried, output("What did you expect?")).unwrap();
    assert_eq!(chat.messages.len(), 2);
    assert_eq!(
        service
            .get_ai_run(&retried.ai_run.id)
            .unwrap()
            .unwrap()
            .status,
        AiRunStatus::Completed
    );
}

#[test]
fn reported_model_validation_failure_does_not_partially_complete_turn() {
    let (service, request) = setup();
    let prepared = prepare(&service, &request).unwrap();
    let mut response = output("Assistant answer");
    response.stdout = serde_json::to_vec(&serde_json::json!({
        "type": "system", "subtype": "init", "model": "x".repeat(241),
    }))
    .unwrap();
    assert!(finish(&service, &prepared, response).is_err());
    let chat = service.load_chat(&request.scope.session_id).unwrap();
    assert_eq!(chat.messages.len(), 1);
    assert_eq!(chat.messages[0].status, ChatTurnStatus::Running);
    let run = service.get_ai_run(&prepared.ai_run.id).unwrap().unwrap();
    assert_eq!(run.status, AiRunStatus::Running);
    assert_eq!(run.model, request.model);
    let chat = fail(
        &service,
        &prepared,
        ChatFailureKind::Failed,
        "Invalid reported model",
    )
    .unwrap();
    assert_eq!(chat.messages[0].status, ChatTurnStatus::Failed);
    assert_eq!(
        service
            .get_ai_run(&prepared.ai_run.id)
            .unwrap()
            .unwrap()
            .status,
        AiRunStatus::Failed
    );
}

#[test]
fn next_prompt_excludes_failed_turns_but_keeps_completed_pairs() {
    let (service, mut request) = setup();
    let failed = prepare(&service, &request).unwrap();
    let chat = fail(
        &service,
        &failed,
        ChatFailureKind::Failed,
        "Provider unavailable",
    )
    .unwrap();
    let chat = service
        .save_chat_composer(ChatComposerRequest {
            scope: scope(&chat),
            composer: "Completed user".into(),
            mode: ChatMode::Chat,
        })
        .unwrap();
    request.scope = scope(&chat);
    let completed = prepare(&service, &request).unwrap();
    let chat = finish(&service, &completed, output("Completed assistant")).unwrap();
    let chat = service
        .save_chat_composer(ChatComposerRequest {
            scope: scope(&chat),
            composer: "Latest user".into(),
            mode: ChatMode::Chat,
        })
        .unwrap();
    request.scope = scope(&chat);
    let next = prepare(&service, &request).unwrap();
    assert!(!next.prompt.contains("Actual behavior differs"));
    assert!(next.prompt.contains("Completed user"));
    assert!(next.prompt.contains("Completed assistant"));
    assert!(next.prompt.contains("Latest user"));
}
