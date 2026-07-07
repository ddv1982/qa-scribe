#[test]
fn fail_ai_run_truncates_oversized_error_messages_instead_of_rejecting_them() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Oversized failure message".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let ai_run = service
        .create_ai_run(AiRunCreate {
            session_id: session.id.clone(),
            generation_context_id: None,
            provider: AiProvider::CodexCli,
            model: "gpt-test".to_string(),
            reasoning_effort: None,
            prompt_version: "session-report-v1".to_string(),
        })
        .expect("AI Run should be created");

    let huge_message = "e".repeat(10_000);
    let failed = service
        .fail_ai_run(&ai_run.id, &huge_message)
        .expect("fail_ai_run must never reject on message length or content");
    assert_eq!(failed.status.as_str(), "failed");
    let stored_message = failed
        .error_message
        .expect("failed AI Run should retain an error message");
    assert_eq!(stored_message.len(), 2_000);
    assert_eq!(stored_message, "e".repeat(2_000));
}

#[test]
fn fail_ai_run_substitutes_a_placeholder_for_a_blank_message() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Blank failure message".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let ai_run = service
        .create_ai_run(AiRunCreate {
            session_id: session.id.clone(),
            generation_context_id: None,
            provider: AiProvider::CodexCli,
            model: "gpt-test".to_string(),
            reasoning_effort: None,
            prompt_version: "session-report-v1".to_string(),
        })
        .expect("AI Run should be created");

    let failed = service
        .fail_ai_run(&ai_run.id, "   \n\t  ")
        .expect("fail_ai_run must never reject on a blank message");
    assert_eq!(failed.status.as_str(), "failed");
    assert_eq!(
        failed.error_message.as_deref(),
        Some("Provider reported no error detail.")
    );
}

#[test]
fn complete_ai_run_after_fail_is_rejected() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Complete after fail".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let ai_run = service
        .create_ai_run(AiRunCreate {
            session_id: session.id.clone(),
            generation_context_id: None,
            provider: AiProvider::CodexCli,
            model: "gpt-test".to_string(),
            reasoning_effort: None,
            prompt_version: "session-report-v1".to_string(),
        })
        .expect("AI Run should be created");

    service
        .fail_ai_run(&ai_run.id, "provider unavailable")
        .expect("AI Run should fail");

    let result = service.complete_ai_run(&ai_run.id);
    assert!(
        matches!(result, Err(QaScribeError::Validation(_))),
        "completing an already-failed AI Run must be rejected, got {result:?}"
    );

    // The rejected transition must not have clobbered the failed state.
    let unchanged = service
        .get_ai_run(&ai_run.id)
        .expect("AI Run lookup should succeed")
        .expect("AI Run should still exist");
    assert_eq!(unchanged.status.as_str(), "failed");
    assert_eq!(
        unchanged.error_message.as_deref(),
        Some("provider unavailable")
    );
}

#[test]
fn double_complete_ai_run_is_rejected() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Double complete".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let ai_run = service
        .create_ai_run(AiRunCreate {
            session_id: session.id.clone(),
            generation_context_id: None,
            provider: AiProvider::CodexCli,
            model: "gpt-test".to_string(),
            reasoning_effort: None,
            prompt_version: "session-report-v1".to_string(),
        })
        .expect("AI Run should be created");

    service
        .complete_ai_run(&ai_run.id)
        .expect("first completion should succeed");

    let result = service.complete_ai_run(&ai_run.id);
    assert!(
        matches!(result, Err(QaScribeError::Validation(_))),
        "completing an AI Run twice must be rejected, got {result:?}"
    );
}

#[test]
fn complete_or_fail_missing_ai_run_returns_not_found() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let missing_id = "does-not-exist";
    assert!(matches!(
        service.complete_ai_run(missing_id),
        Err(QaScribeError::NotFound(id)) if id == missing_id
    ));
    assert!(matches!(
        service.fail_ai_run(missing_id, "boom"),
        Err(QaScribeError::NotFound(id)) if id == missing_id
    ));
}

