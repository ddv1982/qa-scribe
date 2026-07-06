use std::path::Path;

use rusqlite::{Connection, Transaction, TransactionBehavior};

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

    /// Runs `body` inside a `BEGIN IMMEDIATE` transaction on this database's
    /// connection. Commits on `Ok`, rolls back on `Err`; if `body` panics or
    /// otherwise never returns, the transaction's `Drop` impl rolls back for
    /// us, so a partial write can never be left committed.
    pub fn with_immediate_tx<T>(
        &self,
        body: impl FnOnce(&Transaction<'_>) -> Result<T>,
    ) -> Result<T> {
        with_immediate_tx(&self.connection, body)
    }
}

/// Free-function form of [`Database::with_immediate_tx`] for callers that
/// only have a `&Connection` (e.g. inside a migration helper).
pub fn with_immediate_tx<T>(
    connection: &Connection,
    body: impl FnOnce(&Transaction<'_>) -> Result<T>,
) -> Result<T> {
    let tx = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)?;
    let value = body(&tx)?;
    tx.commit()?;
    Ok(value)
}

/// The schema version this build expects `user_version` to read after
/// `initialize` returns. Bumped whenever a migration helper below changes
/// what "current" means.
///
/// Every pre-versioning build (before `user_version` was actually read back)
/// unconditionally set `user_version = 5` on every open, regardless of
/// whether the feature-detecting migrations below had genuinely converged.
/// That means databases already in the wild can carry a `user_version` of 5
/// without their schema truly being at parity with this build. `SCHEMA_VERSION`
/// is therefore deliberately > 5: any database bearing that stale value is
/// treated as "not yet current", runs the (idempotent) migration helpers one
/// final time, and settles on a `user_version` this build can trust from then
/// on. Once every database in the wild has passed through this once, future
/// bumps can go strictly by increment again.
pub const SCHEMA_VERSION: i32 = 7;

fn initialize(connection: &Connection) -> Result<()> {
    // Reject databases from a newer build before touching the file in any
    // way: the SCHEMA batch below could resurrect tables or indices a newer
    // schema dropped or renamed, and even the journal_mode pragma persists.
    // `PRAGMA user_version` needs no schema and no settings, so it is safe
    // to read first.
    let found = current_schema_version(connection)?;
    if found > SCHEMA_VERSION {
        return Err(validation(format!(
            "This database was created by a newer version of QA Scribe (schema {found} > {SCHEMA_VERSION}). Update the app to open it."
        )));
    }
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "busy_timeout", 5_000)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.execute_batch(SCHEMA)?;
    if found < SCHEMA_VERSION {
        migrate(connection)?;
        connection.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    }
    assert_no_foreign_key_violations(connection)?;
    Ok(())
}

fn current_schema_version(connection: &Connection) -> Result<i32> {
    Ok(connection.query_row("PRAGMA user_version", [], |row| row.get(0))?)
}

fn migrate(connection: &Connection) -> Result<()> {
    ensure_testware_drafts_supported(connection)?;
    ensure_blank_bodies_supported(connection)?;
    ensure_rich_body_columns_supported(connection)?;
    ensure_draft_metadata_supported(connection)?;
    ensure_cascade_fk_indices_supported(connection)?;
    Ok(())
}

