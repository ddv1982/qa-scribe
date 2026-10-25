pub(super) const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS chat_response_messages (
 assistant_message_id TEXT PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,
 source_user_message_id TEXT NOT NULL UNIQUE REFERENCES chat_messages(id) ON DELETE CASCADE,
 warning_text TEXT CHECK(warning_text IS NULL OR length(warning_text) <= 240),
 question_json TEXT CHECK(question_json IS NULL OR length(CAST(question_json AS BLOB)) <= 16384)
);
CREATE TABLE IF NOT EXISTS chat_answers (
 user_message_id TEXT PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,
 assistant_message_id TEXT NOT NULL UNIQUE REFERENCES chat_response_messages(assistant_message_id) ON DELETE CASCADE
);
CREATE TRIGGER IF NOT EXISTS chat_response_valid_insert BEFORE INSERT ON chat_response_messages
WHEN NOT EXISTS (SELECT 1 FROM chat_messages a JOIN chat_messages u ON u.id=NEW.source_user_message_id
 JOIN chat_drafts d ON d.id=a.draft_id WHERE a.id=NEW.assistant_message_id AND a.role='assistant'
 AND a.status='completed' AND u.role='user' AND u.status='completed' AND a.draft_id=u.draft_id
 AND a.turn_id=u.turn_id AND d.submitted_at IS NULL AND d.archived=0)
BEGIN SELECT RAISE(ABORT, 'Invalid completed response ownership'); END;
CREATE TRIGGER IF NOT EXISTS chat_answer_valid_insert BEFORE INSERT ON chat_answers
WHEN NOT EXISTS (SELECT 1 FROM chat_messages u JOIN chat_messages a ON a.id=NEW.assistant_message_id
 JOIN chat_response_messages q ON q.assistant_message_id=a.id JOIN chat_drafts d ON d.id=u.draft_id
 WHERE u.id=NEW.user_message_id AND u.role='user' AND u.status='running' AND q.question_json IS NOT NULL
 AND u.draft_id=a.draft_id AND d.submitted_at IS NULL AND d.archived=0
 AND u.sequence=a.sequence+1)
BEGIN SELECT RAISE(ABORT, 'Invalid question answer ownership'); END;
CREATE TRIGGER IF NOT EXISTS chat_response_immutable BEFORE UPDATE ON chat_response_messages
BEGIN SELECT RAISE(ABORT, 'Completed response is immutable'); END;
CREATE TRIGGER IF NOT EXISTS chat_answer_immutable BEFORE UPDATE ON chat_answers
BEGIN SELECT RAISE(ABORT, 'Question answer is immutable'); END;
";
