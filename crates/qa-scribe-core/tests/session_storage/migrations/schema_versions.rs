#[test]
fn opening_a_database_from_a_newer_schema_version_is_rejected() {
    // A database created by a newer build of the app (user_version >
    // SCHEMA_VERSION) must not be silently opened and migrated: this build
    // doesn't know what that schema means, and writing to it could corrupt
    // data the newer build depends on. Opening it should fail loudly instead.
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let database_path = temp_dir.join("from-the-future.sqlite");

    {
        let connection =
            rusqlite::Connection::open(&database_path).expect("database should open for setup");
        connection
            .pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .expect("future user_version should be settable");
    }

    match Database::open(&database_path) {
        Err(QaScribeError::Validation(message)) => {
            assert!(
                message.contains("newer version"),
                "expected the error to explain the database is from a newer app version, got: {message}"
            );
        }
        Err(other) => panic!(
            "expected opening a newer-schema database to fail with a validation error, got a different error: {other}"
        ),
        Ok(_) => panic!("expected opening a newer-schema database to fail, but it opened"),
    }

    // The rejection must happen before this build touches the file at all:
    // no DDL from this build's SCHEMA batch (which could resurrect tables or
    // indices the newer schema dropped or renamed) and no persistent pragma
    // rewrites like journal_mode.
    {
        let connection = rusqlite::Connection::open(&database_path)
            .expect("future database should reopen for inspection");
        let object_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM sqlite_master", [], |row| row.get(0))
            .expect("sqlite_master should be queryable");
        assert_eq!(
            object_count, 0,
            "rejected newer-schema database must not have this build's schema objects created in it"
        );
        let journal_mode: String = connection
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .expect("journal_mode should be readable");
        assert_eq!(
            journal_mode.to_lowercase(),
            "delete",
            "rejected newer-schema database must keep its original journal mode"
        );
    }

    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}
#[test]
fn stale_user_version_five_from_pre_versioning_builds_still_migrates_and_settles() {
    // Every build before schema versioning became real unconditionally set
    // user_version = 5 on every open, whether or not the feature-detecting
    // migrations had actually converged for a given database file. A
    // database can therefore be found in the wild with user_version = 5 but
    // still missing a migration (here: drafts.metadata_json). Opening it
    // must still run the migration helpers (since 5 < SCHEMA_VERSION) and
    // land on SCHEMA_VERSION afterwards.
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let database_path = temp_dir.join("stale-five.sqlite");

    {
        let connection =
            rusqlite::Connection::open(&database_path).expect("legacy database should open");
        connection
            .execute_batch(
                r#"
                PRAGMA foreign_keys = ON;

                CREATE TABLE sessions (
                  id TEXT PRIMARY KEY,
                  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
                  session_context TEXT,
                  objective_notes TEXT,
                  environment TEXT,
                  build_version TEXT,
                  related_reference TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  last_opened_at TEXT NOT NULL
                );

                CREATE TABLE entries (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  type TEXT NOT NULL CHECK (type IN ('note', 'observation', 'api_response', 'log', 'screenshot', 'finding_candidate')),
                  title TEXT,
                  body TEXT NOT NULL,
                  body_json TEXT,
                  body_format TEXT NOT NULL DEFAULT 'html',
                  metadata_json TEXT,
                  excluded_from_generation INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE attachments (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
                  filename TEXT NOT NULL,
                  mime_type TEXT,
                  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
                  sha256 TEXT NOT NULL,
                  relative_path TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );

                CREATE TABLE findings (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
                  body TEXT NOT NULL,
                  body_json TEXT,
                  body_format TEXT NOT NULL DEFAULT 'html',
                  kind TEXT NOT NULL CHECK (kind IN ('bug', 'question', 'risk', 'follow_up', 'note')),
                  metadata_json TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE evidence_links (
                  id TEXT PRIMARY KEY,
                  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
                  entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
                  attachment_id TEXT REFERENCES attachments(id) ON DELETE CASCADE,
                  created_at TEXT NOT NULL,
                  CHECK (entry_id IS NOT NULL OR attachment_id IS NOT NULL)
                );

                CREATE TABLE generation_contexts (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  created_at TEXT NOT NULL
                );

                CREATE TABLE generation_context_entries (
                  id TEXT PRIMARY KEY,
                  generation_context_id TEXT NOT NULL REFERENCES generation_contexts(id) ON DELETE CASCADE,
                  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
                  included INTEGER NOT NULL DEFAULT 1
                );

                CREATE TABLE drafts (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  ai_run_id TEXT REFERENCES ai_runs(id) ON DELETE SET NULL,
                  kind TEXT NOT NULL CHECK (kind IN ('session_report', 'testware')),
                  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
                  body TEXT NOT NULL,
                  body_json TEXT,
                  body_format TEXT NOT NULL DEFAULT 'html',
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE ai_runs (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  generation_context_id TEXT REFERENCES generation_contexts(id) ON DELETE SET NULL,
                  provider TEXT NOT NULL CHECK (provider IN ('claude_code', 'codex_cli', 'copilot_cli')),
                  model TEXT NOT NULL,
                  reasoning_effort TEXT,
                  prompt_version TEXT NOT NULL,
                  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
                  error_message TEXT,
                  created_at TEXT NOT NULL,
                  completed_at TEXT
                );

                -- Every pre-versioning build stamped user_version = 5
                -- unconditionally, regardless of whether drafts.metadata_json
                -- (added by a later migration) had actually been applied.
                PRAGMA user_version = 5;

                INSERT INTO sessions (
                  id, title, session_context, objective_notes, environment, build_version,
                  related_reference, created_at, updated_at, last_opened_at
                )
                VALUES (
                  'session-1', 'Stale session', NULL, NULL, NULL, NULL, NULL,
                  '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z'
                );
                "#,
            )
            .expect("stale-five schema fixture should be created");
    }

    let service = SessionService::new(Database::open(&database_path).expect("database should migrate"))
        .expect("session service should construct");
    let connection = service.database().connection();
    assert_no_foreign_key_violations(connection);

    let user_version: i32 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("user_version should read");
    assert_eq!(user_version, SCHEMA_VERSION);

    let drafts_sql: String = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'drafts'",
            [],
            |row| row.get(0),
        )
        .expect("drafts schema should load");
    assert!(
        drafts_sql.contains("metadata_json"),
        "migration helpers should have re-run for a stale user_version = 5 database"
    );

    drop(service);
    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}
