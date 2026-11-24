pub(super) const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS chat_log_capture_shares (
  capture_id TEXT PRIMARY KEY REFERENCES test_run_log_captures(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('claude_code', 'codex_cli'))
);
CREATE TABLE IF NOT EXISTS chat_suggestion_log_captures (
  suggestion_id TEXT NOT NULL REFERENCES chat_test_run_suggestions(id) ON DELETE CASCADE,
  capture_id TEXT NOT NULL REFERENCES chat_log_capture_shares(capture_id) ON DELETE CASCADE,
  attached INTEGER NOT NULL DEFAULT 0 CHECK (attached IN (0, 1)),
  PRIMARY KEY (suggestion_id, capture_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_suggestion_log_attachment
ON chat_suggestion_log_captures(capture_id) WHERE attached = 1;
CREATE TRIGGER IF NOT EXISTS chat_log_capture_owner
BEFORE INSERT ON test_run_log_captures
WHEN (NEW.origin = 'ask_ai' AND NOT EXISTS (
  SELECT 1 FROM chat_drafts d WHERE d.id = NEW.conversation_id AND d.session_id = NEW.session_id
    AND d.owner_kind = 'test_run' AND d.owner_record_id = NEW.run_id AND d.archived = 0
)) OR (NEW.origin = 'tester' AND NEW.conversation_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'Log evidence must belong to its test run conversation'); END;
CREATE TRIGGER IF NOT EXISTS chat_log_suggestion_owner
BEFORE INSERT ON chat_suggestion_log_captures
WHEN NOT EXISTS (
  SELECT 1 FROM test_run_log_captures c
  JOIN chat_test_run_suggestions s ON s.id = NEW.suggestion_id
  JOIN chat_messages a ON a.id = s.assistant_message_id
  WHERE c.id = NEW.capture_id AND c.origin = 'ask_ai' AND c.conversation_id = a.draft_id
)
BEGIN SELECT RAISE(ABORT, 'Log evidence must belong to the suggestion conversation'); END;
CREATE TRIGGER IF NOT EXISTS chat_log_attachment_detached
AFTER UPDATE OF case_id ON test_run_log_captures
WHEN NEW.case_id IS NULL AND OLD.case_id IS NOT NULL
BEGIN UPDATE chat_suggestion_log_captures SET attached = 0 WHERE capture_id = NEW.id AND attached = 1; END;
CREATE TRIGGER IF NOT EXISTS chat_log_unattached_delete
BEFORE DELETE ON chat_drafts
BEGIN DELETE FROM test_run_log_captures WHERE conversation_id = OLD.id AND case_id IS NULL; END;
";
