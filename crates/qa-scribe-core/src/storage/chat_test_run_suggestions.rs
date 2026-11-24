pub(super) const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS chat_test_run_sources (
  message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  case_id TEXT NOT NULL REFERENCES test_run_cases(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  focused INTEGER NOT NULL DEFAULT 0 CHECK (focused IN (0, 1)),
  PRIMARY KEY (message_id, turn_id, case_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_test_run_sources_case ON chat_test_run_sources(case_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_test_run_sources_focus ON chat_test_run_sources(message_id, turn_id) WHERE focused = 1;

CREATE TRIGGER IF NOT EXISTS chat_test_run_source_owner BEFORE INSERT ON chat_test_run_sources
WHEN NOT EXISTS (
  SELECT 1 FROM chat_messages m
  JOIN chat_drafts d ON d.id = m.draft_id
  JOIN test_runs r ON r.id = d.owner_record_id AND r.session_id = d.session_id
  JOIN test_run_cases c ON c.run_id = r.id
  WHERE m.id = NEW.message_id AND m.role = 'user' AND m.turn_id = NEW.turn_id
    AND d.owner_kind = 'test_run' AND c.id = NEW.case_id
)
BEGIN SELECT RAISE(ABORT, 'Attempt source must belong to the test run'); END;
";

pub(super) const SUGGESTIONS_SCHEMA: &str = "
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
  has_log_evidence INTEGER NOT NULL DEFAULT 0 CHECK (has_log_evidence IN (0, 1)),
  UNIQUE (assistant_message_id, case_id),
  CHECK (result IS NOT NULL OR notes_json IS NOT NULL OR has_log_evidence = 1),
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
";

pub(super) fn migrate_log_evidence(connection: &rusqlite::Connection) -> rusqlite::Result<()> {
    let supports_evidence: bool = connection.query_row(
        "SELECT EXISTS (SELECT 1 FROM pragma_table_info('chat_test_run_suggestions')
          WHERE name = 'has_log_evidence')",
        [],
        |row| row.get(0),
    )?;
    if supports_evidence {
        return Ok(());
    }
    connection.execute_batch(
        "DROP TRIGGER IF EXISTS chat_test_run_suggestion_owner;
         DROP INDEX IF EXISTS idx_chat_test_run_suggestions_case;
         ALTER TABLE chat_test_run_suggestions RENAME TO legacy_chat_test_run_suggestions;",
    )?;
    connection.execute_batch(SUGGESTIONS_SCHEMA)?;
    connection.execute_batch(
        "INSERT INTO chat_test_run_suggestions (
            id, assistant_message_id, case_id, result, notes_json, rationale,
            base_fingerprint, applied_fingerprint, previous_result, previous_notes_json, previous_remark
         ) SELECT id, assistant_message_id, case_id, result, notes_json, rationale,
            base_fingerprint, applied_fingerprint, previous_result, previous_notes_json, previous_remark
         FROM legacy_chat_test_run_suggestions;
         DROP TABLE legacy_chat_test_run_suggestions;",
    )
}
