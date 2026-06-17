import type Database from 'better-sqlite3'

export function migrate(sqlite: Database.Database): void {
  const currentVersion = Number(sqlite.pragma('user_version', { simple: true }) ?? 0)
  const migrations = [
    {
      version: 1,
      sql: `
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          test_target TEXT,
          charter TEXT,
          environment TEXT,
          build_version TEXT,
          related_reference TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_opened_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS entries (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK (type IN ('note', 'observation', 'api_response', 'log', 'screenshot', 'finding_candidate')),
          title TEXT,
          body TEXT NOT NULL,
          metadata_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          excluded_from_generation INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS attachments (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
          filename TEXT NOT NULL,
          mime_type TEXT,
          size_bytes INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          relative_path TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS findings (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          kind TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS evidence_links (
          id TEXT PRIMARY KEY,
          finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
          entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
          attachment_id TEXT REFERENCES attachments(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL
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

        CREATE TABLE IF NOT EXISTS ai_runs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          generation_context_id TEXT REFERENCES generation_contexts(id) ON DELETE SET NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          prompt_version TEXT NOT NULL,
          status TEXT NOT NULL,
          error_message TEXT,
          created_at TEXT NOT NULL,
          completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS drafts (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          ai_run_id TEXT REFERENCES ai_runs(id) ON DELETE SET NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `
    },
    {
      version: 2,
      sql: `
        CREATE TABLE IF NOT EXISTS generation_context_attachments (
          id TEXT PRIMARY KEY,
          generation_context_id TEXT NOT NULL REFERENCES generation_contexts(id) ON DELETE CASCADE,
          attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
          included INTEGER NOT NULL DEFAULT 1
        );
      `
    },
    {
      version: 3,
      sql: `
        ALTER TABLE ai_runs ADD COLUMN reasoning_effort TEXT;
      `
    },
    {
      version: 4,
      sql: `
        ALTER TABLE findings ADD COLUMN metadata_json TEXT;
      `
    },
    {
      version: 5,
      sql: `
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `
    }
  ]

  const pending = migrations.filter((migration) => migration.version > currentVersion)
  if (pending.length === 0) return

  const runMigrations = sqlite.transaction(() => {
    for (const migration of pending) {
      sqlite.exec(migration.sql)
      sqlite.pragma(`user_version = ${migration.version}`)
    }
  })

  runMigrations()
}
