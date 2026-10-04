use std::{
    fs,
    path::{Path, PathBuf},
};

use qa_scribe_core::{
    attachments::{
        delete_session_attachment_files, delete_session_with_attachment_files,
        import_managed_attachment_bytes, retry_attachment_cleanup,
    },
    domain::{Attachment, AttachmentCleanupStatus, SessionDraft},
    services::SessionService,
    storage::{Database, SCHEMA_VERSION},
};
use rusqlite::params;

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("qa-scribe-cleanup-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn attachment(service: &SessionService, root: &Path) -> Attachment {
    let session = service
        .create_session(SessionDraft {
            title: "Exact cleanup".into(),
            ..Default::default()
        })
        .unwrap();
    import_managed_attachment_bytes(
        service,
        root,
        &session.id,
        None,
        "evidence.txt".into(),
        None,
        b"evidence".to_vec(),
    )
    .unwrap()
}

fn queue(service: &SessionService, session: &str, path: &str) {
    service
        .database()
        .connection()
        .execute(
            "INSERT INTO attachment_cleanup (session_id, relative_path) VALUES (?1, ?2)",
            params![session, path],
        )
        .unwrap();
}

fn pending(service: &SessionService) -> i64 {
    service
        .database()
        .connection()
        .query_row("SELECT COUNT(*) FROM attachment_cleanup", [], |row| {
            row.get(0)
        })
        .unwrap()
}

#[test]
fn deletion_queue_and_cascade_are_atomic_on_enqueue_and_delete_errors() {
    for trigger in [
        "CREATE TRIGGER fail_queue BEFORE INSERT ON attachment_cleanup BEGIN SELECT RAISE(ABORT, 'queue failure'); END;",
        "CREATE TRIGGER ignore_queue BEFORE INSERT ON attachment_cleanup BEGIN SELECT RAISE(IGNORE); END;",
        "CREATE TRIGGER fail_second_queue BEFORE INSERT ON attachment_cleanup WHEN EXISTS(SELECT 1 FROM attachment_cleanup) BEGIN SELECT RAISE(ABORT, 'second queue failure'); END;",
        "CREATE TRIGGER fail_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'delete failure'); END;",
        "CREATE TRIGGER ignore_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(IGNORE); END;",
    ] {
        let root = Temp::new();
        let service = SessionService::in_memory().unwrap();
        let a = attachment(&service, &root.0);
        let b = import_managed_attachment_bytes(
            &service,
            &root.0,
            &a.session_id,
            None,
            "second.txt".into(),
            None,
            b"second".to_vec(),
        )
        .unwrap();
        service
            .database()
            .connection()
            .execute_batch(trigger)
            .unwrap();
        assert!(delete_session_with_attachment_files(&service, &root.0, &a.session_id).is_err());
        assert_eq!(pending(&service), 0);
        assert!(service.get_session(&a.session_id).unwrap().is_some());
        assert!(service.get_attachment(&a.id).unwrap().is_some());
        assert!(service.get_attachment(&b.id).unwrap().is_some());
        assert_eq!(
            fs::read(root.0.join(&a.relative_path)).unwrap(),
            b"evidence"
        );
        assert_eq!(fs::read(root.0.join(&b.relative_path)).unwrap(), b"second");
    }
}

#[test]
fn unsafe_stored_paths_roll_back_deletion_without_touching_files() {
    for bad in [
        "../outside",
        "attachments/wrong/evidence.txt",
        "attachments//file",
        "attachments/s/../file",
        "attachments/s/a/b",
        "/attachments/s/file",
        "attachments/s/./file",
        "attachments\\s\\file",
    ] {
        let root = Temp::new();
        let service = SessionService::in_memory().unwrap();
        let a = attachment(&service, &root.0);
        service
            .database()
            .connection()
            .execute(
                "UPDATE attachments SET relative_path = ?1 WHERE id = ?2",
                params![bad, a.id],
            )
            .unwrap();
        assert!(service.delete_session(&a.session_id).is_err(), "{bad}");
        assert_eq!(pending(&service), 0);
        assert!(service.get_session(&a.session_id).unwrap().is_some());
        assert!(root.0.join(&a.relative_path).is_file());
    }
}

#[test]
fn restart_before_cleanup_and_after_unlink_before_ack_are_idempotent() {
    for unlink_before_restart in [false, true] {
        let root = Temp::new();
        let db = root.0.join("session.sqlite");
        let service = SessionService::new(Database::open(&db).unwrap()).unwrap();
        let a = attachment(&service, &root.0);
        service.delete_session(&a.session_id).unwrap();
        assert_eq!(pending(&service), 1);
        if unlink_before_restart {
            fs::remove_file(root.0.join(&a.relative_path)).unwrap();
        }
        drop(service);
        let restarted = SessionService::new(Database::open(&db).unwrap()).unwrap();
        assert_eq!(pending(&restarted), 1);
        assert_eq!(
            retry_attachment_cleanup(&restarted, &root.0)
                .unwrap()
                .pending_files,
            Some(0)
        );
        assert!(!root.0.join(&a.relative_path).exists());
        assert_eq!(
            retry_attachment_cleanup(&restarted, &root.0)
                .unwrap()
                .pending_files,
            Some(0)
        );
    }
}

