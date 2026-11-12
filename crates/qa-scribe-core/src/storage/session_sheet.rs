use crate::Result;
use rusqlite::Connection;

/// Schema 20: the Session sheet. Adds the timebox, the debrief notes and the
/// debrief time split to `sessions`. Every column is nullable, so existing
/// Sessions keep all their data and read back with an empty sheet. The
/// charter and the reference reuse `objective_notes` and `related_reference`.
pub(super) fn migrate(connection: &Connection) -> Result<()> {
    for (name, sql) in [
        (
            "timebox_minutes",
            "ALTER TABLE sessions ADD COLUMN timebox_minutes INTEGER CHECK (timebox_minutes BETWEEN 1 AND 1440)",
        ),
        (
            "debrief_notes",
            "ALTER TABLE sessions ADD COLUMN debrief_notes TEXT",
        ),
        (
            "testing_percent",
            "ALTER TABLE sessions ADD COLUMN testing_percent INTEGER CHECK (testing_percent BETWEEN 0 AND 100)",
        ),
        (
            "bug_percent",
            "ALTER TABLE sessions ADD COLUMN bug_percent INTEGER CHECK (bug_percent BETWEEN 0 AND 100)",
        ),
        (
            "setup_percent",
            "ALTER TABLE sessions ADD COLUMN setup_percent INTEGER CHECK (setup_percent BETWEEN 0 AND 100)",
        ),
    ] {
        super::ensure_column(connection, "sessions", name, sql)?;
    }
    Ok(())
}
