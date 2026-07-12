pub(super) const SCHEMA: &str = r#"
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
CREATE INDEX IF NOT EXISTS idx_ai_runs_running_status ON ai_runs(status) WHERE status = 'running';
"#;
