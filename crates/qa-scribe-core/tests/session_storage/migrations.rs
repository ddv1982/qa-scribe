#[test]
fn migration_removes_body_length_checks_without_losing_dependents() {
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let database_path = temp_dir.join("legacy.sqlite");

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
                  body TEXT NOT NULL CHECK (length(body) > 0),
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
                  body TEXT NOT NULL CHECK (length(body) > 0),
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

                PRAGMA user_version = 2;

                INSERT INTO sessions (
                  id, title, session_context, objective_notes, environment, build_version,
                  related_reference, created_at, updated_at, last_opened_at
                )
                VALUES (
                  'session-1', 'Legacy session', NULL, NULL, NULL, NULL, NULL,
                  '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z'
                );

                INSERT INTO entries (
                  id, session_id, type, title, body, metadata_json, excluded_from_generation,
                  created_at, updated_at
                )
                VALUES (
                  'entry-1', 'session-1', 'note', 'Legacy note', '<p>Legacy note body</p>',
                  NULL, 0, '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z'
                );

                INSERT INTO attachments (
                  id, session_id, entry_id, filename, mime_type, size_bytes, sha256,
                  relative_path, created_at
                )
                VALUES (
                  'attachment-1', 'session-1', 'entry-1', 'evidence.png', 'image/png', 10,
                  'abc', 'session-1/evidence.png', '2026-06-22T00:00:00.000Z'
                );

                INSERT INTO findings (
                  id, session_id, title, body, kind, metadata_json, created_at, updated_at
                )
                VALUES (
                  'finding-1', 'session-1', 'Legacy finding', '<p>Legacy finding body</p>',
                  'bug', NULL, '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z'
                );

                INSERT INTO evidence_links (
                  id, finding_id, entry_id, attachment_id, created_at
                )
                VALUES (
                  'link-1', 'finding-1', 'entry-1', 'attachment-1',
                  '2026-06-22T00:00:00.000Z'
                );

                INSERT INTO generation_contexts (id, session_id, created_at)
                VALUES ('context-1', 'session-1', '2026-06-22T00:00:00.000Z');

                INSERT INTO generation_context_entries (
                  id, generation_context_id, entry_id, included
                )
                VALUES ('context-entry-1', 'context-1', 'entry-1', 1);
                "#,
            )
            .expect("legacy schema fixture should be created");
    }

    let service = SessionService::new(Database::open(&database_path).expect("database should migrate"))
        .expect("session service should construct");
    let connection = service.database().connection();
    assert_no_foreign_key_violations(connection);

    let user_version: i32 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("user_version should read");
    assert_eq!(user_version, SCHEMA_VERSION);

    let entries_sql: String = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'entries'",
            [],
            |row| row.get(0),
        )
        .expect("entries schema should load");
    let findings_sql: String = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'findings'",
            [],
            |row| row.get(0),
        )
        .expect("findings schema should load");
    assert!(!entries_sql.replace(' ', "").contains("length(body)>0"));
    assert!(!findings_sql.replace(' ', "").contains("length(body)>0"));

    assert_eq!(count_rows(connection, "attachments"), 1);
    assert_eq!(count_rows(connection, "evidence_links"), 1);
    assert_eq!(count_rows(connection, "generation_context_entries"), 1);
    let attachment_entry_id: Option<String> = connection
        .query_row(
            "SELECT entry_id FROM attachments WHERE id = 'attachment-1'",
            [],
            |row| row.get(0),
        )
        .expect("attachment should survive migration");
    assert_eq!(attachment_entry_id.as_deref(), Some("entry-1"));

    let entry = service
        .update_entry(
            "entry-1",
            EntryPatch {
                body: Some("".to_string()),
                ..EntryPatch::default()
            },
        )
        .expect("migrated entry should accept blank body");
    assert_eq!(entry.body, "");

    let finding = service
        .update_finding(
            "finding-1",
            FindingPatch {
                title: None,
                body: Some("".to_string()),
                ..FindingPatch::default()
            },
        )
        .expect("migrated finding should accept blank body");
    assert_eq!(finding.body, "");

    drop(service);
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

