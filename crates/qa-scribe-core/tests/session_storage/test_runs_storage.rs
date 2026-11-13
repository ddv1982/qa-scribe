fn schema_objects(connection: &rusqlite::Connection) -> Vec<(String, String)> {
    connection
        .prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name")
        .expect("schema query should prepare")
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .expect("schema query should run")
        .collect::<rusqlite::Result<_>>()
        .expect("schema rows should read")
}

fn started_run(service: &SessionService) -> qa_scribe_core::domain::TestRun {
    let session = run_session(service, "Checkout");
    let draft = run_draft(service, &session.id, DraftKind::Testware);
    service
        .start_test_run(&draft.id, run_cases(2))
        .expect("run starts")
}

#[test]
fn deleting_the_draft_or_the_session_deletes_its_test_runs() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let by_draft = started_run(&service);
    let by_session = started_run(&service);
    let survivor = started_run(&service);
    let connection = service.database().connection();
    assert_eq!(count_rows(connection, "test_run_cases"), 6);

    service.delete_draft(&by_draft.draft_id).expect("draft deletes");
    assert!(matches!(
        service.get_test_run(&by_draft.id),
        Err(QaScribeError::NotFound(_))
    ));
    assert_eq!(count_rows(connection, "test_run_cases"), 4);

    service
        .delete_session(&by_session.session_id)
        .expect("session deletes");
    assert!(matches!(
        service.get_test_run(&by_session.id),
        Err(QaScribeError::NotFound(_))
    ));
    assert_eq!(count_rows(connection, "test_runs"), 1);
    assert_eq!(count_rows(connection, "test_run_cases"), 2);
    assert_eq!(
        service.get_test_run(&survivor.id).expect("survivor reads"),
        survivor
    );
    assert_no_foreign_key_violations(connection);
}

#[test]
fn deleting_a_finding_unlinks_its_test_cases() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let run = started_run(&service);
    let finding = run_finding(&service, &run.session_id);
    service
        .link_test_case_finding(&run.cases[0].id, Some(finding.id.clone()))
        .expect("links");

    service.delete_finding(&finding.id).expect("finding deletes");

    let stored = service.get_test_run(&run.id).expect("run survives");
    assert_eq!(stored.cases.len(), 2);
    assert_eq!(stored.cases[0].finding_id, None);
    assert_eq!(stored.cases[0].finding_title, None);
}

#[test]
fn every_case_read_carries_the_current_title_of_its_linked_finding() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let run = started_run(&service);
    let titles = |cases: &[qa_scribe_core::domain::TestRunCase]| {
        cases
            .iter()
            .map(|case| case.finding_title.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(titles(&run.cases), [None, None], "start_test_run");
    let finding = run_finding(&service, &run.session_id);
    let case_id = run.cases[0].id.clone();

    let linked = service
        .link_test_case_finding(&case_id, Some(finding.id.clone()))
        .expect("links");
    assert_eq!(linked.finding_title.as_deref(), Some("Card declined"));
    let failed = service
        .set_test_case_result(&case_id, TestCaseResult::Failed, None)
        .expect("result saves");
    assert_eq!(failed.finding_title.as_deref(), Some("Card declined"));
    let stored = service.get_test_run(&run.id).expect("run reads back");
    assert_eq!(titles(&stored.cases), [Some("Card declined".to_string()), None]);
    let latest = service
        .latest_test_runs(&run.session_id)
        .expect("latest runs read");
    assert_eq!(titles(&latest[0].cases), titles(&stored.cases));

    // The title is read, not stored: a renamed Finding shows its new title.
    service
        .update_finding(
            &finding.id,
            FindingPatch {
                title: Some("Gift card declined".to_string()),
                ..FindingPatch::default()
            },
            qa_scribe_core::domain::RecordWriteGuard::finding(&finding),
        )
        .expect("finding renames")
        .into_saved()
        .expect("rename is saved");
    let renamed = service.get_test_run(&run.id).expect("run reads back");
    assert_eq!(renamed.cases[0].finding_title.as_deref(), Some("Gift card declined"));

    let unlinked = service
        .link_test_case_finding(&case_id, None)
        .expect("unlinks");
    assert_eq!(unlinked.finding_title, None);
}

#[test]
fn the_database_locks_the_copied_text_of_a_test_run() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let run = started_run(&service);
    let connection = service.database().connection();
    let case_id = &run.cases[0].id;

    for set in [
        "title = 'Changed'",
        "body_json = '{}'",
        "position = 7",
        "group_title = 'Group'",
        "run_id = run_id",
    ] {
        let error = connection
            .execute(&format!("UPDATE test_run_cases SET {set} WHERE id = ?1"), [case_id])
            .expect_err("copied text must not change");
        assert!(
            error.to_string().contains("Test run case text is immutable"),
            "{set}: {error}"
        );
    }
    for set in [
        "draft_title = 'Changed'",
        "session_id = session_id",
        "draft_id = draft_id",
        "created_at = 'later'",
    ] {
        let error = connection
            .execute(&format!("UPDATE test_runs SET {set} WHERE id = ?1"), [&run.id])
            .expect_err("run source must not change");
        assert!(
            error.to_string().contains("Test run source is immutable"),
            "{set}: {error}"
        );
    }

    connection
        .execute(
            "UPDATE test_run_cases SET result = 'passed', remark = 'ok', updated_at = 'later' WHERE id = ?1",
            [case_id],
        )
        .expect("results stay editable");
    connection
        .execute("UPDATE test_runs SET updated_at = 'later' WHERE id = ?1", [&run.id])
        .expect("run updated_at stays editable");
    assert!(
        connection
            .execute("UPDATE test_run_cases SET result = 'skipped' WHERE id = ?1", [case_id])
            .is_err(),
        "result keeps its check below the domain type"
    );
    let stored = service.get_test_run(&run.id).expect("run reads back");
    assert_eq!(stored.cases[0].title, run.cases[0].title);
    assert_eq!(stored.cases[0].result, TestCaseResult::Passed);
}

