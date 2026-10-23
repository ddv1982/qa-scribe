use qa_scribe_core::{
    domain::*,
    services::SessionService,
    storage::{Database, SCHEMA_VERSION},
};
use rusqlite::Connection;
use std::{fs, path::PathBuf};

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("uc1-migration-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        Self(root.join("db.sqlite"))
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.0.parent().unwrap());
    }
}
fn seed(connection: &Connection) {
    connection.execute_batch("INSERT INTO sessions (id, title, created_at, updated_at, last_opened_at) VALUES ('s', 'Legacy', 't', 't', 't');
    INSERT INTO entries (id, session_id, type, body, created_at, updated_at) VALUES ('n', 's', 'note', 'Legacy Note', 't', 't');
    INSERT INTO attachments (id, session_id, entry_id, filename, mime_type, size_bytes, sha256, relative_path, created_at) VALUES ('a', 's', 'n', 'legacy.png', 'image/png', 5, 'legacy-hash', 'attachments/s/legacy.png', 't');
    INSERT INTO findings (id, session_id, title, body, kind, created_at, updated_at) VALUES ('f', 's', 'Legacy finding', 'Evidence', 'bug', 't', 't');
    INSERT INTO evidence_links (id, finding_id, entry_id, attachment_id, created_at) VALUES ('e', 'f', 'n', 'a', 't');
    INSERT INTO drafts (id, session_id, kind, title, body, created_at, updated_at) VALUES ('d', 's', 'testware', 'Legacy cases', 'Steps', 't', 't');").unwrap();
}
fn revision(service: &SessionService) -> i64 {
    service.note_source("s", "n").unwrap().unwrap().revision
}

#[test]
fn version_eleven_upgrade_and_partial_reopen_preserve_data_and_repair_trigger() {
    for partial in [false, true] {
        let temp = Temp::new();
        let connection = Connection::open(&temp.0).unwrap();
        connection
            .execute_batch(include_str!("fixtures/schema_v11.sql"))
            .unwrap();
        seed(&connection);
        if partial {
            connection.execute_batch("ALTER TABLE entries ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
            UPDATE entries SET revision = 7;
            CREATE TABLE creation_attempts (attempt_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('finding','testware')), state TEXT NOT NULL CHECK (state IN ('preparing','committed','aborted')), payload_hash TEXT, record_id TEXT, created_at TEXT NOT NULL, CHECK ((state = 'committed') = (record_id IS NOT NULL)), CHECK (state != 'committed' OR payload_hash IS NOT NULL));
            CREATE TRIGGER note_source_revision AFTER UPDATE ON entries BEGIN SELECT 1; END;").unwrap();
        }
        drop(connection);
        let service = SessionService::new(Database::open(&temp.0).unwrap()).unwrap();
        assert_eq!(SCHEMA_VERSION, 13);
        let expected = if partial { 7 } else { 0 };
        assert_eq!(revision(&service), expected);
        assert_eq!(
            service.note_source("s", "n").unwrap().unwrap().entry.body,
            "Legacy Note"
        );
        assert_eq!(
            service.list_findings("s").unwrap()[0].title,
            "Legacy finding"
        );
        assert_eq!(service.list_drafts("s").unwrap()[0].title, "Legacy cases");
        assert_eq!(
            service.list_attachments("s").unwrap()[0].sha256,
            "legacy-hash"
        );
        assert_eq!(service.list_evidence_links("s").unwrap()[0].id, "e");
        service
            .database()
            .connection()
            .execute("UPDATE entries SET body = 'Changed' WHERE id = 'n'", [])
            .unwrap();
        assert_eq!(revision(&service), expected + 1);
        let foreign_keys: i64 = service
            .database()
            .connection()
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(foreign_keys, 0);
        drop(service);
        let database = Database::open(&temp.0).unwrap();
        database
            .connection()
            .execute_batch("DROP TRIGGER note_source_revision")
            .unwrap();
        drop(database);
        let service = SessionService::new(Database::open(&temp.0).unwrap()).unwrap();
        assert_eq!(revision(&service), expected + 1);
        service
            .database()
            .connection()
            .execute(
                "UPDATE entries SET body = 'After reopen' WHERE id = 'n'",
                [],
            )
            .unwrap();
        assert_eq!(revision(&service), expected + 2);
    }
}

#[test]
fn old_entry_rebuild_retains_rich_data_and_installs_revision_after_the_rebuild() {
    let temp = Temp::new();
    let connection = Connection::open(&temp.0).unwrap();
    let schema = include_str!("fixtures/schema_v11.sql").replacen(
        "body TEXT NOT NULL,",
        "body TEXT NOT NULL CHECK (length(body) > 0),",
        1,
    );
    connection.execute_batch(&schema).unwrap();
    seed(&connection);
    connection.execute_batch("ALTER TABLE entries ADD COLUMN revision INTEGER NOT NULL DEFAULT 0; UPDATE entries SET revision = 9, body_json = '{\"doc\":{}}'; PRAGMA user_version = 5;").unwrap();
    drop(connection);
    let service = SessionService::new(Database::open(&temp.0).unwrap()).unwrap();
    assert_eq!(revision(&service), 9);
    let entry = service
        .update_entry(
            "n",
            EntryPatch {
                body: Some(String::new()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(entry.body, "");
    assert_eq!(revision(&service), 10);
    assert_eq!(service.list_attachments("s").unwrap().len(), 1);
    assert_eq!(service.list_evidence_links("s").unwrap().len(), 1);
}

#[test]
fn source_revision_ignores_no_ops_and_tracks_all_source_fields_and_aba() {
    let service = SessionService::in_memory().unwrap();
    service
        .create_session(SessionDraft {
            title: "Revision".into(),
            ..Default::default()
        })
        .unwrap();
    let id = service.list_sessions().unwrap()[0].id.clone();
    let note = service.get_or_create_note_entry(&id).unwrap();
    assert_eq!(
        service
            .note_source(&id, &note.id)
            .unwrap()
            .unwrap()
            .revision,
        0
    );
    let c = service.database().connection();
    for (index, assignment) in [
        "body = 'Changed'",
        "body_json = '{\"type\":\"doc\"}'",
        "body_format = 'tiptap_json'",
        "title = 'Title'",
        "metadata_json = '{\"key\":1}'",
        "excluded_from_generation = 1",
    ]
    .iter()
    .enumerate()
    {
        c.execute(
            &format!("UPDATE entries SET {assignment}, updated_at = 'same' WHERE id = ?1"),
            [&note.id],
        )
        .unwrap();
        c.execute(
            &format!("UPDATE entries SET {assignment}, updated_at = 'still-same' WHERE id = ?1"),
            [&note.id],
        )
        .unwrap();
        assert_eq!(
            service
                .note_source(&id, &note.id)
                .unwrap()
                .unwrap()
                .revision,
            (index + 1) as i64
        );
    }
    c.execute(
        "UPDATE entries SET body = 'B', updated_at = 'same' WHERE id = ?1",
        [&note.id],
    )
    .unwrap();
    c.execute(
        "UPDATE entries SET body = 'Changed', updated_at = 'same' WHERE id = ?1",
        [&note.id],
    )
    .unwrap();
    let source = service.note_source(&id, &note.id).unwrap().unwrap();
    assert_eq!(source.entry.body, "Changed");
    assert_eq!(source.entry.updated_at, "same");
    assert_eq!(source.revision, 8);
    assert!(service.note_source("foreign", &note.id).unwrap().is_none());
}

#[test]
fn ordinary_and_generated_note_writers_advance_one_shared_revision() {
    let service = SessionService::in_memory().unwrap();
    let session = service
        .create_session(SessionDraft {
            title: "Writers".into(),
            ..Default::default()
        })
        .unwrap();
    let note = service.get_or_create_note_entry(&session.id).unwrap();
    let edited = service
        .update_entry(
            &note.id,
            EntryPatch {
                body: Some("Authored".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        service
            .note_source(&session.id, &note.id)
            .unwrap()
            .unwrap()
            .revision,
        1
    );
    let run = service
        .create_ai_run(AiRunCreate {
            session_id: session.id.clone(),
            generation_context_id: None,
            provider: AiProvider::CodexCli,
            model: "default".into(),
            reasoning_effort: None,
            prompt_version: "revision-test".into(),
        })
        .unwrap();
    service
        .complete_ai_run_with_generated_note_update(
            &run.id,
            &note.id,
            &edited.body,
            EntryPatch {
                body: Some("Generated".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        service
            .note_source(&session.id, &note.id)
            .unwrap()
            .unwrap()
            .revision,
        2
    );
    assert_eq!(
        service
            .note_source(&session.id, &note.id)
            .unwrap()
            .unwrap()
            .entry
            .body,
        "Generated"
    );
}

#[test]
fn version_twelve_upgrade_adds_only_empty_staging_ownership_and_preserves_attempts() {
    let temp = Temp::new();
    let database = Database::open(&temp.0).unwrap();
    seed(database.connection());
    database.connection().execute_batch("DROP TABLE creation_staging;
        INSERT INTO creation_attempts (attempt_id, session_id, kind, state, created_at) VALUES ('attempt', 's', 'finding', 'preparing', 't');
        INSERT INTO creation_attempt_images (attempt_id, local_id, attachment_id, relative_path, filename, mime_type, size_bytes, sha256) VALUES ('attempt', 'image', 'reserved', 'attachments/s/reserved.png', 'reserved.png', 'image/png', 2, 'hash');
        PRAGMA user_version = 12;").unwrap();
    drop(database);
    for _ in 0..2 {
        let database = Database::open(&temp.0).unwrap();
        let connection = database.connection();
        let version: i32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 13);
        let rows: (i64, i64, i64) = connection.query_row("SELECT (SELECT count(*) FROM creation_attempts WHERE state = 'preparing'), (SELECT count(*) FROM creation_attempt_images), (SELECT count(*) FROM creation_staging)", [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap();
        assert_eq!(rows, (1, 1, 0));
        assert!(connection.execute("INSERT INTO creation_staging VALUES ('missing-reservation', 'attachments/s/foreign', '1', '1')", []).is_err());
        let preserved: String = connection
            .query_row("SELECT body FROM entries WHERE id = 'n'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(preserved, "Legacy Note");
        let violations: i64 = connection
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(violations, 0);
    }
}
