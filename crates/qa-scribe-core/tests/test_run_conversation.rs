//! A test run owns a read-only conversation: it reads the run's current report
//! and never proposes or accepts a change.

use qa_scribe_core::{
    QaScribeError,
    chat::{
        MAX_CHAT_TEST_RUN_REPORT_BYTES, TEST_RUN_REPORT_TRUNCATED_MARKER, bounded_test_run_report,
    },
    domain::*,
    services::SessionService,
};
use serde_json::json;

const CASE_BODY: &str =
    r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Pay"}]}]}"#;

struct Fixture {
    service: SessionService,
    session_id: String,
    draft_id: String,
    run: TestRun,
}

fn case(group: Option<&str>, title: &str) -> TestRunCaseDraft {
    TestRunCaseDraft {
        group_title: group.map(str::to_string),
        title: title.into(),
        body_json: CASE_BODY.into(),
    }
}

/// A run of four cases: one without a group, then two groups.
fn fixture() -> Fixture {
    let service = SessionService::in_memory().unwrap();
    let session_id = service
        .create_session(SessionDraft {
            title: "Checkout".into(),
            ..Default::default()
        })
        .unwrap()
        .id;
    let draft_id = service
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
        .unwrap()
        .id;
    let run = service
        .start_test_run(
            &draft_id,
            vec![
                case(None, "Open the shop"),
                case(Some("Cards"), "Pay by card"),
                case(Some("Gift cards"), "Pay with a gift card"),
                case(Some("Cards"), "Pay by saved card"),
            ],
        )
        .unwrap();
    Fixture {
        service,
        session_id,
        draft_id,
        run,
    }
}

fn reference() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn begin(f: &Fixture) -> ChatState {
    f.service
        .begin_test_run_chat(BeginTestRunChatRequest {
            session_id: f.session_id.clone(),
            draft_id: reference(),
            run_id: f.run.id.clone(),
        })
        .unwrap()
}

fn scope(chat: &ChatState) -> ChatRevision {
    ChatRevision {
        session_id: chat.session_id.clone(),
        draft_id: chat.draft_id.clone(),
        expected_revision: chat.revision,
    }
}

fn write(f: &Fixture, chat: &ChatState, text: &str) -> ChatState {
    f.service
        .save_chat_composer(ChatComposerRequest {
            scope: scope(chat),
            composer: text.into(),
            mode: chat.mode,
            attachment_ids: vec![],
            intent: ChatComposerIntent::Message,
        })
        .unwrap()
}

fn start(
    f: &Fixture,
    chat: &ChatState,
    intent: ChatRequestIntent,
) -> Result<ChatTurnStarted, QaScribeError> {
    f.service.start_chat_turn_with_response(
        ChatStartRequest { scope: scope(chat) },
        ChatTarget::Session,
        intent,
    )
}

fn validation_message<T: std::fmt::Debug>(result: Result<T, QaScribeError>) -> String {
    match result {
        Err(QaScribeError::Validation(message)) => message,
        other => panic!("expected a validation error, got {other:?}"),
    }
}

