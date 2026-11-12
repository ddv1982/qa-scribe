use crate::Result;
use rusqlite::Connection;

/// Schema 21: the Session's acceptance criteria. Adds one nullable text
/// column to `sessions`, so existing Sessions keep all their data and read
/// back without criteria.
pub(super) fn migrate(connection: &Connection) -> Result<()> {
    super::ensure_column(
        connection,
        "sessions",
        "acceptance_criteria",
        "ALTER TABLE sessions ADD COLUMN acceptance_criteria TEXT",
    )
}
