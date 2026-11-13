use qa_scribe_core::domain::{
    RICH_BODY_JSON_MAX_LENGTH, TestCaseResult, TestRunCaseDraft, TestRunSummary,
};

const CASE_BODY: &str = r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Pay"}]}]}"#;

fn run_session(service: &SessionService, title: &str) -> qa_scribe_core::domain::Session {
    service
        .create_session(SessionDraft {
            title: title.to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created")
}

fn run_draft(
    service: &SessionService,
    session_id: &str,
    kind: DraftKind,
) -> qa_scribe_core::domain::Draft {
    service
        .create_draft(DraftCreate {
            session_id: session_id.to_string(),
            ai_run_id: None,
            kind,
            title: "Checkout cases".to_string(),
            body: String::new(),
            body_json: None,
            body_format: None,
            metadata_json: None,
        })
        .expect("draft should be created")
}

fn run_case(title: &str) -> TestRunCaseDraft {
    TestRunCaseDraft {
        group_title: None,
        title: title.to_string(),
        body_json: CASE_BODY.to_string(),
    }
}

fn run_cases(count: usize) -> Vec<TestRunCaseDraft> {
    (1..=count).map(|n| run_case(&format!("Case {n}"))).collect()
}

fn run_finding(service: &SessionService, session_id: &str) -> qa_scribe_core::domain::Finding {
    service
        .create_finding(FindingDraft {
            session_id: session_id.to_string(),
            title: "Card declined".to_string(),
            body: String::new(),
            body_json: None,
            body_format: None,
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .expect("finding should be created")
}

fn expect_validation<T: std::fmt::Debug>(result: qa_scribe_core::Result<T>, needle: &str) {
    match result {
        Err(QaScribeError::Validation(message)) => {
            assert!(message.contains(needle), "{message} should mention {needle}")
        }
        other => panic!("expected a validation error mentioning {needle}, got {other:?}"),
    }
}

/// Lets the next millisecond timestamp differ from the previous one.
fn next_millisecond() {
    std::thread::sleep(std::time::Duration::from_millis(5));
}

#[test]
fn start_test_run_copies_cases_in_order_with_session_and_title_from_the_draft() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = run_session(&service, "Checkout");
    let draft = run_draft(&service, &session.id, DraftKind::Testware);

    let run = service
        .start_test_run(
            &draft.id,
            vec![
                TestRunCaseDraft {
                    group_title: Some("  Payment ".to_string()),
                    title: "  Pay by card ".to_string(),
                    body_json: CASE_BODY.to_string(),
                },
                TestRunCaseDraft {
                    group_title: Some("   ".to_string()),
                    ..run_case("Pay by PayPal")
                },
                run_case("Refund"),
            ],
        )
        .expect("test run should start");

    assert_eq!(run.session_id, session.id);
    assert_eq!(run.draft_id, draft.id);
    assert_eq!(run.draft_title, "Checkout cases");
    assert_eq!(run.created_at, run.updated_at);
    let copied: Vec<_> = run
        .cases
        .iter()
        .map(|case| (case.position, case.group_title.as_deref(), case.title.as_str()))
        .collect();
    assert_eq!(
        copied,
        vec![
            (0, Some("Payment"), "Pay by card"),
            (1, None, "Pay by PayPal"),
            (2, None, "Refund"),
        ]
    );
    for case in &run.cases {
        assert_eq!(case.run_id, run.id);
        assert_eq!(case.body_json, CASE_BODY);
        assert_eq!(case.result, TestCaseResult::NotRun);
        assert_eq!((case.remark.as_deref(), case.finding_id.as_deref()), (None, None));
    }
    assert_eq!(service.get_test_run(&run.id).expect("run reads back"), run);

    // A later edit of the draft does not reach the frozen copy.
    service
        .database()
        .connection()
        .execute("UPDATE drafts SET title = 'Renamed' WHERE id = ?1", [&draft.id])
        .expect("draft title should update");
    assert_eq!(
        service.get_test_run(&run.id).expect("run reads back").draft_title,
        "Checkout cases"
    );
    assert!(matches!(
        service.get_test_run("missing"),
        Err(QaScribeError::NotFound(_))
    ));
}

#[test]
fn start_test_run_rejects_bad_drafts_and_cases_without_writing() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = run_session(&service, "Checkout");
    let draft = run_draft(&service, &session.id, DraftKind::Testware);
    let report = run_draft(&service, &session.id, DraftKind::SessionReport);

    expect_validation(
        service.start_test_run(&report.id, run_cases(1)),
        "Only a Test cases draft can start a test run",
    );
    assert!(matches!(
        service.start_test_run("missing", run_cases(1)),
        Err(QaScribeError::NotFound(_))
    ));
    expect_validation(service.start_test_run(&draft.id, Vec::new()), "at least one");
    expect_validation(service.start_test_run(&draft.id, run_cases(501)), "at most 500");
    expect_validation(
        service.start_test_run(&draft.id, vec![run_case("First"), run_case("   ")]),
        "Test case 2: Title is required",
    );
    expect_validation(
        service.start_test_run(&draft.id, vec![run_case(&"x".repeat(161))]),
        "Title must be at most 160",
    );
    expect_validation(
        service.start_test_run(
            &draft.id,
            vec![TestRunCaseDraft {
                group_title: Some("g".repeat(161)),
                ..run_case("Case")
            }],
        ),
        "Group title must be at most 160",
    );
    for body_json in ["{not json", "   "] {
        expect_validation(
            service.start_test_run(
                &draft.id,
                vec![TestRunCaseDraft {
                    body_json: body_json.to_string(),
                    ..run_case("Case")
                }],
            ),
            "Test case 1: rich body JSON",
        );
    }
    let oversized = format!("\"{}\"", "x".repeat(RICH_BODY_JSON_MAX_LENGTH));
    expect_validation(
        service.start_test_run(
            &draft.id,
            vec![TestRunCaseDraft {
                body_json: oversized,
                ..run_case("Case")
            }],
        ),
        "rich body JSON must be at most 500000 characters",
    );
    let large = format!("\"{}\"", "x".repeat(399_998));
    let large_cases = |count: usize| -> Vec<TestRunCaseDraft> {
        (0..count)
            .map(|_| TestRunCaseDraft {
                body_json: large.clone(),
                ..run_case("Case")
            })
            .collect()
    };
    expect_validation(
        service.start_test_run(&draft.id, large_cases(3)),
        "at most 1000000 characters of rich body JSON in total",
    );
    let connection = service.database().connection();
    assert_eq!(count_rows(connection, "test_runs"), 0);
    assert_eq!(count_rows(connection, "test_run_cases"), 0);

    // The limits themselves are allowed.
    service
        .start_test_run(&draft.id, large_cases(2))
        .expect("two large cases fit the total");
    let full = service
        .start_test_run(&draft.id, run_cases(500))
        .expect("500 cases fit");
    assert_eq!(full.cases.last().map(|case| case.position), Some(499));
}

#[test]
fn list_test_runs_is_newest_first_with_counts_per_result() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = run_session(&service, "Checkout");
    let draft = run_draft(&service, &session.id, DraftKind::Testware);
    let older = service
        .start_test_run(&draft.id, run_cases(4))
        .expect("first run starts");
    next_millisecond();
    let newer = service
        .start_test_run(&draft.id, run_cases(3))
        .expect("second run starts");
    for (case, result) in older.cases.iter().zip([
        TestCaseResult::Passed,
        TestCaseResult::Failed,
        TestCaseResult::Blocked,
    ]) {
        service
            .set_test_case_result(&case.id, result, None)
            .expect("result saves");
    }
    for case in &newer.cases[..2] {
        service
            .set_test_case_result(&case.id, TestCaseResult::Passed, None)
            .expect("result saves");
    }

    let summaries = service
        .list_test_runs(&session.id)
        .expect("runs should list");
    let counts: Vec<_> = summaries
        .iter()
        .map(|run| {
            (
                run.id.as_str(),
                run.total,
                run.passed,
                run.failed,
                run.blocked,
                run.not_run,
            )
        })
        .collect();
    assert_eq!(
        counts,
        vec![
            (newer.id.as_str(), 3, 2, 0, 0, 1),
            (older.id.as_str(), 4, 1, 1, 1, 1),
        ]
    );
    let TestRunSummary {
        session_id,
        draft_id,
        draft_title,
        created_at,
        ..
    } = summaries[0].clone();
    assert_eq!(
        (session_id, draft_id, draft_title, created_at),
        (session.id, draft.id, newer.draft_title, newer.created_at)
    );

    let other = run_session(&service, "Other");
    assert_eq!(service.list_test_runs(&other.id).expect("lists"), Vec::new());
    assert!(matches!(
        service.list_test_runs("missing"),
        Err(QaScribeError::NotFound(_))
    ));
}

#[test]
fn set_test_case_result_saves_a_trimmed_remark_and_bumps_the_run() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = run_session(&service, "Checkout");
    let draft = run_draft(&service, &session.id, DraftKind::Testware);
    let run = service
        .start_test_run(&draft.id, run_cases(2))
        .expect("run starts");
    let case_id = run.cases[1].id.clone();
    next_millisecond();

    let failed = service
        .set_test_case_result(&case_id, TestCaseResult::Failed, Some("  Card declined ".to_string()))
        .expect("result saves");
    assert_eq!(failed.result, TestCaseResult::Failed);
    assert_eq!(failed.remark.as_deref(), Some("Card declined"));
    let stored = service.get_test_run(&run.id).expect("run reads back");
    assert_eq!(stored.cases[1], failed);
    assert_eq!(stored.cases[0], run.cases[0]);
    assert!(stored.updated_at > run.updated_at);
    assert_eq!(stored.updated_at, failed.updated_at);
    assert_eq!(stored.created_at, run.created_at);

    let blank = service
        .set_test_case_result(&case_id, TestCaseResult::Blocked, Some("   ".to_string()))
        .expect("blank remark clears");
    assert_eq!((blank.result, blank.remark), (TestCaseResult::Blocked, None));

    let kept = service
        .set_test_case_result(&case_id, TestCaseResult::NotRun, Some("Retry later".to_string()))
        .expect("not run with a remark saves");
    assert_eq!(kept.remark.as_deref(), Some("Retry later"));
    let undone = service
        .set_test_case_result(&case_id, TestCaseResult::NotRun, None)
        .expect("undo saves");
    assert_eq!((undone.result, undone.remark), (TestCaseResult::NotRun, None));

    let at_limit = service
        .set_test_case_result(&case_id, TestCaseResult::Passed, Some("r".repeat(500)))
        .expect("500 characters fit");
    assert_eq!(at_limit.remark.map(|remark| remark.chars().count()), Some(500));
    expect_validation(
        service.set_test_case_result(&case_id, TestCaseResult::Passed, Some("r".repeat(501))),
        "Remark must be at most 500 characters",
    );
    assert!(matches!(
        service.set_test_case_result("missing", TestCaseResult::Passed, None),
        Err(QaScribeError::NotFound(_))
    ));
}

