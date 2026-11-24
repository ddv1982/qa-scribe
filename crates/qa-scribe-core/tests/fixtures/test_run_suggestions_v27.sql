CREATE TABLE IF NOT EXISTS chat_test_run_suggestions (
  id TEXT PRIMARY KEY,
  assistant_message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES test_run_cases(id) ON DELETE CASCADE,
  result TEXT CHECK (result IN ('not_run', 'passed', 'failed', 'blocked')),
  notes_json TEXT,
  rationale TEXT NOT NULL,
  base_fingerprint TEXT NOT NULL,
  applied_fingerprint TEXT,
  previous_result TEXT,
  previous_notes_json TEXT,
  previous_remark TEXT,
  UNIQUE (assistant_message_id, case_id),
  CHECK (result IS NOT NULL OR notes_json IS NOT NULL),
  CHECK (result IS NULL OR length(trim(rationale)) > 0),
  CHECK ((applied_fingerprint IS NULL) = (previous_result IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_chat_test_run_suggestions_case ON chat_test_run_suggestions(case_id);

CREATE TRIGGER IF NOT EXISTS chat_test_run_suggestion_owner BEFORE INSERT ON chat_test_run_suggestions
WHEN NOT EXISTS (
  SELECT 1 FROM chat_messages a
  JOIN chat_messages u ON u.draft_id = a.draft_id AND u.turn_id = a.turn_id AND u.role = 'user'
  JOIN chat_test_run_sources s ON s.message_id = u.id AND s.turn_id = a.turn_id
  WHERE a.id = NEW.assistant_message_id AND a.role = 'assistant'
    AND s.case_id = NEW.case_id AND s.fingerprint = NEW.base_fingerprint
)
BEGIN SELECT RAISE(ABORT, 'Suggested case must belong to this test run attempt'); END;
