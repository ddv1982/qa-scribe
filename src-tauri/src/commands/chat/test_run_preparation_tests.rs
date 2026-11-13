use qa_scribe_core::{QaScribeError, services::SessionService};

use super::*;

/// A Session with a Test cases draft, a test run of two cases with one result
/// recorded, and the conversation that run owns with a message written.
fn fixture() -> (SessionService, ChatState, TestRun, std::path::PathBuf) {
    let service = SessionService::in_memory().unwrap();
    let session_id = service
        .create_session(SessionDraft {
            title: "Run preparation".into(),
            ..Default::default()
        })
        .unwrap()
        .id;
    let draft = service
        .create_draft(DraftCreate {
            session_id: session_id.clone(),
            ai_run_id: None,
            kind: DraftKind::Testware,
            title: "Checkout payments".into(),
            body: String::new(),
            body_json: None,
            body_format: None,
            metadata_json: None,
        })
        .unwrap();
    let body = r#"{"type":"doc","content":[]}"#;
    let run = service
        .start_test_run(
            &draft.id,
            ["Pay by card", "Pay with a gift card"]
                .map(|title| TestRunCaseDraft {
                    group_title: None,
                    title: title.into(),
                    body_json: body.into(),
                })
                .to_vec(),
        )
        .unwrap();
    service
        .set_test_case_result(
            &run.cases[1].id,
            TestCaseResult::Failed,
            Some("Refused 7731".into()),
        )
        .unwrap();
    let chat = service
        .begin_test_run_chat(BeginTestRunChatRequest {
            session_id: session_id.clone(),
            draft_id: uuid::Uuid::new_v4().to_string(),
            run_id: run.id.clone(),
        })
        .unwrap();
    let chat = compose(&service, &chat, "Post these results to PAY-12");
    let dir = std::env::temp_dir().join(format!("qa-run-preparation-{}", uuid::Uuid::new_v4()));
    (service, chat, run, dir)
}

fn compose(service: &SessionService, chat: &ChatState, text: &str) -> ChatState {
    service
        .save_chat_composer(ChatComposerRequest {
            scope: lifecycle::scope(chat),
            composer: text.into(),
            mode: chat.mode,
            attachment_ids: vec![],
            intent: ChatComposerIntent::Message,
        })
        .unwrap()
}

fn request(chat: &ChatState, intent: ChatSendIntent) -> StartChatJobRequest {
    StartChatJobRequest {
        intent,
        context: ChatTarget::Session,
        scope: lifecycle::scope(chat),
        provider: AiProvider::CodexCli,
        model: "fixture".into(),
        reasoning_effort: None,
    }
}

fn prompt(prepared: &lifecycle::PreparedChat) -> String {
    serde_json::to_string(&prepared.input.content_blocks(AiProvider::CodexCli)).unwrap()
}

#[test]
fn each_turn_carries_the_current_run_report_and_the_read_only_rule() {
    let (service, chat, run, dir) = fixture();
    let first =
        lifecycle::prepare_with_images(&service, &request(&chat, ChatSendIntent::Composer), &dir)
            .unwrap();
    let text = prompt(&first);
    assert!(text.contains("TEST_RUN_REPORT_JSON"), "{text}");
    assert!(
        text.contains("Results and remarks cannot be changed from this conversation"),
        "{text}"
    );
    assert!(
        text.contains("0 passed, 1 failed, 0 blocked, 1 not run"),
        "{text}"
    );
    assert!(text.contains("- Failed: Pay with a gift card"), "{text}");
    assert!(text.contains("Remark: Refused 7731"), "{text}");
    assert_eq!(
        first.started.chat.messages[0].context,
        ChatTarget::Session,
        "no record snapshot"
    );
    assert!(text.contains("No refinement field"), "{text}");

    let finished = service
        .finish_chat_turn_with_ai_run(
            ChatFinishRequest {
                scope: lifecycle::scope(&first.started.chat),
                turn_id: first.started.turn_id.clone(),
                assistant_text: "Posted.".into(),
            },
            &first.ai_run.id,
        )
        .unwrap();
    service
        .set_test_case_result(&run.cases[0].id, TestCaseResult::Passed, None)
        .unwrap();
    let chat = compose(&service, &finished, "And now?");
    let second =
        lifecycle::prepare_with_images(&service, &request(&chat, ChatSendIntent::Composer), &dir)
            .unwrap();
    assert!(prompt(&second).contains("1 passed, 1 failed, 0 blocked, 0 not run"));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_deleted_run_fails_preparing_a_turn_and_a_retry_without_new_state() {
    let (service, chat, run, dir) = fixture();
    let started =
        lifecycle::prepare_with_images(&service, &request(&chat, ChatSendIntent::Composer), &dir)
            .unwrap();
    let failed = service
        .fail_chat_turn_with_ai_run(
            ChatFailRequest {
                scope: lifecycle::scope(&started.started.chat),
                turn_id: started.started.turn_id.clone(),
                kind: ChatFailureKind::Failed,
                error_message: "Provider failed".into(),
            },
            &started.ai_run.id,
        )
        .unwrap();
    service.delete_draft(&run.draft_id).unwrap();
    let runs = |service: &SessionService| -> i64 {
        service
            .database()
            .connection()
            .query_row("SELECT count(*) FROM ai_runs", [], |row| row.get(0))
            .unwrap()
    };
    let before = runs(&service);
    let message = |result: qa_scribe_core::Result<lifecycle::PreparedChat>| match result {
        Err(QaScribeError::Validation(message)) => message,
        Err(other) => panic!("expected a validation error, got {other:?}"),
        Ok(_) => panic!("a deleted run must not prepare a turn"),
    };
    assert_eq!(
        message(lifecycle::prepare_with_images(
            &service,
            &request(&failed, ChatSendIntent::Retry),
            &dir
        )),
        "This test run no longer exists."
    );
    let next = compose(&service, &failed, "Anything else?");
    assert_eq!(
        message(lifecycle::prepare_with_images(
            &service,
            &request(&next, ChatSendIntent::Composer),
            &dir
        )),
        "This test run no longer exists."
    );
    let reread = service
        .read_chat(&ChatRef {
            session_id: next.session_id.clone(),
            draft_id: next.draft_id.clone(),
        })
        .unwrap();
    assert_eq!(
        (reread.messages.len(), reread.revision, runs(&service)),
        (1, next.revision, before)
    );
    assert_eq!(
        reread.composer, "Anything else?",
        "the typed message is kept"
    );
    let _ = std::fs::remove_dir_all(dir);
}
