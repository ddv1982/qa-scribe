use super::*;
use qa_scribe_core::ai::GenerationOutputFormat;

const MESSAGE_BYTES: usize = 16_384;

fn setup() -> (SessionService, StartChatJobRequest) {
    let service = SessionService::in_memory().unwrap();
    let session = service
        .create_session(SessionDraft {
            title: "Chat boundary tests".into(),
            ..Default::default()
        })
        .unwrap();
    let chat = service.load_chat(&session.id).unwrap();
    let chat = composer(&service, &chat, "Q");
    (
        service,
        StartChatJobRequest {
            refine: false,
            context: ChatTarget::Session,
            scope: scope(&chat),
            retry: false,
            provider: AiProvider::ClaudeCode,
            model: "sonnet".into(),
            reasoning_effort: None,
        },
    )
}

fn composer(service: &SessionService, chat: &ChatState, text: &str) -> ChatState {
    service
        .save_chat_composer(ChatComposerRequest {
            attachment_ids: vec![],
            scope: scope(chat),
            composer: text.into(),
            mode: ChatMode::Chat,
        })
        .unwrap()
}

fn output(text: &str) -> ProviderGenerationOutput {
    ProviderGenerationOutput {
        model_report: None,
        exit_success: Some(true),
        stdout: Vec::new(),
        stderr: Vec::new(),
        assistant_text: Some(text.into()),
        output_format: GenerationOutputFormat::ClaudeStreamJson,
        cancelled: false,
    }
}

#[test]
fn r20_01_oversized_assistant_cannot_complete_run_or_poison_future_replay() {
    for text in ["x".repeat(MESSAGE_BYTES + 1), "é".repeat(8_193)] {
        let (service, mut request) = setup();
        let prepared = prepare(&service, &request).unwrap();
        let original_run = service.get_ai_run(&prepared.ai_run.id).unwrap().unwrap();
        assert!(finish(&service, &prepared, output(&text)).is_err());
        assert_eq!(
            service.load_chat(&request.scope.session_id).unwrap(),
            prepared.started.chat
        );
        assert_eq!(
            service.get_ai_run(&prepared.ai_run.id).unwrap().unwrap(),
            original_run
        );
        let failed = fail(
            &service,
            &prepared,
            ChatFailureKind::Failed,
            "Response exceeded limit",
        )
        .unwrap();
        request.scope = scope(&failed);
        request.retry = true;
        let retried = prepare(&service, &request).unwrap();
        assert_eq!(retried.started.chat.messages.len(), 1);
        assert_eq!(
            retried.started.chat.messages[0].id,
            prepared.started.chat.messages[0].id
        );
        let completed = finish(&service, &retried, output("Valid A")).unwrap();
        let saved = composer(&service, &completed, "Next Q");
        request.scope = scope(&saved);
        request.retry = false;
        let next = prepare(&service, &request).unwrap();
        assert!(next.input.text().contains("Valid A"));
        assert!(next.input.text().contains("Next Q"));
        assert!(!next.input.text().contains(&text));
    }
}

#[test]
fn r20_01_exact_utf8_assistant_boundary_remains_replayable() {
    for text in ["x".repeat(MESSAGE_BYTES), "é".repeat(8_192)] {
        let (service, mut request) = setup();
        let prepared = prepare(&service, &request).unwrap();
        let completed = finish(&service, &prepared, output(&text)).unwrap();
        assert_eq!(completed.messages[1].text, text);
        assert_eq!(
            service
                .get_ai_run(&prepared.ai_run.id)
                .unwrap()
                .unwrap()
                .status,
            AiRunStatus::Completed
        );
        let saved = composer(&service, &completed, "Next Q");
        request.scope = scope(&saved);
        let next = prepare(&service, &request).unwrap();
        assert!(next.input.text().contains(&text));
        assert!(next.input.text().contains("Next Q"));
    }
}

#[test]
fn r20_01_shell_completion_aggregate_counts_failed_history_and_is_atomic() {
    let (service, mut request) = setup();
    let mut chat = service.load_chat(&request.scope.session_id).unwrap();
    for _ in 0..7 {
        let saved = composer(&service, &chat, &"x".repeat(MESSAGE_BYTES));
        request.scope = scope(&saved);
        let prepared = prepare(&service, &request).unwrap();
        chat = fail(
            &service,
            &prepared,
            ChatFailureKind::Failed,
            "Provider failed",
        )
        .unwrap();
    }
    let saved = composer(&service, &chat, "Q");
    request.scope = scope(&saved);
    let prepared = prepare(&service, &request).unwrap();
    let original_run = service.get_ai_run(&prepared.ai_run.id).unwrap().unwrap();
    assert!(finish(&service, &prepared, output(&"a".repeat(MESSAGE_BYTES))).is_err());
    assert_eq!(
        service.load_chat(&request.scope.session_id).unwrap(),
        prepared.started.chat
    );
    assert_eq!(
        service.get_ai_run(&prepared.ai_run.id).unwrap().unwrap(),
        original_run
    );
    let exact = finish(&service, &prepared, output(&"a".repeat(MESSAGE_BYTES - 1))).unwrap();
    assert_eq!(
        exact.messages.iter().map(|m| m.text.len()).sum::<usize>(),
        131_072
    );
}

#[test]
fn r20_02_shell_rejects_oversized_send_before_user_or_run_creation() {
    for text in ["x".repeat(MESSAGE_BYTES + 1), "é".repeat(8_193)] {
        let (service, mut request) = setup();
        let chat = service.load_chat(&request.scope.session_id).unwrap();
        let saved = composer(&service, &chat, &text);
        request.scope = scope(&saved);
        assert!(prepare(&service, &request).is_err());
        assert_eq!(service.load_chat(&request.scope.session_id).unwrap(), saved);
        let count: i64 = service
            .database()
            .connection()
            .query_row(
                "SELECT count(*) FROM ai_runs WHERE session_id = ?1",
                [&request.scope.session_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }
}

#[test]
fn r20_02_shell_failed_history_limit_rejects_send_without_creating_another_run() {
    let (service, mut request) = setup();
    let mut chat = service.load_chat(&request.scope.session_id).unwrap();
    for _ in 0..127 {
        let saved = composer(&service, &chat, "Q");
        request.scope = scope(&saved);
        let prepared = prepare(&service, &request).unwrap();
        chat = fail(
            &service,
            &prepared,
            ChatFailureKind::Failed,
            "Provider failed",
        )
        .unwrap();
    }
    let saved = composer(&service, &chat, "Keep unsent");
    request.scope = scope(&saved);
    assert!(prepare(&service, &request).is_err());
    assert_eq!(service.load_chat(&request.scope.session_id).unwrap(), saved);
    let runs: i64 = service
        .database()
        .connection()
        .query_row(
            "SELECT count(*) FROM ai_runs WHERE session_id = ?1",
            [&request.scope.session_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(runs, 127);
}
