pub(super) const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS test_run_log_captures (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES chat_drafts(id) ON DELETE SET NULL,
  origin TEXT NOT NULL CHECK (origin IN ('tester', 'ask_ai')),
  sources_json TEXT NOT NULL CHECK (json_valid(sources_json)),
  kql TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  executed_at TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count BETWEEN 0 AND 500),
  truncated INTEGER NOT NULL CHECK (truncated IN (0, 1)),
  result_json TEXT NOT NULL CHECK (json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 262144),
  portal_url TEXT NOT NULL,
  case_id TEXT REFERENCES test_run_cases(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_log_captures_run_case ON test_run_log_captures(run_id, case_id);
CREATE INDEX IF NOT EXISTS idx_log_captures_case ON test_run_log_captures(case_id);
CREATE INDEX IF NOT EXISTS idx_log_captures_conversation ON test_run_log_captures(conversation_id);
CREATE TRIGGER IF NOT EXISTS log_capture_insert_owner
BEFORE INSERT ON test_run_log_captures
WHEN NOT EXISTS (SELECT 1 FROM test_runs WHERE id = NEW.run_id AND session_id = NEW.session_id)
  OR (NEW.case_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM test_run_cases WHERE id = NEW.case_id AND run_id = NEW.run_id))
BEGIN SELECT RAISE(ABORT, 'Log evidence must belong to the test run'); END;
CREATE TRIGGER IF NOT EXISTS log_capture_update_owner
BEFORE UPDATE OF case_id ON test_run_log_captures
WHEN NEW.case_id IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM test_run_cases WHERE id = NEW.case_id AND run_id = NEW.run_id)
BEGIN SELECT RAISE(ABORT, 'Log evidence must belong to the test run'); END;
CREATE TRIGGER IF NOT EXISTS log_capture_case_insert_limit
BEFORE INSERT ON test_run_log_captures
WHEN NEW.case_id IS NOT NULL AND
  (SELECT COUNT(*) FROM test_run_log_captures WHERE case_id = NEW.case_id) >= 10
BEGIN SELECT RAISE(ABORT, 'At most 10 captures can be attached to a test case'); END;
CREATE TRIGGER IF NOT EXISTS log_capture_case_update_limit
BEFORE UPDATE OF case_id ON test_run_log_captures
WHEN NEW.case_id IS NOT NULL AND NEW.case_id IS NOT OLD.case_id AND
  (SELECT COUNT(*) FROM test_run_log_captures WHERE case_id = NEW.case_id) >= 10
BEGIN SELECT RAISE(ABORT, 'At most 10 captures can be attached to a test case'); END;
CREATE TRIGGER IF NOT EXISTS log_capture_immutable
BEFORE UPDATE OF id, session_id, run_id, origin, sources_json, kql, starts_at, ends_at,
  executed_at, row_count, truncated, result_json, portal_url ON test_run_log_captures
BEGIN SELECT RAISE(ABORT, 'Log evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS log_capture_conversation_immutable
BEFORE UPDATE OF conversation_id ON test_run_log_captures
WHEN NEW.conversation_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Log evidence cannot change conversation'); END;
";
