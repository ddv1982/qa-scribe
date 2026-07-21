#[test]
fn attachment_reconciliation_reports_missing_and_stray_files() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let source_path = temp_dir.join("screen.png");
    fs::write(&source_path, "image bytes").expect("source attachment should write");

    let session = service
        .create_session(SessionDraft {
            title: "Attachment reconciliation".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let attachment = import_managed_attachment(&service, &temp_dir, &session.id, None, &source_path)
        .expect("attachment should import");

    let clean_report =
        reconcile_attachment_files(&service, &temp_dir).expect("attachments should reconcile");
    assert!(clean_report.missing_files.is_empty());
    assert!(clean_report.stray_files.is_empty());

    fs::remove_file(temp_dir.join(&attachment.relative_path)).expect("managed file should remove");
    let stray_path = temp_dir
        .join("attachments")
        .join(&session.id)
        .join("stray.log");
    fs::write(&stray_path, "orphaned").expect("stray file should write");

    let report =
        reconcile_attachment_files(&service, &temp_dir).expect("attachments should reconcile");
    assert_eq!(report.missing_files, vec![attachment.relative_path]);
    assert_eq!(
        report.stray_files,
        vec![format!("attachments/{}/stray.log", session.id)]
    );

    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}

#[test]
fn delete_session_with_attachment_files_removes_database_rows_and_files() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let source_path = temp_dir.join("evidence.txt");
    fs::write(&source_path, "evidence").expect("source attachment should write");

    let session = service
        .create_session(SessionDraft {
            title: "Delete with files".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    import_managed_attachment(&service, &temp_dir, &session.id, None, &source_path)
        .expect("attachment should import");

    let session_dir = temp_dir.join("attachments").join(&session.id);
    assert!(session_dir.exists());
    delete_session_with_attachment_files(&service, &temp_dir, &session.id)
        .expect("session and attachment files should delete");
    assert!(!session_dir.exists());
    assert!(
        service
            .get_session(&session.id)
            .expect("session query should work")
            .is_none()
    );
    assert_eq!(
        count_rows(service.database().connection(), "attachments"),
        0
    );

    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}

#[test]
fn delete_session_with_attachment_files_succeeds_when_file_cleanup_fails_after_db_delete() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(temp_dir.join("attachments")).expect("attachment root should be created");
    let session = service
        .create_session(SessionDraft {
            title: "Delete with cleanup residue".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let session_path = temp_dir.join("attachments").join(&session.id);
    fs::write(&session_path, "not a directory").expect("blocking file should be written");

    delete_session_with_attachment_files(&service, &temp_dir, &session.id)
        .expect("durable session deletion should not be reported as failed");

    assert!(
        service
            .get_session(&session.id)
            .expect("session query should work")
            .is_none(),
        "session row should remain deleted when best-effort file cleanup fails"
    );
    assert!(session_path.exists(), "cleanup residue should remain available for reconciliation");

    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}

#[test]
fn delete_session_with_attachment_files_keeps_files_when_db_delete_fails() {
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let db_path = temp_dir.join("qa-scribe.sqlite");
    let service = SessionService::new(Database::open(&db_path).expect("file-backed database should open"))
        .expect("session service should construct");
    let source_path = temp_dir.join("evidence.txt");
    fs::write(&source_path, "evidence").expect("source attachment should write");

    let session = service
        .create_session(SessionDraft {
            title: "Delete order safety".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    import_managed_attachment(&service, &temp_dir, &session.id, None, &source_path)
        .expect("attachment should import");

    let session_dir = temp_dir.join("attachments").join(&session.id);
    assert!(session_dir.exists());

    // Force delete_session's UPDATE/DELETE to fail with SQLITE_BUSY by holding
    // a write transaction open on a second connection to the same file, and
    // shrinking the busy_timeout so the test does not wait out the default.
    service
        .database()
        .connection()
        .pragma_update(None, "busy_timeout", 50)
        .expect("busy_timeout should update");
    let blocker = rusqlite::Connection::open(&db_path).expect("blocking connection should open");
    blocker
        .execute_batch("BEGIN IMMEDIATE; DELETE FROM sessions WHERE id = 'unrelated';")
        .expect("blocking transaction should start");

    let result = delete_session_with_attachment_files(&service, &temp_dir, &session.id);
    assert!(
        result.is_err(),
        "delete should surface the DB failure instead of pretending to succeed"
    );

    blocker
        .execute_batch("ROLLBACK;")
        .expect("blocking transaction should release");

    // The critical assertion: because the DB delete happens BEFORE file
    // cleanup, a DB failure must leave the evidence files untouched on disk.
    assert!(
        session_dir.exists(),
        "attachment files must survive a failed DB delete, not be destroyed before it runs"
    );
    assert!(
        service
            .get_session(&session.id)
            .expect("session query should work")
            .is_some(),
        "session row must still exist after the failed delete"
    );

    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}
