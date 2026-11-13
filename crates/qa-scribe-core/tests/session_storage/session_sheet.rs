fn sheet_session(service: &SessionService) -> qa_scribe_core::domain::Session {
    service
        .create_session(SessionDraft {
            title: "Checkout".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created")
}

fn full_sheet() -> SessionPatch {
    SessionPatch {
        objective_notes: Some(Some(
            " Explore checkout to find payment failures ".to_string(),
        )),
        related_reference: Some(Some("SHOP-42".to_string())),
        timebox_minutes: Some(Some(45)),
        debrief_notes: Some(Some("PayPal covered".to_string())),
        testing_percent: Some(Some(60)),
        bug_percent: Some(Some(25)),
        setup_percent: Some(Some(15)),
        ..SessionPatch::default()
    }
}

#[test]
fn session_sheet_saves_reads_back_and_clears() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = sheet_session(&service);
    assert_eq!(session.timebox_minutes, None);
    assert_eq!(session.debrief_notes, None);
    assert_eq!(session.testing_percent, None);

    let saved = service
        .update_session(&session.id, full_sheet())
        .expect("sheet should save");
    assert_eq!(saved.title, "Checkout");
    assert_eq!(
        saved.objective_notes.as_deref(),
        Some("Explore checkout to find payment failures")
    );
    assert_eq!(saved.related_reference.as_deref(), Some("SHOP-42"));
    assert_eq!(saved.timebox_minutes, Some(45));
    assert_eq!(saved.debrief_notes.as_deref(), Some("PayPal covered"));
    assert_eq!(
        (
            saved.testing_percent,
            saved.bug_percent,
            saved.setup_percent
        ),
        (Some(60), Some(25), Some(15))
    );
    assert_eq!(
        service.list_sessions().expect("sessions should list")[0],
        saved
    );

    // A title-only patch leaves the sheet alone.
    let renamed = service
        .update_session(
            &session.id,
            SessionPatch {
                title: Some("Checkout again".to_string()),
                ..SessionPatch::default()
            },
        )
        .expect("title should save");
    assert_eq!(renamed.timebox_minutes, Some(45));

    let cleared = service
        .update_session(
            &session.id,
            SessionPatch {
                objective_notes: Some(None),
                related_reference: Some(Some("   ".to_string())),
                timebox_minutes: Some(None),
                debrief_notes: Some(None),
                testing_percent: Some(None),
                bug_percent: Some(None),
                setup_percent: Some(None),
                ..SessionPatch::default()
            },
        )
        .expect("sheet should clear");
    assert_eq!(cleared.objective_notes, None);
    assert_eq!(cleared.related_reference, None);
    assert_eq!(cleared.timebox_minutes, None);
    assert_eq!(cleared.debrief_notes, None);
    assert_eq!(
        (
            cleared.testing_percent,
            cleared.bug_percent,
            cleared.setup_percent
        ),
        (None, None, None)
    );
}

#[test]
fn session_sheet_rejects_invalid_timebox_split_and_long_debrief() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = sheet_session(&service);

    let rejected = [
        SessionPatch {
            timebox_minutes: Some(Some(0)),
            ..SessionPatch::default()
        },
        SessionPatch {
            timebox_minutes: Some(Some(1_441)),
            ..SessionPatch::default()
        },
        SessionPatch {
            testing_percent: Some(Some(100)),
            ..SessionPatch::default()
        },
        SessionPatch {
            testing_percent: Some(Some(60)),
            bug_percent: Some(Some(30)),
            setup_percent: Some(Some(5)),
            ..SessionPatch::default()
        },
        SessionPatch {
            debrief_notes: Some(Some("x".repeat(2_001))),
            ..SessionPatch::default()
        },
    ];
    for patch in rejected {
        match service.update_session(&session.id, patch.clone()) {
            Err(QaScribeError::Validation(_)) => {}
            other => panic!("expected a validation error for {patch:?}, got {other:?}"),
        }
    }
    let unchanged = service
        .get_session(&session.id)
        .expect("query should succeed")
        .expect("session exists");
    assert_eq!(unchanged, session);

    // Clearing one percent of a saved split would leave it partial.
    service
        .update_session(&session.id, full_sheet())
        .expect("sheet should save");
    assert!(matches!(
        service.update_session(
            &session.id,
            SessionPatch {
                bug_percent: Some(None),
                ..SessionPatch::default()
            },
        ),
        Err(QaScribeError::Validation(_))
    ));
}

#[test]
fn schema_19_database_gains_an_empty_session_sheet_and_keeps_its_data() {
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let database_path = temp_dir.join("schema-19.sqlite");
    {
        let connection =
            rusqlite::Connection::open(&database_path).expect("legacy database should open");
        connection
            .execute_batch(include_str!("../fixtures/schema_v19.sql"))
            .expect("schema 19 fixture should load");
        connection
            .execute_batch(
                "INSERT INTO sessions (id, title, session_context, objective_notes, environment,
                    build_version, related_reference, created_at, updated_at, last_opened_at)
                 VALUES ('s', 'Legacy', 'Context', 'Explore login', 'staging', '1.2', 'QA-7',
                    't1', 't2', 't3');
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
    assert_eq!(session.title, "Legacy");
    assert_eq!(session.session_context.as_deref(), Some("Context"));
    assert_eq!(session.objective_notes.as_deref(), Some("Explore login"));
    assert_eq!(session.environment.as_deref(), Some("staging"));
    assert_eq!(session.build_version.as_deref(), Some("1.2"));
    assert_eq!(session.related_reference.as_deref(), Some("QA-7"));
    assert_eq!(
        (
            session.created_at.as_str(),
            session.updated_at.as_str(),
            session.last_opened_at.as_str()
        ),
        ("t1", "t2", "t3")
    );
    assert_eq!(session.timebox_minutes, None);
    assert_eq!(session.debrief_notes, None);
    assert_eq!(
        (
            session.testing_percent,
            session.bug_percent,
            session.setup_percent
        ),
        (None, None, None)
    );
    assert_eq!(count_rows(connection, "entries"), 1);

    let saved = service
        .update_session("s", full_sheet())
        .expect("migrated session takes a sheet");
    assert_eq!(saved.timebox_minutes, Some(45));
    // The new columns keep their range checks below the domain validation.
    assert!(
        connection
            .execute("UPDATE sessions SET timebox_minutes = 0 WHERE id = 's'", [])
            .is_err()
    );

    drop(service);
    // Reopening a current database runs no migration and keeps the sheet.
    let service =
        SessionService::new(Database::open(&database_path).expect("database should reopen"))
            .expect("session service should construct");
    assert_eq!(
        service
            .get_session("s")
            .expect("query")
            .expect("session")
            .timebox_minutes,
        Some(45)
    );
    drop(service);
    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}
