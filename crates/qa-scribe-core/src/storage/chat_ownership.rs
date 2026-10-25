use crate::Result;
use rusqlite::Connection;

pub(super) fn migrate(connection: &Connection) -> Result<()> {
    for (name, sql) in [
        (
            "owner_kind",
            "ALTER TABLE chat_drafts ADD COLUMN owner_kind TEXT NOT NULL DEFAULT 'notes'",
        ),
        (
            "owner_record_id",
            "ALTER TABLE chat_drafts ADD COLUMN owner_record_id TEXT",
        ),
        (
            "composer_intent",
            "ALTER TABLE chat_drafts ADD COLUMN composer_intent TEXT NOT NULL DEFAULT 'message' CHECK (composer_intent IN ('message','refine_record','draft_jira'))",
        ),
        (
            "last_active_at",
            "ALTER TABLE chat_drafts ADD COLUMN last_active_at TEXT NOT NULL DEFAULT ''",
        ),
        (
            "last_active_order",
            "ALTER TABLE chat_drafts ADD COLUMN last_active_order INTEGER NOT NULL DEFAULT 0 CHECK (last_active_order >= 0)",
        ),
    ] {
        super::ensure_column(connection, "chat_drafts", name, sql)?;
    }
    connection.execute_batch("WITH activity AS (
        SELECT d.id, MAX(d.created_at, COALESCE((SELECT MAX(m.created_at) FROM chat_messages m WHERE m.draft_id=d.id), d.created_at)) AS active_at FROM chat_drafts d
      ), ordered AS (
        SELECT id, active_at, ROW_NUMBER() OVER (ORDER BY active_at, id) AS activity_order FROM activity
      ) UPDATE chat_drafts SET last_active_at=(SELECT active_at FROM ordered WHERE ordered.id=chat_drafts.id),
        last_active_order=(SELECT activity_order FROM ordered WHERE ordered.id=chat_drafts.id);")?;
    Ok(())
}

pub(super) fn install(connection: &Connection) -> Result<()> {
    connection.execute_batch(r#"
DROP INDEX IF EXISTS idx_chat_active_session;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_active_notes ON chat_drafts(session_id) WHERE archived=0 AND owner_kind='notes';
CREATE INDEX IF NOT EXISTS idx_chat_owner_activity ON chat_drafts(session_id,owner_kind,owner_record_id,last_active_order DESC);
CREATE INDEX IF NOT EXISTS idx_chat_session_activity ON chat_drafts(session_id,last_active_order DESC);
CREATE INDEX IF NOT EXISTS idx_chat_refinements_draft ON chat_refinements(draft_id);
CREATE TRIGGER IF NOT EXISTS chat_owner_valid_insert BEFORE INSERT ON chat_drafts
WHEN NOT ((NEW.owner_kind='notes' AND NEW.owner_record_id IS NULL)
 OR (NEW.owner_kind IN ('finding','test_cases_draft') AND NEW.owner_record_id IS NOT NULL AND length(trim(NEW.owner_record_id))>0))
 OR NEW.owner_kind IS NULL
BEGIN SELECT RAISE(ABORT, 'Invalid conversation owner'); END;
CREATE TRIGGER IF NOT EXISTS chat_owner_immutable BEFORE UPDATE ON chat_drafts
WHEN NEW.id IS NOT OLD.id OR NEW.session_id IS NOT OLD.session_id
 OR NEW.owner_kind IS NOT OLD.owner_kind OR NEW.owner_record_id IS NOT OLD.owner_record_id
BEGIN SELECT RAISE(ABORT, 'Conversation owner is immutable'); END;
DROP TRIGGER IF EXISTS chat_receipt_immutable;
CREATE TRIGGER chat_receipt_immutable BEFORE UPDATE ON chat_drafts
WHEN OLD.submitted_at IS NOT NULL AND (
 NEW.submitted_at IS NOT OLD.submitted_at OR NEW.submitted_note_id IS NOT OLD.submitted_note_id
 OR NEW.composer IS NOT OLD.composer OR NEW.composer_intent IS NOT OLD.composer_intent
 OR NEW.revision IS NOT OLD.revision OR NEW.mode IS NOT OLD.mode
 OR NEW.id IS NOT OLD.id OR NEW.session_id IS NOT OLD.session_id)
BEGIN SELECT RAISE(ABORT, 'Submitted chat is immutable'); END;
"#)?;
    Ok(())
}
