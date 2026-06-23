use std::path::Path;

use rusqlite::Connection;

use crate::Result;

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
    connection.execute_batch(SCHEMA)?;
    migrate(connection)?;
    Ok(())
}

fn migrate(connection: &Connection) -> Result<()> {
    ensure_testware_drafts_supported(connection)?;
    connection.pragma_update(None, "user_version", 2)?;
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
        "#,
    )?;

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
  body TEXT NOT NULL CHECK (length(body) > 0),
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
  body TEXT NOT NULL CHECK (length(body) > 0),
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

PRAGMA user_version = 2;
"#;
