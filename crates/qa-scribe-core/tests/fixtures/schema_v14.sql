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
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE chat_drafts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  composer TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'write_note' CHECK (mode IN ('write_note', 'chat')),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  submitted_note_id TEXT,
  submitted_at TEXT,
  created_at TEXT NOT NULL,
  CHECK ((submitted_note_id IS NULL) = (submitted_at IS NULL))
);
CREATE UNIQUE INDEX idx_chat_active_session ON chat_drafts(session_id) WHERE archived = 0;
CREATE INDEX idx_chat_drafts_session ON chat_drafts(session_id);
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES chat_drafts(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL CHECK (role = 'user' OR length(trim(text)) > 0),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'interrupted')),
  error_message TEXT,
  ai_run_id TEXT REFERENCES ai_runs(id),
  created_at TEXT NOT NULL,
  UNIQUE (draft_id, sequence),
  UNIQUE (draft_id, turn_id, role),
  CHECK (role = 'user' OR status = 'completed')
);
CREATE UNIQUE INDEX idx_chat_one_running_turn ON chat_messages(draft_id) WHERE status = 'running';
CREATE TRIGGER chat_receipt_immutable BEFORE UPDATE ON chat_drafts
WHEN OLD.submitted_at IS NOT NULL AND (
  NEW.submitted_at IS NOT OLD.submitted_at OR NEW.submitted_note_id IS NOT OLD.submitted_note_id
  OR NEW.composer IS NOT OLD.composer OR NEW.revision IS NOT OLD.revision
  OR NEW.mode IS NOT OLD.mode
  OR NEW.id IS NOT OLD.id OR NEW.session_id IS NOT OLD.session_id
)
BEGIN SELECT RAISE(ABORT, 'Submitted chat is immutable'); END;
CREATE TRIGGER chat_submitted_messages_no_delete BEFORE DELETE ON chat_messages
WHEN (SELECT submitted_at FROM chat_drafts WHERE id = OLD.draft_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Submitted chat is immutable'); END;
CREATE TRIGGER chat_submitted_messages_no_insert BEFORE INSERT ON chat_messages
WHEN (SELECT submitted_at FROM chat_drafts WHERE id = NEW.draft_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Submitted chat is immutable'); END;
CREATE TRIGGER chat_submitted_messages_no_update BEFORE UPDATE ON chat_messages
WHEN (SELECT submitted_at FROM chat_drafts WHERE id = OLD.draft_id) IS NOT NULL
  OR (SELECT submitted_at FROM chat_drafts WHERE id = NEW.draft_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Submitted chat is immutable'); END;
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('note', 'observation', 'api_response', 'log', 'screenshot', 'finding_candidate')),
  title TEXT,
  body TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  body_json TEXT,
  body_format TEXT NOT NULL DEFAULT 'html',
  metadata_json TEXT,
  excluded_from_generation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE creation_attempts (
  attempt_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('finding', 'testware')),
  state TEXT NOT NULL CHECK (state IN ('preparing', 'committed', 'aborted')),
  payload_hash TEXT,
  record_id TEXT,
  created_at TEXT NOT NULL,
  CHECK ((state = 'committed') = (record_id IS NOT NULL)),
  CHECK (state != 'committed' OR payload_hash IS NOT NULL)
);
CREATE INDEX creation_attempts_recovery ON creation_attempts(state, created_at);
CREATE TABLE creation_attempt_images (
  attempt_id TEXT NOT NULL REFERENCES creation_attempts(attempt_id) ON DELETE CASCADE,
  local_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL UNIQUE,
  relative_path TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  PRIMARY KEY (attempt_id, local_id)
);
CREATE TABLE creation_staging (
  attachment_id TEXT PRIMARY KEY NOT NULL REFERENCES creation_attempt_images(attachment_id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL UNIQUE,
  device TEXT NOT NULL,
  inode TEXT NOT NULL
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
CREATE TABLE attachment_cleanup (
  relative_path TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)
);
CREATE INDEX idx_attachment_cleanup_attempt_order
  ON attachment_cleanup(attempt_count, relative_path);
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
  model_selection_json TEXT,
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
CREATE INDEX idx_evidence_links_finding_id ON evidence_links(finding_id);
CREATE INDEX idx_evidence_links_entry_id ON evidence_links(entry_id);
CREATE INDEX idx_evidence_links_attachment_id ON evidence_links(attachment_id);
CREATE INDEX idx_generation_context_entries_generation_context_id ON generation_context_entries(generation_context_id);
CREATE INDEX idx_generation_context_entries_entry_id ON generation_context_entries(entry_id);
CREATE INDEX idx_generation_context_attachments_generation_context_id ON generation_context_attachments(generation_context_id);
CREATE INDEX idx_generation_context_attachments_attachment_id ON generation_context_attachments(attachment_id);
CREATE INDEX idx_drafts_ai_run_id ON drafts(ai_run_id);
CREATE INDEX idx_attachments_entry_id ON attachments(entry_id);
CREATE INDEX idx_generation_contexts_session_id ON generation_contexts(session_id);
CREATE INDEX idx_ai_runs_generation_context_id ON ai_runs(generation_context_id);
CREATE INDEX idx_ai_runs_running_status ON ai_runs(status) WHERE status = 'running';
CREATE INDEX idx_chat_messages_ai_run ON chat_messages(ai_run_id);
CREATE UNIQUE INDEX idx_chat_run_user ON chat_messages(ai_run_id) WHERE role = 'user' AND ai_run_id IS NOT NULL;
CREATE TRIGGER note_source_revision AFTER UPDATE ON entries
WHEN (NEW.type = 'note' OR OLD.type = 'note') AND (NEW.body IS NOT OLD.body
  OR NEW.type IS NOT OLD.type OR NEW.session_id IS NOT OLD.session_id OR NEW.id IS NOT OLD.id
  OR NEW.body_json IS NOT OLD.body_json OR NEW.body_format IS NOT OLD.body_format
  OR NEW.title IS NOT OLD.title OR NEW.metadata_json IS NOT OLD.metadata_json
  OR NEW.excluded_from_generation IS NOT OLD.excluded_from_generation)
BEGIN UPDATE entries SET revision = OLD.revision + 1 WHERE id = NEW.id; END;
CREATE TABLE chat_image_imports (
  relative_path TEXT PRIMARY KEY NOT NULL,
  temp_path TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)
);
CREATE TABLE chat_composer_images (
  draft_id TEXT NOT NULL REFERENCES chat_drafts(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachments(id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0 AND ordinal < 4),
  PRIMARY KEY (draft_id, ordinal),
  UNIQUE (draft_id, attachment_id)
);
CREATE INDEX idx_chat_composer_attachment ON chat_composer_images(attachment_id);
CREATE TABLE chat_message_images (
  message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachments(id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0 AND ordinal < 4),
  PRIMARY KEY (message_id, ordinal),
  UNIQUE (message_id, attachment_id)
);
CREATE INDEX idx_chat_message_attachment ON chat_message_images(attachment_id);
CREATE TRIGGER chat_composer_images_valid_insert BEFORE INSERT ON chat_composer_images
WHEN NOT EXISTS (SELECT 1 FROM chat_drafts d JOIN attachments a ON a.session_id = d.session_id WHERE d.id = NEW.draft_id AND a.id = NEW.attachment_id AND d.submitted_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Chat image must belong to the editable Session'); END;
CREATE TRIGGER chat_composer_images_no_update BEFORE UPDATE ON chat_composer_images
BEGIN SELECT RAISE(ABORT, 'Replace Chat composer images atomically'); END;
CREATE TRIGGER chat_composer_images_no_submitted_delete BEFORE DELETE ON chat_composer_images
WHEN (SELECT submitted_at FROM chat_drafts WHERE id = OLD.draft_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Submitted chat is immutable'); END;
CREATE TRIGGER chat_message_images_valid_insert BEFORE INSERT ON chat_message_images
WHEN NOT EXISTS (SELECT 1 FROM chat_messages m JOIN chat_drafts d ON d.id = m.draft_id JOIN attachments a ON a.session_id = d.session_id WHERE m.id = NEW.message_id AND a.id = NEW.attachment_id AND m.role = 'user' AND m.status = 'running' AND d.submitted_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Chat image must belong to the running user message Session'); END;
CREATE TRIGGER chat_message_images_no_update BEFORE UPDATE ON chat_message_images
BEGIN SELECT RAISE(ABORT, 'Sent Chat images are immutable'); END;
CREATE TRIGGER chat_message_images_no_delete BEFORE DELETE ON chat_message_images
WHEN EXISTS (SELECT 1 FROM chat_messages WHERE id = OLD.message_id)
BEGIN SELECT RAISE(ABORT, 'Sent Chat images are immutable'); END;
CREATE TRIGGER chat_image_attachment_immutable BEFORE UPDATE ON attachments
WHEN EXISTS (SELECT 1 FROM chat_composer_images WHERE attachment_id = OLD.id)
  OR EXISTS (SELECT 1 FROM chat_message_images WHERE attachment_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'Chat image attachment is immutable'); END;
PRAGMA user_version = 14;
