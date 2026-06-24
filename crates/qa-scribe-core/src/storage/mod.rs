use std::path::Path;

use rusqlite::Connection;

use crate::{Result, error::validation};

pub struct Database {
    connection: Connection,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path)?;
        initialize(&connection)?;
        Ok(Self { connection })
    }

    pub fn in_memory() -> Result<Self> {
        let connection = Connection::open_in_memory()?;
        initialize(&connection)?;
        Ok(Self { connection })
    }

    pub fn connection(&self) -> &Connection {
        &self.connection
    }
}

fn initialize(connection: &Connection) -> Result<()> {
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "busy_timeout", 5_000)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.execute_batch(SCHEMA)?;
    migrate(connection)?;
    assert_no_foreign_key_violations(connection)?;
    Ok(())
}

fn migrate(connection: &Connection) -> Result<()> {
    ensure_testware_drafts_supported(connection)?;
    ensure_blank_bodies_supported(connection)?;
    connection.pragma_update(None, "user_version", 3)?;
    Ok(())
}

fn ensure_testware_drafts_supported(connection: &Connection) -> Result<()> {
    let sql: Option<String> = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'drafts'",
        [],
        |row| row.get(0),
    )?;
    if sql
        .as_deref()
        .is_some_and(|schema| schema.contains("'testware'"))
    {
        return Ok(());
    }

    connection.execute_batch("BEGIN IMMEDIATE;")?;
    let rebuild_result = (|| {
        connection.execute_batch(
            r#"
            ALTER TABLE drafts RENAME TO drafts_old;

            CREATE TABLE drafts (
              id TEXT PRIMARY KEY,
              session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
              ai_run_id TEXT REFERENCES ai_runs(id) ON DELETE SET NULL,
              kind TEXT NOT NULL CHECK (kind IN ('session_report', 'testware')),
              title TEXT NOT NULL CHECK (length(trim(title)) > 0),
              body TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            INSERT INTO drafts (id, session_id, ai_run_id, kind, title, body, created_at, updated_at)
            SELECT id, session_id, ai_run_id, kind, title, body, created_at, updated_at
            FROM drafts_old;

            DROP TABLE drafts_old;
            CREATE INDEX IF NOT EXISTS idx_drafts_session_updated ON drafts(session_id, updated_at);
            "#,
        )?;
        assert_no_foreign_key_violations(connection)
    })();

    match rebuild_result {
        Ok(()) => connection.execute_batch("COMMIT;")?,
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK;");
            return Err(error);
        }
    }

    Ok(())
}

fn ensure_blank_bodies_supported(connection: &Connection) -> Result<()> {
    let rebuild_entries = body_has_required_length_check(connection, "entries")?;
    let rebuild_findings = body_has_required_length_check(connection, "findings")?;
    if !rebuild_entries && !rebuild_findings {
        return Ok(());
    }

    connection.pragma_update(None, "foreign_keys", "OFF")?;
    let migration_result = (|| {
        connection.execute_batch("BEGIN IMMEDIATE;")?;
        let rebuild_result = (|| {
            if rebuild_entries {
                rebuild_entries_without_body_length_check(connection)?;
            }
            if rebuild_findings {
                rebuild_findings_without_body_length_check(connection)?;
            }
            assert_no_foreign_key_violations(connection)
        })();

        match rebuild_result {
            Ok(()) => connection.execute_batch("COMMIT;")?,
            Err(error) => {
                let _ = connection.execute_batch("ROLLBACK;");
                return Err(error);
            }
        }

        Ok(())
    })();
    let foreign_keys_result = connection.pragma_update(None, "foreign_keys", "ON");

    match (migration_result, foreign_keys_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), _) => Err(error),
        (Ok(()), Err(error)) => Err(error.into()),
    }
}

fn body_has_required_length_check(connection: &Connection, table: &str) -> Result<bool> {
    let sql: String = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |row| row.get(0),
    )?;
    let compact = sql.split_whitespace().collect::<String>().to_lowercase();
    Ok(compact.contains("check(length(body)>0)"))
}

fn rebuild_entries_without_body_length_check(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        r#"
        DROP TABLE IF EXISTS entries_new;

        CREATE TABLE entries_new (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK (type IN ('note', 'observation', 'api_response', 'log', 'screenshot', 'finding_candidate')),
          title TEXT,
          body TEXT NOT NULL,
          metadata_json TEXT,
          excluded_from_generation INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT INTO entries_new (
          id, session_id, type, title, body, metadata_json, excluded_from_generation, created_at, updated_at
        )
        SELECT id, session_id, type, title, body, metadata_json, excluded_from_generation, created_at, updated_at
        FROM entries;

        DROP TABLE entries;
        ALTER TABLE entries_new RENAME TO entries;
        CREATE INDEX IF NOT EXISTS idx_entries_session_created ON entries(session_id, created_at);
        "#,
    )?;
    Ok(())
}

fn rebuild_findings_without_body_length_check(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        r#"
        DROP TABLE IF EXISTS findings_new;

        CREATE TABLE findings_new (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          title TEXT NOT NULL CHECK (length(trim(title)) > 0),
          body TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('bug', 'question', 'risk', 'follow_up', 'note')),
          metadata_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT INTO findings_new (id, session_id, title, body, kind, metadata_json, created_at, updated_at)
        SELECT id, session_id, title, body, kind, metadata_json, created_at, updated_at
        FROM findings;

        DROP TABLE findings;
        ALTER TABLE findings_new RENAME TO findings;
        CREATE INDEX IF NOT EXISTS idx_findings_session_created ON findings(session_id, created_at);
        "#,
    )?;
    Ok(())
}

fn assert_no_foreign_key_violations(connection: &Connection) -> Result<()> {
    let mut statement = connection.prepare("PRAGMA foreign_key_check")?;
    let mut rows = statement.query([])?;
    if let Some(row) = rows.next()? {
        let table: String = row.get(0)?;
        let rowid: i64 = row.get(1)?;
        return Err(validation(format!(
            "database migration left a foreign key violation in {table} row {rowid}"
        )));
    }
    Ok(())
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS sessions (
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

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('note', 'observation', 'api_response', 'log', 'screenshot', 'finding_candidate')),
  title TEXT,
  body TEXT NOT NULL,
  metadata_json TEXT,
  excluded_from_generation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
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

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  body TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bug', 'question', 'risk', 'follow_up', 'note')),
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence_links (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
  attachment_id TEXT REFERENCES attachments(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  CHECK (entry_id IS NOT NULL OR attachment_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS generation_contexts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_context_entries (
  id TEXT PRIMARY KEY,
  generation_context_id TEXT NOT NULL REFERENCES generation_contexts(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  included INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS generation_context_attachments (
  id TEXT PRIMARY KEY,
  generation_context_id TEXT NOT NULL REFERENCES generation_contexts(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  included INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ai_runs (
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

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ai_run_id TEXT REFERENCES ai_runs(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('session_report', 'testware')),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_last_opened ON sessions(last_opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_session_created ON entries(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attachments_session_created ON attachments(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_findings_session_created ON findings(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_drafts_session_updated ON drafts(session_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_runs_session_created ON ai_runs(session_id, created_at);

PRAGMA user_version = 3;
"#;