#[test]
fn link_test_case_finding_accepts_only_findings_of_the_same_session() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = run_session(&service, "Checkout");
    let draft = run_draft(&service, &session.id, DraftKind::Testware);
    let run = service
        .start_test_run(&draft.id, run_cases(1))
        .expect("run starts");
    let case_id = run.cases[0].id.clone();
    let finding = run_finding(&service, &session.id);
    let elsewhere = run_session(&service, "Elsewhere");
    let foreign = run_finding(&service, &elsewhere.id);
    next_millisecond();

    let linked = service
        .link_test_case_finding(&case_id, Some(finding.id.clone()))
        .expect("same-Session Finding links");
    assert_eq!(linked.finding_id.as_deref(), Some(finding.id.as_str()));
    let stored = service.get_test_run(&run.id).expect("run reads back");
    assert_eq!(stored.cases[0], linked);
    assert!(stored.updated_at > run.updated_at);

    expect_validation(
        service.link_test_case_finding(&case_id, Some(foreign.id)),
        "Test case Finding must belong to the test run's Session",
    );
    assert!(matches!(
        service.link_test_case_finding(&case_id, Some("missing".to_string())),
        Err(QaScribeError::NotFound(_))
    ));
    assert_eq!(
        service.get_test_run(&run.id).expect("run reads back").cases[0].finding_id,
        Some(finding.id)
    );

    let unlinked = service
        .link_test_case_finding(&case_id, None)
        .expect("unlinks");
    assert_eq!(unlinked.finding_id, None);
    assert!(matches!(
        service.link_test_case_finding("missing", None),
        Err(QaScribeError::NotFound(_))
    ));
}