/// Adds indices on every child-side foreign-key column that participates in
/// an `ON DELETE CASCADE`/`SET NULL` relationship (plus a couple of
/// frequently-filtered FK columns), so cascading a session delete — or any
/// other delete that ripples through these relationships — doesn't force a
/// full table scan of each child table. The `session_id`-keyed indices
/// created by earlier schema versions already cover the top of each cascade
/// chain; this only fills in the columns that were still missing an index.
fn ensure_cascade_fk_indices_supported(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS idx_evidence_links_finding_id ON evidence_links(finding_id);
        CREATE INDEX IF NOT EXISTS idx_evidence_links_entry_id ON evidence_links(entry_id);
        CREATE INDEX IF NOT EXISTS idx_evidence_links_attachment_id ON evidence_links(attachment_id);
        CREATE INDEX IF NOT EXISTS idx_generation_context_entries_generation_context_id ON generation_context_entries(generation_context_id);
        CREATE INDEX IF NOT EXISTS idx_generation_context_entries_entry_id ON generation_context_entries(entry_id);
        CREATE INDEX IF NOT EXISTS idx_generation_context_attachments_generation_context_id ON generation_context_attachments(generation_context_id);
        CREATE INDEX IF NOT EXISTS idx_generation_context_attachments_attachment_id ON generation_context_attachments(attachment_id);
        CREATE INDEX IF NOT EXISTS idx_drafts_ai_run_id ON drafts(ai_run_id);
        CREATE INDEX IF NOT EXISTS idx_attachments_entry_id ON attachments(entry_id);
        CREATE INDEX IF NOT EXISTS idx_generation_contexts_session_id ON generation_contexts(session_id);
        CREATE INDEX IF NOT EXISTS idx_ai_runs_generation_context_id ON ai_runs(generation_context_id);
        "#,
    )?;
    Ok(())
}

fn ensure_draft_metadata_supported(connection: &Connection) -> Result<()> {
    ensure_column(
        connection,
        "drafts",
        "metadata_json",
        "ALTER TABLE drafts ADD COLUMN metadata_json TEXT",
    )?;
    Ok(())
}

fn ensure_rich_body_columns_supported(connection: &Connection) -> Result<()> {
    ensure_column(
        connection,
        "entries",
        "body_json",
        "ALTER TABLE entries ADD COLUMN body_json TEXT",
    )?;
    ensure_column(
        connection,
        "entries",
        "body_format",
        "ALTER TABLE entries ADD COLUMN body_format TEXT NOT NULL DEFAULT 'html'",
    )?;
    ensure_column(
        connection,
        "findings",
        "body_json",
        "ALTER TABLE findings ADD COLUMN body_json TEXT",
    )?;
    ensure_column(
        connection,
        "findings",
        "body_format",
        "ALTER TABLE findings ADD COLUMN body_format TEXT NOT NULL DEFAULT 'html'",
    )?;
    ensure_column(
        connection,
        "drafts",
        "body_json",
        "ALTER TABLE drafts ADD COLUMN body_json TEXT",
    )?;
    ensure_column(
        connection,
        "drafts",
        "body_format",
        "ALTER TABLE drafts ADD COLUMN body_format TEXT NOT NULL DEFAULT 'html'",
    )?;
    Ok(())
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    alter_sql: &str,
) -> Result<()> {
    if table_has_column(connection, table, column)? {
        return Ok(());
    }
    connection.execute_batch(alter_sql)?;
    Ok(())
}

fn table_has_column(connection: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(columns.iter().any(|name| name == column))
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

    let body_json_expr = optional_column_select_expr(connection, "drafts", "body_json", "NULL")?;
    let body_format_expr =
        optional_column_select_expr(connection, "drafts", "body_format", "'html'")?;
    let metadata_json_expr =
        optional_column_select_expr(connection, "drafts", "metadata_json", "NULL")?;

    with_immediate_tx(connection, |tx| {
        tx.execute_batch(&format!(
            r#"
            ALTER TABLE drafts RENAME TO drafts_old;

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

            INSERT INTO drafts (id, session_id, ai_run_id, kind, title, body, body_json, body_format, metadata_json, created_at, updated_at)
            SELECT id, session_id, ai_run_id, kind, title, body, {body_json_expr}, {body_format_expr}, {metadata_json_expr}, created_at, updated_at
            FROM drafts_old;

            DROP TABLE drafts_old;
            CREATE INDEX IF NOT EXISTS idx_drafts_session_updated ON drafts(session_id, updated_at);
            "#,
        ))?;
        assert_no_foreign_key_violations(tx)
    })
}

