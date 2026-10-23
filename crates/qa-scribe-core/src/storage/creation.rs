use rusqlite::{Connection, OptionalExtension};

use crate::Result;

use super::{ensure_column, with_immediate_tx};

const REVISION_TRIGGER: &str = "CREATE TRIGGER note_source_revision AFTER UPDATE ON entries
WHEN (NEW.type = 'note' OR OLD.type = 'note') AND (NEW.body IS NOT OLD.body
  OR NEW.type IS NOT OLD.type OR NEW.session_id IS NOT OLD.session_id OR NEW.id IS NOT OLD.id
  OR NEW.body_json IS NOT OLD.body_json OR NEW.body_format IS NOT OLD.body_format
  OR NEW.title IS NOT OLD.title OR NEW.metadata_json IS NOT OLD.metadata_json
  OR NEW.excluded_from_generation IS NOT OLD.excluded_from_generation)
BEGIN UPDATE entries SET revision = OLD.revision + 1 WHERE id = NEW.id; END";

pub(super) fn ensure_note_revision_supported(connection: &Connection) -> Result<()> {
    let installed: Option<String> = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'note_source_revision'",
        [], |row| row.get(0),
    ).optional()?;
    if super::table_has_column(connection, "entries", "revision")?
        && installed.as_deref() == Some(REVISION_TRIGGER)
    {
        return Ok(());
    }
    with_immediate_tx(connection, |tx| {
        ensure_column(
            tx,
            "entries",
            "revision",
            "ALTER TABLE entries ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)",
        )?;
        tx.execute_batch("DROP TRIGGER IF EXISTS note_source_revision")?;
        tx.execute_batch(REVISION_TRIGGER)?;
        Ok(())
    })
}
