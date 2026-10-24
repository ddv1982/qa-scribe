use rusqlite::Connection;

use crate::Result;

pub(super) fn migrate(connection: &Connection) -> Result<()> {
    let sql: String = connection.query_row(
        "SELECT sql FROM sqlite_master WHERE name = 'chat_messages' AND type = 'table'",
        [],
        |row| row.get(0),
    )?;
    if sql
        .split_whitespace()
        .collect::<String>()
        .to_lowercase()
        .contains("check(role='user'orlength(trim(text))>0)")
    {
        return Ok(());
    }
    connection.execute_batch(
        r#"
        DROP TRIGGER IF EXISTS chat_submitted_messages_no_delete;
        DROP TRIGGER IF EXISTS chat_submitted_messages_no_insert;
        DROP TRIGGER IF EXISTS chat_submitted_messages_no_update;
        CREATE TABLE chat_messages_v14 (
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
        INSERT INTO chat_messages_v14 SELECT id, draft_id, turn_id, sequence, role, text, status, error_message, ai_run_id, created_at FROM chat_messages;
        DROP TABLE chat_messages;
        ALTER TABLE chat_messages_v14 RENAME TO chat_messages;
        CREATE UNIQUE INDEX idx_chat_one_running_turn ON chat_messages(draft_id) WHERE status = 'running';
        CREATE INDEX idx_chat_messages_ai_run ON chat_messages(ai_run_id);
        CREATE UNIQUE INDEX idx_chat_run_user ON chat_messages(ai_run_id) WHERE role = 'user' AND ai_run_id IS NOT NULL;
        "#,
    )?;
    Ok(())
}

pub(super) const RELATIONSHIPS: &str = r#"
CREATE TABLE IF NOT EXISTS chat_image_imports (
  relative_path TEXT PRIMARY KEY NOT NULL,
  temp_path TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)
);
CREATE TABLE IF NOT EXISTS chat_composer_images (
  draft_id TEXT NOT NULL REFERENCES chat_drafts(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachments(id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0 AND ordinal < 4),
  PRIMARY KEY (draft_id, ordinal),
  UNIQUE (draft_id, attachment_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_composer_attachment ON chat_composer_images(attachment_id);
CREATE TABLE IF NOT EXISTS chat_message_images (
  message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachments(id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0 AND ordinal < 4),
  PRIMARY KEY (message_id, ordinal),
  UNIQUE (message_id, attachment_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_message_attachment ON chat_message_images(attachment_id);
CREATE TRIGGER IF NOT EXISTS chat_composer_images_valid_insert BEFORE INSERT ON chat_composer_images
WHEN NOT EXISTS (SELECT 1 FROM chat_drafts d JOIN attachments a ON a.session_id = d.session_id WHERE d.id = NEW.draft_id AND a.id = NEW.attachment_id AND d.submitted_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Chat image must belong to the editable Session'); END;
CREATE TRIGGER IF NOT EXISTS chat_composer_images_no_update BEFORE UPDATE ON chat_composer_images
BEGIN SELECT RAISE(ABORT, 'Replace Chat composer images atomically'); END;
CREATE TRIGGER IF NOT EXISTS chat_composer_images_no_submitted_delete BEFORE DELETE ON chat_composer_images
WHEN (SELECT submitted_at FROM chat_drafts WHERE id = OLD.draft_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Submitted chat is immutable'); END;
CREATE TRIGGER IF NOT EXISTS chat_message_images_valid_insert BEFORE INSERT ON chat_message_images
WHEN NOT EXISTS (SELECT 1 FROM chat_messages m JOIN chat_drafts d ON d.id = m.draft_id JOIN attachments a ON a.session_id = d.session_id WHERE m.id = NEW.message_id AND a.id = NEW.attachment_id AND m.role = 'user' AND m.status = 'running' AND d.submitted_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Chat image must belong to the running user message Session'); END;
CREATE TRIGGER IF NOT EXISTS chat_message_images_no_update BEFORE UPDATE ON chat_message_images
BEGIN SELECT RAISE(ABORT, 'Sent Chat images are immutable'); END;
CREATE TRIGGER IF NOT EXISTS chat_message_images_no_delete BEFORE DELETE ON chat_message_images
WHEN EXISTS (SELECT 1 FROM chat_messages WHERE id = OLD.message_id)
BEGIN SELECT RAISE(ABORT, 'Sent Chat images are immutable'); END;
CREATE TRIGGER IF NOT EXISTS chat_image_attachment_immutable BEFORE UPDATE ON attachments
WHEN EXISTS (SELECT 1 FROM chat_composer_images WHERE attachment_id = OLD.id)
  OR EXISTS (SELECT 1 FROM chat_message_images WHERE attachment_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'Chat image attachment is immutable'); END;
"#;

pub(super) const CLEANUP: &str = r#"
CREATE TABLE chat_image_cleanup (
  relative_path TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)
);
CREATE INDEX idx_chat_image_cleanup_attempt_order ON chat_image_cleanup(attempt_count, relative_path);
CREATE INDEX idx_attachments_relative_path ON attachments(relative_path);
"#;