#[test]
fn partial_cleanup_reports_pending_and_retry_reaches_zero() {
    let root = Temp::new();
    let service = SessionService::in_memory().unwrap();
    let a = attachment(&service, &root.0);
    let b = import_managed_attachment_bytes(
        &service,
        &root.0,
        &a.session_id,
        None,
        "blocked.txt".into(),
        None,
        b"blocked".to_vec(),
    )
    .unwrap();
    let blocked = root.0.join(&b.relative_path);
    fs::remove_file(&blocked).unwrap();
    fs::create_dir(&blocked).unwrap();
    fs::write(blocked.join("unknown.txt"), "unknown").unwrap();
    assert_eq!(
        delete_session_with_attachment_files(&service, &root.0, &a.session_id)
            .unwrap()
            .pending_files,
        Some(1)
    );
    assert!(!root.0.join(&a.relative_path).exists());
    assert_eq!(
        fs::read_to_string(blocked.join("unknown.txt")).unwrap(),
        "unknown"
    );
    fs::remove_file(blocked.join("unknown.txt")).unwrap();
    fs::remove_dir(&blocked).unwrap();
    fs::write(&blocked, "retry").unwrap();
    assert_eq!(
        retry_attachment_cleanup(&service, &root.0)
            .unwrap()
            .pending_files,
        Some(0)
    );
    assert!(!blocked.exists());
}

#[test]
fn ack_database_error_is_not_an_ordinary_delete_error_and_recovers_after_restart() {
    let root = Temp::new();
    let db = root.0.join("session.sqlite");
    let service = SessionService::new(Database::open(&db).unwrap()).unwrap();
    let a = attachment(&service, &root.0);
    service.database().connection().execute_batch(
        "CREATE TRIGGER fail_ack BEFORE DELETE ON attachment_cleanup BEGIN SELECT RAISE(ABORT, 'ack failure'); END;",
    ).unwrap();
    assert_eq!(
        delete_session_with_attachment_files(&service, &root.0, &a.session_id)
            .unwrap()
            .pending_files,
        None
    );
    assert!(service.get_session(&a.session_id).unwrap().is_none());
    assert!(!root.0.join(&a.relative_path).exists());
    assert_eq!(pending(&service), 1);
    drop(service);
    let restarted = SessionService::new(Database::open(&db).unwrap()).unwrap();
    restarted
        .database()
        .connection()
        .execute_batch("DROP TRIGGER fail_ack")
        .unwrap();
    assert_eq!(
        retry_attachment_cleanup(&restarted, &root.0)
            .unwrap()
            .pending_files,
        Some(0)
    );
}

#[test]
fn unavailable_queue_status_serializes_null() {
    let root = Temp::new();
    let service = SessionService::in_memory().unwrap();
    service
        .database()
        .connection()
        .execute_batch("DROP TABLE attachment_cleanup")
        .unwrap();
    let status = retry_attachment_cleanup(&service, &root.0).unwrap();
    assert_eq!(status.pending_files, None);
    assert_eq!(
        serde_json::to_value(status).unwrap(),
        serde_json::json!({"pendingFiles": null})
    );
    assert_eq!(
        serde_json::to_value(AttachmentCleanupStatus {
            pending_files: Some(2)
        })
        .unwrap(),
        serde_json::json!({"pendingFiles": 2})
    );
}

#[test]
fn schema_eight_upgrade_and_current_reopen_preserve_data_and_pending_intent() {
    let root = Temp::new();
    let db = root.0.join("session.sqlite");
    let service = SessionService::new(Database::open(&db).unwrap()).unwrap();
    let a = attachment(&service, &root.0);
    service
        .database()
        .connection()
        .execute_batch("DROP TABLE attachment_cleanup; PRAGMA user_version = 8;")
        .unwrap();
    drop(service);
    let upgraded = SessionService::new(Database::open(&db).unwrap()).unwrap();
    assert_eq!(SCHEMA_VERSION, 9);
    assert_eq!(
        upgraded
            .database()
            .connection()
            .query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
            .unwrap(),
        9
    );
    assert!(upgraded.get_attachment(&a.id).unwrap().is_some());
    assert_eq!(
        pending(&upgraded),
        0,
        "upgrade must not backfill arbitrary orphans"
    );
    upgraded.delete_session(&a.session_id).unwrap();
    drop(upgraded);
    let current = SessionService::new(Database::open(&db).unwrap()).unwrap();
    assert_eq!(pending(&current), 1);
    assert_eq!(
        retry_attachment_cleanup(&current, &root.0)
            .unwrap()
            .pending_files,
        Some(0)
    );
}

include!("attachment_cleanup/safety.rs");