#[test]
fn a_test_run_conversation_begins_only_for_a_run_of_the_session() {
    let f = fixture();
    let id = reference();
    let request = BeginTestRunChatRequest {
        session_id: f.session_id.clone(),
        draft_id: id.clone(),
        run_id: f.run.id.clone(),
    };
    let chat = f.service.begin_test_run_chat(request.clone()).unwrap();
    assert_eq!(
        chat.owner,
        ConversationOwner::TestRun {
            session_id: f.session_id.clone(),
            run_id: f.run.id.clone()
        }
    );
    assert_eq!(
        f.service.begin_test_run_chat(request).unwrap(),
        chat,
        "a launch replays"
    );
    let draft_owner = f.service.begin_record_chat(BeginRecordChatRequest {
        session_id: f.session_id.clone(),
        draft_id: id,
        record: ConversationRecord::TestCasesDraft {
            record_id: f.draft_id.clone(),
        },
    });
    assert_eq!(
        validation_message(draft_owner),
        "Launch ID belongs to another conversation owner"
    );

    let missing = f.service.begin_test_run_chat(BeginTestRunChatRequest {
        session_id: f.session_id.clone(),
        draft_id: reference(),
        run_id: "missing".into(),
    });
    assert_eq!(
        validation_message(missing),
        "This test run no longer exists."
    );
    let other = f
        .service
        .create_session(SessionDraft {
            title: "Other".into(),
            ..Default::default()
        })
        .unwrap();
    let foreign = f.service.begin_test_run_chat(BeginTestRunChatRequest {
        session_id: other.id,
        draft_id: reference(),
        run_id: f.run.id.clone(),
    });
    assert_eq!(
        validation_message(foreign),
        "The test run must belong to the Session"
    );
    let history = f
        .service
        .list_chat_history(ChatHistoryScope::Session {
            session_id: f.session_id.clone(),
        })
        .unwrap();
    assert_eq!(
        history
            .iter()
            .filter(|row| matches!(row.owner, ConversationOwner::TestRun { .. }))
            .count(),
        1
    );
}

