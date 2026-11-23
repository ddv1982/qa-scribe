pub(super) const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS chat_response_contracts (
 message_id TEXT PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,
 contract_json TEXT NOT NULL CHECK(length(CAST(contract_json AS BLOB)) <= 1024)
);
CREATE TABLE IF NOT EXISTS chat_refinements (
 id TEXT PRIMARY KEY,
 draft_id TEXT NOT NULL REFERENCES chat_drafts(id) ON DELETE CASCADE,
 user_message_id TEXT NOT NULL UNIQUE REFERENCES chat_messages(id) ON DELETE CASCADE,
 assistant_message_id TEXT NOT NULL UNIQUE REFERENCES chat_messages(id) ON DELETE CASCADE,
 proposal_json TEXT NOT NULL CHECK(length(CAST(proposal_json AS BLOB)) <= 262144)
);
CREATE TABLE IF NOT EXISTS chat_note_retry_sources (
 message_id TEXT PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,
 turn_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_note_undo (
 proposal_id TEXT PRIMARY KEY REFERENCES chat_refinements(id) ON DELETE CASCADE,
 before_body TEXT NOT NULL,
 before_json TEXT,
 before_format TEXT,
 before_fingerprint TEXT NOT NULL,
 applied_fingerprint TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_visual_undo (
 proposal_id TEXT PRIMARY KEY REFERENCES chat_refinements(id) ON DELETE CASCADE,
 record_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
 before_title TEXT NOT NULL,
 before_body TEXT NOT NULL,
 before_json TEXT,
 before_format TEXT NOT NULL,
 before_metadata TEXT,
 before_at TEXT NOT NULL,
 applied_base TEXT NOT NULL,
 applied_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS chat_contract_immutable BEFORE UPDATE ON chat_response_contracts
BEGIN SELECT RAISE(ABORT, 'Response contract is immutable'); END;
CREATE TRIGGER IF NOT EXISTS chat_refinement_editable_update BEFORE UPDATE ON chat_refinements
WHEN EXISTS(SELECT 1 FROM chat_drafts WHERE id = OLD.draft_id AND (submitted_at IS NOT NULL OR archived = 1))
BEGIN SELECT RAISE(ABORT, 'Conversation is read-only'); END;
CREATE TABLE IF NOT EXISTS chat_editor_stages (
 id TEXT PRIMARY KEY,
 proposal_id TEXT NOT NULL UNIQUE REFERENCES chat_refinements(id) ON DELETE CASCADE,
 stage_json TEXT NOT NULL CHECK(length(CAST(stage_json AS BLOB)) <= 131072)
);
CREATE TRIGGER IF NOT EXISTS chat_stage_immutable BEFORE UPDATE ON chat_editor_stages
BEGIN SELECT RAISE(ABORT, 'Editor stage is immutable'); END;
";