#[test]
fn schema_21_database_gains_empty_test_runs_and_keeps_its_data() {
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let database_path = temp_dir.join("schema-21.sqlite");
    {
        let connection =
            rusqlite::Connection::open(&database_path).expect("legacy database should open");
        connection
            .execute_batch(include_str!("../fixtures/schema_v21.sql"))
            .expect("schema 21 fixture should load");
        connection
            .execute_batch(
                "INSERT INTO sessions (id, title, created_at, updated_at, last_opened_at,
                    timebox_minutes, acceptance_criteria)
                 VALUES ('s', 'Legacy', 't1', 't2', 't3', 45, 'AC-1 Pay');
                 INSERT INTO entries (id, session_id, type, body, created_at, updated_at)
                 VALUES ('n', 's', 'note', 'Legacy Note', 't', 't');
                 INSERT INTO drafts (id, session_id, kind, title, body, body_json, created_at, updated_at)
                 VALUES ('d', 's', 'testware', 'Legacy cases', '', '{\"type\":\"doc\"}', 't', 't');
                 INSERT INTO findings (id, session_id, title, body, kind, created_at, updated_at)
                 VALUES ('f', 's', 'Legacy bug', 'Broken', 'bug', 't', 't');",
            )
            .expect("legacy rows should insert");
    }

    let service =
        SessionService::new(Database::open(&database_path).expect("database should migrate"))
            .expect("session service should construct");
    let connection = service.database().connection();
    let user_version: i32 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("user_version should read");
    assert_eq!(user_version, SCHEMA_VERSION);
    assert_eq!(SCHEMA_VERSION, 23);
    assert_no_foreign_key_violations(connection);

    let session = service
        .get_session("s")
        .expect("query should succeed")
        .expect("legacy session survives");
    assert_eq!(
        (
            session.title.as_str(),
            session.timebox_minutes,
            session.acceptance_criteria.as_deref()
        ),
        ("Legacy", Some(45), Some("AC-1 Pay"))
    );
    let drafts = service.list_drafts("s").expect("drafts list");
    assert_eq!(drafts.len(), 1);
    assert_eq!(
        (drafts[0].title.as_str(), drafts[0].body_json.as_deref()),
        ("Legacy cases", Some("{\"type\":\"doc\"}"))
    );
    let findings = service.list_findings("s").expect("findings list");
    assert_eq!(
        findings
            .iter()
            .map(|finding| (finding.id.as_str(), finding.body.as_str()))
            .collect::<Vec<_>>(),
        vec![("f", "Broken")]
    );
    assert_eq!(count_rows(connection, "entries"), 1);
    assert_eq!(count_rows(connection, "test_runs"), 0);
    assert_eq!(count_rows(connection, "test_run_cases"), 0);

    // The migrated schema is exactly what a fresh database gets.
    let fresh = Database::in_memory().expect("fresh database should open");
    assert_eq!(schema_objects(connection), schema_objects(fresh.connection()));

    let run = service
        .start_test_run("d", run_cases(1))
        .expect("migrated draft starts a run");
    service
        .link_test_case_finding(&run.cases[0].id, Some("f".to_string()))
        .expect("migrated finding links");

    drop(service);
    // Reopening a current database runs no migration and keeps the run.
    let service =
        SessionService::new(Database::open(&database_path).expect("database should reopen"))
            .expect("session service should construct");
    assert_eq!(
        service.get_test_run(&run.id).expect("run survives").cases[0]
            .finding_id
            .as_deref(),
        Some("f")
    );
    drop(service);
    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}

