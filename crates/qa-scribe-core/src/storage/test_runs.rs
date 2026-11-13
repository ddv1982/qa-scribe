/// Schema 22: test runs. A test run is a frozen copy of the test cases of one
/// saved Test cases draft (ADR 0012). Both tables are new, so existing data
/// is untouched. Deleting the draft or the Session deletes its runs, and
/// deleting a Finding only unlinks the cases that point at it. The triggers
/// lock the copied text; results, remarks, the linked Finding and
/// `updated_at` stay editable.
///
/// `UNIQUE (run_id, position)` doubles as the `run_id` index, so the cases of
/// a run need no separate one.
pub(super) const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  draft_title TEXT NOT NULL CHECK (length(trim(draft_title)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS test_run_cases (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  group_title TEXT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  body_json TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT 'not_run' CHECK (result IN ('not_run', 'passed', 'failed', 'blocked')),
  remark TEXT,
  finding_id TEXT REFERENCES findings(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, position)
);
CREATE INDEX IF NOT EXISTS idx_test_runs_session_created ON test_runs(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_test_runs_draft_id ON test_runs(draft_id);
CREATE INDEX IF NOT EXISTS idx_test_run_cases_finding_id ON test_run_cases(finding_id);
CREATE TRIGGER IF NOT EXISTS test_run_source_immutable
BEFORE UPDATE OF session_id, draft_id, draft_title, created_at ON test_runs
BEGIN SELECT RAISE(ABORT, 'Test run source is immutable'); END;
CREATE TRIGGER IF NOT EXISTS test_run_case_text_immutable
BEFORE UPDATE OF run_id, position, group_title, title, body_json ON test_run_cases
BEGIN SELECT RAISE(ABORT, 'Test run case text is immutable'); END;
";
