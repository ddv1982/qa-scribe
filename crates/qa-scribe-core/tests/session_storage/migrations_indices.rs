#[test]
fn migration_adds_indices_on_cascade_fk_columns_for_legacy_databases() {
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let database_path = temp_dir.join("legacy-no-fk-indices.sqlite");

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

                CREATE TABLE generation_context_attachments (
                  id TEXT PRIMARY KEY,
                  generation_context_id TEXT NOT NULL REFERENCES generation_contexts(id) ON DELETE CASCADE,
                  attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
                  included INTEGER NOT NULL DEFAULT 1
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

                CREATE TABLE drafts (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  ai_run_id TEXT REFERENCES ai_runs(id) ON DELETE SET NULL,
                  kind TEXT NOT NULL CHECK (kind IN ('session_report', 'testware')),
                  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
                  body TEXT NOT NULL,
                  body_json TEXT,
                  body_format TEXT NOT NULL DEFAULT 'html',
                  metadata_json TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE INDEX idx_sessions_last_opened ON sessions(last_opened_at DESC);
                CREATE INDEX idx_entries_session_created ON entries(session_id, created_at);
                CREATE INDEX idx_attachments_session_created ON attachments(session_id, created_at);
                CREATE INDEX idx_findings_session_created ON findings(session_id, created_at);
                CREATE INDEX idx_drafts_session_updated ON drafts(session_id, updated_at);
                CREATE INDEX idx_ai_runs_session_created ON ai_runs(session_id, created_at);

                -- This fixture predates the cascade-FK indices migration: the
                -- tables and their pre-existing session_id indices are all
                -- present, but none of the FK-column indices this migration
                -- adds exist yet.
                PRAGMA user_version = 6;

                INSERT INTO sessions (
                  id, title, session_context, objective_notes, environment, build_version,
                  related_reference, created_at, updated_at, last_opened_at
                )
                VALUES (
                  'session-1', 'Legacy session', NULL, NULL, NULL, NULL, NULL,
                  '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z'
                );
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

    let expected_indices = [
        ("evidence_links", "idx_evidence_links_finding_id"),
        ("evidence_links", "idx_evidence_links_entry_id"),
        ("evidence_links", "idx_evidence_links_attachment_id"),
        (
            "generation_context_entries",
            "idx_generation_context_entries_generation_context_id",
        ),
        (
            "generation_context_entries",
            "idx_generation_context_entries_entry_id",
        ),
        (
            "generation_context_attachments",
            "idx_generation_context_attachments_generation_context_id",
        ),
        (
            "generation_context_attachments",
            "idx_generation_context_attachments_attachment_id",
        ),
        ("drafts", "idx_drafts_ai_run_id"),
        ("attachments", "idx_attachments_entry_id"),
        ("generation_contexts", "idx_generation_contexts_session_id"),
        ("ai_runs", "idx_ai_runs_generation_context_id"),
    ];
    for (table, index) in expected_indices {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'index' AND tbl_name = ?1 AND name = ?2)",
                rusqlite::params![table, index],
                |row| row.get(0),
            )
            .expect("sqlite_master query should run");
        assert!(
            exists,
            "expected migration to create index {index} on {table} for a legacy database"
        );
    }

    drop(service);
    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}
