const CRITERIA: &str = "AC-1 Empty street shows an error\nSHOP-412 Postcode is validated";

#[test]
fn acceptance_criteria_save_read_back_and_clear() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = sheet_session(&service);
    assert_eq!(session.acceptance_criteria, None);

    let saved = service
        .update_session(
            &session.id,
            SessionPatch {
                acceptance_criteria: Some(Some(CRITERIA.to_string())),
                ..SessionPatch::default()
            },
        )
        .expect("criteria should save");
    assert_eq!(saved.acceptance_criteria.as_deref(), Some(CRITERIA));
    assert_eq!(
        service.list_sessions().expect("sessions should list")[0],
        saved
    );

    // The rest of the sheet leaves the criteria alone.
    let sheeted = service
        .update_session(&session.id, full_sheet())
        .expect("sheet should save");
    assert_eq!(sheeted.acceptance_criteria.as_deref(), Some(CRITERIA));

    let cleared = service
        .update_session(
            &session.id,
            SessionPatch {
                acceptance_criteria: Some(None),
                ..SessionPatch::default()
            },
        )
        .expect("criteria should clear");
    assert_eq!(cleared.acceptance_criteria, None);
    assert_eq!(cleared.timebox_minutes, Some(45));
}

#[test]
fn acceptance_criteria_are_limited_to_eight_thousand_characters() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = sheet_session(&service);
    let patch = |length: usize| SessionPatch {
        acceptance_criteria: Some(Some(format!("AC-1 {}", "x".repeat(length - 5)))),
        ..SessionPatch::default()
    };

    let at_limit = service
        .update_session(&session.id, patch(8_000))
        .expect("8000 characters fit");
    assert_eq!(
        at_limit
            .acceptance_criteria
            .map(|text| text.chars().count()),
        Some(8_000)
    );
    match service.update_session(&session.id, patch(8_001)) {
        Err(QaScribeError::Validation(message)) => assert!(
            message.contains("Acceptance criteria must be at most 8000 characters"),
            "{message}"
        ),
        other => panic!("expected a validation error, got {other:?}"),
    }
}

#[test]
fn schema_20_database_gains_empty_acceptance_criteria_and_keeps_its_sheet() {
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let database_path = temp_dir.join("schema-20.sqlite");
    {
        let connection =
            rusqlite::Connection::open(&database_path).expect("legacy database should open");
        connection
            .execute_batch(include_str!("../fixtures/schema_v20.sql"))
            .expect("schema 20 fixture should load");
        connection
            .execute_batch(
                "INSERT INTO sessions (id, title, session_context, objective_notes, environment,
                    build_version, related_reference, created_at, updated_at, last_opened_at,
                    timebox_minutes, debrief_notes, testing_percent, bug_percent, setup_percent)
                 VALUES ('s', 'Legacy', 'Context', 'Explore login', 'staging', '1.2', 'QA-7',
                    't1', 't2', 't3', 45, 'Login covered', 60, 25, 15);
                 INSERT INTO entries (id, session_id, type, body, created_at, updated_at)
                 VALUES ('n', 's', 'note', 'Legacy Note', 't', 't');",
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
    assert_no_foreign_key_violations(connection);

    let session = service
        .get_session("s")
        .expect("query should succeed")
        .expect("legacy session survives");
    assert_eq!(
        session,
        qa_scribe_core::domain::Session {
            id: "s".to_string(),
            title: "Legacy".to_string(),
            session_context: Some("Context".to_string()),
            objective_notes: Some("Explore login".to_string()),
            environment: Some("staging".to_string()),
            build_version: Some("1.2".to_string()),
            related_reference: Some("QA-7".to_string()),
            timebox_minutes: Some(45),
            debrief_notes: Some("Login covered".to_string()),
            testing_percent: Some(60),
            bug_percent: Some(25),
            setup_percent: Some(15),
            acceptance_criteria: None,
            created_at: "t1".to_string(),
            updated_at: "t2".to_string(),
            last_opened_at: "t3".to_string(),
        }
    );
    assert_eq!(count_rows(connection, "entries"), 1);

    let saved = service
        .update_session(
            "s",
            SessionPatch {
                acceptance_criteria: Some(Some(CRITERIA.to_string())),
                ..SessionPatch::default()
            },
        )
        .expect("migrated session takes criteria");
    assert_eq!(saved.acceptance_criteria.as_deref(), Some(CRITERIA));
    assert_eq!(saved.debrief_notes.as_deref(), Some("Login covered"));

    drop(service);
    // Reopening a current database runs no migration and keeps the criteria.
    let service =
        SessionService::new(Database::open(&database_path).expect("database should reopen"))
            .expect("session service should construct");
    assert_eq!(
        service
            .get_session("s")
            .expect("query")
            .expect("session")
            .acceptance_criteria
            .as_deref(),
        Some(CRITERIA)
    );
    drop(service);
    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}
