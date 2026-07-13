#[test]
fn migration_rebuilds_preserve_existing_rich_body_columns() {
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let database_path = temp_dir.join("mixed-rich-legacy.sqlite");

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
                  body_json TEXT,
                  body_format TEXT NOT NULL DEFAULT 'html',
                  metadata_json TEXT,
                  excluded_from_generation INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE findings (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
                  body TEXT NOT NULL CHECK (length(body) > 0),
                  body_json TEXT,
                  body_format TEXT NOT NULL DEFAULT 'html',
                  kind TEXT NOT NULL CHECK (kind IN ('bug', 'question', 'risk', 'follow_up', 'note')),
                  metadata_json TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE generation_contexts (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  created_at TEXT NOT NULL
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
                  kind TEXT NOT NULL CHECK (kind IN ('session_report')),
                  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
                  body TEXT NOT NULL,
                  body_json TEXT,
                  body_format TEXT NOT NULL DEFAULT 'html',
                  metadata_json TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                PRAGMA user_version = 4;

                INSERT INTO sessions (
                  id, title, session_context, objective_notes, environment, build_version,
                  related_reference, created_at, updated_at, last_opened_at
                )
                VALUES (
                  'session-1', 'Mixed legacy session', NULL, NULL, NULL, NULL, NULL,
                  '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z'
                );

                INSERT INTO entries (
                  id, session_id, type, title, body, body_json, body_format, metadata_json,
                  excluded_from_generation, created_at, updated_at
                )
                VALUES (
                  'entry-1', 'session-1', 'note', 'Rich note', '<p>Fallback note</p>',
                  '{"type":"doc","content":[{"type":"paragraph"}]}', 'tiptap-json',
                  '{"source":"entry"}', 0, '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z'
                );

                INSERT INTO findings (
                  id, session_id, title, body, body_json, body_format, kind, metadata_json,
                  created_at, updated_at
                )
                VALUES (
                  'finding-1', 'session-1', 'Rich finding', '<p>Fallback finding</p>',
                  '{"type":"doc","content":[{"type":"heading"}]}', 'tiptap-json',
                  'bug', '{"source":"finding"}', '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z'
                );

                INSERT INTO drafts (
                  id, session_id, ai_run_id, kind, title, body, body_json, body_format,
                  metadata_json, created_at, updated_at
                )
                VALUES (
                  'draft-1', 'session-1', NULL, 'session_report', 'Rich draft', '<p>Fallback draft</p>',
                  '{"type":"doc","content":[{"type":"bulletList"}]}', 'tiptap-json',
                  '{"source":"draft"}', '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z'
                );
                "#,
            )
            .expect("mixed legacy schema fixture should be created");
    }

    let service = SessionService::new(Database::open(&database_path).expect("database should migrate"))
        .expect("session service should construct");
    let connection = service.database().connection();
    assert_no_foreign_key_violations(connection);

    let entry_rich: (String, String, String) = connection
        .query_row(
            "SELECT body_json, body_format, metadata_json FROM entries WHERE id = 'entry-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("entry rich columns should read");
    assert!(entry_rich.0.contains("paragraph"));
    assert_eq!(entry_rich.1, "tiptap-json");
    assert_eq!(entry_rich.2, "{\"source\":\"entry\"}");

    let finding_rich: (String, String, String) = connection
        .query_row(
            "SELECT body_json, body_format, metadata_json FROM findings WHERE id = 'finding-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("finding rich columns should read");
    assert!(finding_rich.0.contains("heading"));
    assert_eq!(finding_rich.1, "tiptap-json");
    assert_eq!(finding_rich.2, "{\"source\":\"finding\"}");

    let draft_rich: (String, String, String) = connection
        .query_row(
            "SELECT body_json, body_format, metadata_json FROM drafts WHERE id = 'draft-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("draft rich columns should read");
    assert!(draft_rich.0.contains("bulletList"));
    assert_eq!(draft_rich.1, "tiptap-json");
    assert_eq!(draft_rich.2, "{\"source\":\"draft\"}");

    let draft_kind_sql: String = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'drafts'",
            [],
            |row| row.get(0),
        )
        .expect("draft schema should read");
    assert!(draft_kind_sql.contains("testware"));

    drop(service);
    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}
