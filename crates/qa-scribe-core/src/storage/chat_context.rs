pub(super) const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS chat_message_contexts (
    message_id TEXT PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK(version = 1),
    context_json TEXT NOT NULL CHECK(length(CAST(context_json AS BLOB)) <= 32768)
);
CREATE TRIGGER IF NOT EXISTS chat_context_valid_insert BEFORE INSERT ON chat_message_contexts
WHEN NOT EXISTS (SELECT 1 FROM chat_messages m JOIN chat_drafts d ON d.id = m.draft_id
    WHERE m.id = NEW.message_id AND m.role = 'user' AND m.status = 'running' AND d.submitted_at IS NULL AND d.archived = 0)
BEGIN SELECT RAISE(ABORT, 'Context must belong to a running user message'); END;
CREATE TRIGGER IF NOT EXISTS chat_context_no_update BEFORE UPDATE ON chat_message_contexts
BEGIN SELECT RAISE(ABORT, 'Sent context is immutable'); END;
CREATE TRIGGER IF NOT EXISTS chat_context_no_delete BEFORE DELETE ON chat_message_contexts
WHEN EXISTS (SELECT 1 FROM chat_messages WHERE id = OLD.message_id)
BEGIN SELECT RAISE(ABORT, 'Sent context is immutable'); END;
";