#[test]
fn the_report_lists_totals_and_every_case_with_its_current_result() {
    let f = fixture();
    let finding = f
        .service
        .create_finding(FindingDraft {
            session_id: f.session_id.clone(),
            title: "Gift card refused".into(),
            body: String::new(),
            body_json: None,
            body_format: None,
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .unwrap();
    let cases = &f.run.cases;
    f.service
        .set_test_case_result(&cases[0].id, TestCaseResult::Passed, None)
        .unwrap();
    f.service
        .set_test_case_result(&cases[1].id, TestCaseResult::Passed, None)
        .unwrap();
    f.service
        .set_test_case_result(
            &cases[2].id,
            TestCaseResult::Failed,
            Some("The gift card was refused.".into()),
        )
        .unwrap();
    f.service
        .link_test_case_finding(&cases[2].id, Some(finding.id))
        .unwrap();
    let report = f.service.test_run_report(&f.session_id, &f.run.id).unwrap();
    let (heading, rest) = report.split_once('\n').unwrap();
    assert_eq!(heading, "## Test run: Checkout payments");
    let (started, rest) = rest.split_once("\n\n").unwrap();
    assert!(
        started.ends_with(" UTC") && started.starts_with("20"),
        "{started}"
    );
    assert_eq!(
        rest,
        "2 passed, 1 failed, 0 blocked, 1 not run\n\n\
         - Passed: Open the shop\n\n\
         ### Cards\n- Passed: Pay by card\n- Not run: Pay by saved card\n\n\
         ### Gift cards\n- Failed: Pay with a gift card\n  Remark: The gift card was refused.\n  Finding: Gift card refused"
    );
    f.service
        .set_test_case_result(&cases[2].id, TestCaseResult::Blocked, None)
        .unwrap();
    let changed = f.service.test_run_report(&f.session_id, &f.run.id).unwrap();
    assert!(
        changed.contains("2 passed, 0 failed, 1 blocked, 1 not run"),
        "the report reads stored results"
    );
    assert!(changed.contains("- Blocked: Pay with a gift card\n  Finding: Gift card refused"));
}

#[test]
fn a_long_report_is_cut_after_a_whole_line_and_marked() {
    let short = "## Test run: Short\n- Passed: One";
    assert_eq!(bounded_test_run_report(short), short);
    let line = format!(
        "- Failed: {}\n  Remark: {}",
        "t".repeat(150),
        "é".repeat(240)
    );
    let long = (0..500)
        .map(|_| line.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let bounded = bounded_test_run_report(&long);
    assert!(bounded.len() <= MAX_CHAT_TEST_RUN_REPORT_BYTES);
    let kept = bounded
        .strip_suffix(TEST_RUN_REPORT_TRUNCATED_MARKER)
        .expect("the cut is marked");
    assert!(
        long.starts_with(kept) && long[kept.len()..].starts_with('\n'),
        "cut at a line end"
    );
}

#[test]
fn a_test_run_conversation_never_offers_or_accepts_a_change() {
    let f = fixture();
    let chat = write(&f, &begin(&f), "Post the results to PAY-12");
    for intent in [
        ChatRequestIntent::RefineRecord,
        ChatRequestIntent::DraftJira,
    ] {
        assert!(
            start(&f, &chat, intent).is_err(),
            "no record intent on a test run"
        );
    }
    let snapshot = RecordContextSnapshot {
        session_id: f.session_id.clone(),
        record_id: f.draft_id.clone(),
        title: "Checkout payments".into(),
        document_json: json!({"schemaVersion":1,"doc":{"type":"doc","content":[]}}).to_string(),
        metadata_json: None,
        record_kind: "testware".into(),
        origin: RecordSnapshotOrigin::Saved,
        local_fingerprint: String::new(),
        stored_base_token: String::new(),
    };
    let record_context = f.service.start_chat_turn_with_response(
        ChatStartRequest {
            scope: scope(&chat),
        },
        ChatTarget::TestCasesDraft { snapshot },
        ChatRequestIntent::Message,
    );
    assert_eq!(
        validation_message(record_context),
        "A test run conversation cannot carry record context"
    );

    let started = start(&f, &chat, ChatRequestIntent::Message).unwrap();
    let user = started.chat.messages.last().unwrap().clone();
    let contract = f.service.response_contract(&user.id).unwrap().unwrap();
    assert_eq!(contract.purpose(), ChatResponsePurpose::Conversation);
    assert_eq!(contract.version(), 2);
    let reply = json!({"version":2,"requestId":user.id,"markdown":"Marked every case as passed.",
        "refinement":{"kind":"test_cases_draft","title":"Rewritten","bodyMarkdown":"- Passed: everything"}});
    let finished = f
        .service
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            assistant_text: reply.to_string(),
        })
        .unwrap();
    assert!(finished.proposals.is_empty(), "no proposal for a test run");
    let rows: i64 = f
        .service
        .database()
        .connection()
        .query_row("SELECT COUNT(*) FROM chat_refinements", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(rows, 0);
    let response = finished.messages.last().unwrap().response.clone().unwrap();
    assert_eq!(
        response.warning.as_deref(),
        Some("This response is retained as text without interactive choices.")
    );
    let run = f.service.get_test_run(&f.run.id).unwrap();
    assert!(
        run.cases
            .iter()
            .all(|case| case.result == TestCaseResult::NotRun),
        "results are untouched"
    );
}

#[test]
fn a_deleted_run_fails_a_new_turn_and_a_retry_cleanly() {
    let f = fixture();
    let chat = write(&f, &begin(&f), "Summarize the run");
    let started = start(&f, &chat, ChatRequestIntent::Message).unwrap();
    let failed = f
        .service
        .fail_chat_turn(ChatFailRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            kind: ChatFailureKind::Failed,
            error_message: "Provider failed".into(),
        })
        .unwrap();
    f.service.delete_draft(&f.draft_id).unwrap();

    let message = "This test run no longer exists.";
    let retry = f.service.retry_chat_turn(ChatStartRequest {
        scope: scope(&failed),
    });
    assert_eq!(validation_message(retry), message);
    let report = f.service.test_run_report(&f.session_id, &f.run.id);
    assert_eq!(validation_message(report), message);
    let reread = f
        .service
        .read_chat(&ChatRef {
            session_id: f.session_id.clone(),
            draft_id: chat.draft_id.clone(),
        })
        .unwrap();
    assert_eq!(
        reread.revision, failed.revision,
        "a refused retry changes nothing"
    );
    let next = write(&f, &reread, "Anything else?");
    assert_eq!(
        validation_message(start(&f, &next, ChatRequestIntent::Message)),
        message
    );
    assert_eq!(
        f.service
            .read_chat(&ChatRef {
                session_id: f.session_id.clone(),
                draft_id: chat.draft_id
            })
            .unwrap()
            .messages
            .len(),
        1
    );
}