#[test]
fn schema_22_database_lets_a_test_run_own_a_conversation_and_keeps_its_data() {
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let database_path = temp_dir.join("schema-22.sqlite");
    {
        let connection =
            rusqlite::Connection::open(&database_path).expect("legacy database should open");
        connection
            .execute_batch(include_str!("../fixtures/schema_v22.sql"))
            .expect("schema 22 fixture should load");
        connection
            .execute_batch(
                "INSERT INTO sessions (id, title, created_at, updated_at, last_opened_at)
                 VALUES ('s', 'Legacy', 't1', 't2', 't3');
                 INSERT INTO drafts (id, session_id, kind, title, body, created_at, updated_at)
                 VALUES ('d', 's', 'testware', 'Legacy cases', '', 't', 't');
                 INSERT INTO test_runs (id, session_id, draft_id, draft_title, created_at, updated_at)
                 VALUES ('r', 's', 'd', 'Legacy cases', 't', 't');
                 INSERT INTO test_run_cases (id, run_id, position, title, body_json, result, remark, updated_at)
                 VALUES ('c', 'r', 0, 'Pay', '{}', 'failed', 'Refused', 't');
                 INSERT INTO chat_drafts (id, session_id, owner_kind, owner_record_id, created_at)
                 VALUES ('chat', 's', 'test_cases_draft', 'd', 't');",
            )
            .expect("legacy rows should insert");
        assert!(
            connection
                .execute("INSERT INTO chat_drafts (id, session_id, owner_kind, owner_record_id, created_at) VALUES ('early', 's', 'test_run', 'r', 't')", [])
                .is_err(),
            "schema 22 has no test run owner"
        );
    }

    let service =
        SessionService::new(Database::open(&database_path).expect("database should migrate"))
            .expect("session service should construct");
    let connection = service.database().connection();
    let user_version: i32 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("user_version should read");
    assert_eq!((user_version, SCHEMA_VERSION), (23, 23));
    assert_no_foreign_key_violations(connection);
    let fresh = Database::in_memory().expect("fresh database should open");
    assert_eq!(schema_objects(connection), schema_objects(fresh.connection()));

    let run = service.get_test_run("r").expect("legacy run survives");
    assert_eq!(
        (run.cases[0].result, run.cases[0].remark.as_deref()),
        (TestCaseResult::Failed, Some("Refused"))
    );
    assert_eq!(count_rows(connection, "chat_drafts"), 1);
    let insert = |id: &str, kind: &str, owner: Option<&str>| {
        connection.execute(
            "INSERT INTO chat_drafts (id, session_id, owner_kind, owner_record_id, created_at) VALUES (?1, 's', ?2, ?3, 't')",
            rusqlite::params![id, kind, owner],
        )
    };
    insert("run-chat", "test_run", Some("r")).expect("a test run owns a conversation");
    for (id, kind, owner) in [
        ("blank", "test_run", Some(" ")),
        ("missing", "test_run", None),
        ("unknown", "test_runs", Some("r")),
        ("notes-with-id", "notes", Some("r")),
    ] {
        assert!(insert(id, kind, owner).is_err(), "{kind} {owner:?} must be rejected");
    }
    drop(service);
    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}