fn ensure_blank_bodies_supported(connection: &Connection) -> Result<()> {
    let rebuild_entries = body_has_required_length_check(connection, "entries")?;
    let rebuild_findings = body_has_required_length_check(connection, "findings")?;
    if !rebuild_entries && !rebuild_findings {
        return Ok(());
    }

    connection.pragma_update(None, "foreign_keys", "OFF")?;
    let migration_result = with_immediate_tx(connection, |tx| {
        if rebuild_entries {
            rebuild_entries_without_body_length_check(tx)?;
        }
        if rebuild_findings {
            rebuild_findings_without_body_length_check(tx)?;
        }
        assert_no_foreign_key_violations(tx)
    });
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
    let body_json_expr = optional_column_select_expr(connection, "entries", "body_json", "NULL")?;
    let body_format_expr =
        optional_column_select_expr(connection, "entries", "body_format", "'html'")?;

    connection.execute_batch(&format!(
        r#"
        DROP TABLE IF EXISTS entries_new;

        CREATE TABLE entries_new (
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

        INSERT INTO entries_new (
          id, session_id, type, title, body, body_json, body_format, metadata_json, excluded_from_generation, created_at, updated_at
        )
        SELECT id, session_id, type, title, body, {body_json_expr}, {body_format_expr}, metadata_json, excluded_from_generation, created_at, updated_at
        FROM entries;

        DROP TABLE entries;
        ALTER TABLE entries_new RENAME TO entries;
        CREATE INDEX IF NOT EXISTS idx_entries_session_created ON entries(session_id, created_at);
        "#,
    ))?;
    Ok(())
}

fn rebuild_findings_without_body_length_check(connection: &Connection) -> Result<()> {
    let body_json_expr = optional_column_select_expr(connection, "findings", "body_json", "NULL")?;
    let body_format_expr =
        optional_column_select_expr(connection, "findings", "body_format", "'html'")?;

    connection.execute_batch(&format!(
        r#"
        DROP TABLE IF EXISTS findings_new;

        CREATE TABLE findings_new (
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

        INSERT INTO findings_new (id, session_id, title, body, body_json, body_format, kind, metadata_json, created_at, updated_at)
        SELECT id, session_id, title, body, {body_json_expr}, {body_format_expr}, kind, metadata_json, created_at, updated_at
        FROM findings;

        DROP TABLE findings;
        ALTER TABLE findings_new RENAME TO findings;
        CREATE INDEX IF NOT EXISTS idx_findings_session_created ON findings(session_id, created_at);
        "#,
    ))?;
    Ok(())
}

fn optional_column_select_expr(
    connection: &Connection,
    table: &str,
    column: &str,
    fallback: &str,
) -> Result<String> {
    if table_has_column(connection, table, column)? {
        Ok(column.to_string())
    } else {
        Ok(fallback.to_string())
    }
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
  body_json TEXT,
  body_format TEXT NOT NULL DEFAULT 'html',
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
  body_json TEXT,
  body_format TEXT NOT NULL DEFAULT 'html',
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
  body_json TEXT,
  body_format TEXT NOT NULL DEFAULT 'html',
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_last_opened ON sessions(last_opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_session_created ON entries(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attachments_session_created ON attachments(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_findings_session_created ON findings(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_drafts_session_updated ON drafts(session_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_runs_session_created ON ai_runs(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_evidence_links_finding_id ON evidence_links(finding_id);
CREATE INDEX IF NOT EXISTS idx_evidence_links_entry_id ON evidence_links(entry_id);
CREATE INDEX IF NOT EXISTS idx_evidence_links_attachment_id ON evidence_links(attachment_id);
CREATE INDEX IF NOT EXISTS idx_generation_context_entries_generation_context_id ON generation_context_entries(generation_context_id);
CREATE INDEX IF NOT EXISTS idx_generation_context_entries_entry_id ON generation_context_entries(entry_id);
CREATE INDEX IF NOT EXISTS idx_generation_context_attachments_generation_context_id ON generation_context_attachments(generation_context_id);
CREATE INDEX IF NOT EXISTS idx_generation_context_attachments_attachment_id ON generation_context_attachments(attachment_id);
CREATE INDEX IF NOT EXISTS idx_drafts_ai_run_id ON drafts(ai_run_id);
CREATE INDEX IF NOT EXISTS idx_attachments_entry_id ON attachments(entry_id);
CREATE INDEX IF NOT EXISTS idx_generation_contexts_session_id ON generation_contexts(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_runs_generation_context_id ON ai_runs(generation_context_id);
"#;

#[cfg(test)]
mod tests;