#[test]
fn delete_test_run_removes_the_run_and_its_cases() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = run_session(&service, "Checkout");
    let draft = run_draft(&service, &session.id, DraftKind::Testware);
    let kept = service
        .start_test_run(&draft.id, run_cases(2))
        .expect("run starts");
    let deleted = service
        .start_test_run(&draft.id, run_cases(3))
        .expect("run starts");

    service.delete_test_run(&deleted.id).expect("run deletes");

    let connection = service.database().connection();
    assert_eq!(count_rows(connection, "test_runs"), 1);
    assert_eq!(count_rows(connection, "test_run_cases"), 2);
    assert_eq!(service.get_test_run(&kept.id).expect("kept run reads"), kept);
    assert!(matches!(
        service.delete_test_run(&deleted.id),
        Err(QaScribeError::NotFound(_))
    ));
}

#[test]
fn latest_test_runs_keeps_the_newest_run_of_each_draft_with_its_cases() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = run_session(&service, "Checkout");
    let other_session = run_session(&service, "Account");
    let first = run_draft(&service, &session.id, DraftKind::Testware);
    let second = run_draft(&service, &session.id, DraftKind::Testware);
    let elsewhere = run_draft(&service, &other_session.id, DraftKind::Testware);
    service
        .start_test_run(&first.id, run_cases(1))
        .expect("older run of the first draft starts");
    next_millisecond();
    let second_run = service
        .start_test_run(&second.id, run_cases(2))
        .expect("run of the second draft starts");
    next_millisecond();
    let first_newer = service
        .start_test_run(&first.id, run_cases(3))
        .expect("newer run of the first draft starts");
    service
        .start_test_run(&elsewhere.id, run_cases(1))
        .expect("run in another Session starts");

    let latest = service
        .latest_test_runs(&session.id)
        .expect("latest runs should read");

    let ids: Vec<_> = latest.iter().map(|run| run.id.as_str()).collect();
    assert_eq!(ids, [first_newer.id.as_str(), second_run.id.as_str()]);
    assert_eq!(latest[0].cases.len(), 3);
    assert_eq!(latest[1].cases.len(), 2);
    assert!(
        service
            .latest_test_runs(&run_session(&service, "Empty").id)
            .expect("a Session without runs reads")
            .is_empty()
    );
}