#[test]
fn sweep_flips_only_running_ai_runs_to_failed() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Sweep orphaned runs".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");

    let make_run = || {
        service
            .create_ai_run(AiRunCreate {
                session_id: session.id.clone(),
                generation_context_id: None,
                provider: AiProvider::CodexCli,
                model: "gpt-test".to_string(),
                reasoning_effort: None,
                prompt_version: "session-report-v1".to_string(),
            })
            .expect("AI Run should be created")
    };

    let still_running = make_run();
    let to_complete = make_run();
    let to_fail = make_run();

    service
        .complete_ai_run(&to_complete.id)
        .expect("AI Run should complete");
    service
        .fail_ai_run(&to_fail.id, "provider unavailable")
        .expect("AI Run should fail");

    let swept = service
        .fail_orphaned_running_ai_runs()
        .expect("sweep should succeed");
    assert_eq!(swept, 1);

    let swept_run = service
        .get_ai_run(&still_running.id)
        .expect("AI Run lookup should succeed")
        .expect("AI Run should still exist");
    assert_eq!(swept_run.status.as_str(), "failed");
    assert_eq!(
        swept_run.error_message.as_deref(),
        Some("Interrupted: application closed during generation.")
    );

    let completed_run = service
        .get_ai_run(&to_complete.id)
        .expect("AI Run lookup should succeed")
        .expect("AI Run should still exist");
    assert_eq!(completed_run.status.as_str(), "completed");

    let failed_run = service
        .get_ai_run(&to_fail.id)
        .expect("AI Run lookup should succeed")
        .expect("AI Run should still exist");
    assert_eq!(failed_run.status.as_str(), "failed");
    assert_eq!(
        failed_run.error_message.as_deref(),
        Some("provider unavailable")
    );

    // Sweeping again should be a no-op now that nothing is running.
    let swept_again = service
        .fail_orphaned_running_ai_runs()
        .expect("second sweep should succeed");
    assert_eq!(swept_again, 0);
}

#[test]
fn reopening_the_database_sweeps_ai_runs_left_running_by_a_crash() {
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let db_path = temp_dir.join("qa-scribe.sqlite");

    let ai_run_id = {
        let service = SessionService::new(Database::open(&db_path).expect("database should open"))
            .expect("session service should construct");
        let session = service
            .create_session(SessionDraft {
                title: "Crash before completion".to_string(),
                ..SessionDraft::default()
            })
            .expect("session should be created");
        let ai_run = service
            .create_ai_run(AiRunCreate {
                session_id: session.id,
                generation_context_id: None,
                provider: AiProvider::CodexCli,
                model: "gpt-test".to_string(),
                reasoning_effort: None,
                prompt_version: "session-report-v1".to_string(),
            })
            .expect("AI Run should be created");
        // Service (and its Database/Connection) is dropped here without ever
        // completing or failing the AI Run, simulating the app being killed
        // mid-generation.
        ai_run.id
    };

    let reopened = SessionService::new(Database::open(&db_path).expect("database should reopen"))
        .expect("session service should construct on reopen");
    let recovered = reopened
        .get_ai_run(&ai_run_id)
        .expect("AI Run lookup should succeed")
        .expect("AI Run should still exist");
    assert_eq!(recovered.status.as_str(), "failed");
    assert_eq!(
        recovered.error_message.as_deref(),
        Some("Interrupted: application closed during generation.")
    );

    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}

#[test]
fn orphan_ai_run_sweep_uses_running_status_index() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let connection = service.database().connection();

    let index_sql: String = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_ai_runs_running_status'",
            [],
            |row| row.get(0),
        )
        .expect("running AI Run index should exist");
    assert!(
        index_sql.contains("WHERE status = 'running'"),
        "running AI Run index should be partial, got {index_sql}"
    );

    let plan = explain_query_plan(
        connection,
        "EXPLAIN QUERY PLAN
         UPDATE ai_runs
         SET status = 'failed', error_message = 'Interrupted', completed_at = '2026-06-24T10:00:00.000Z'
         WHERE status = 'running'",
    );
    assert!(
        plan.iter()
            .any(|detail| detail.contains("idx_ai_runs_running_status")),
        "orphan AI Run sweep should use the running-status index, got {plan:?}"
    );
}

fn explain_query_plan(connection: &rusqlite::Connection, sql: &str) -> Vec<String> {
    let mut statement = connection
        .prepare(sql)
        .expect("EXPLAIN QUERY PLAN should prepare");
    statement
        .query_map([], |row| row.get::<_, String>(3))
        .expect("EXPLAIN QUERY PLAN should run")
        .collect::<std::result::Result<Vec<_>, _>>()
        .expect("EXPLAIN QUERY PLAN rows should read")
}
