use super::{SessionService, chat_rows as rows, now, require_row_in_session, require_session};
use crate::{Result, domain::*, error::validation};
use rusqlite::params;

impl SessionService {
    pub fn begin_record_chat(&self, request: BeginRecordChatRequest) -> Result<ChatState> {
        self.database.with_immediate_tx(|tx| {
            let owner = ConversationOwner::Record { session_id: request.session_id.clone(), record: request.record.clone() };
            let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_drafts WHERE id=?1)", [&request.draft_id], |r| r.get(0))?;
            if exists {
                let chat = rows::read(tx, &request.draft_id)?;
                if chat.owner != owner { return Err(validation("Launch ID belongs to another conversation owner")); }
                return Ok(chat);
            }
            uuid::Uuid::parse_str(&request.draft_id).map_err(|_| validation("Conversation launch ID must be a UUID"))?;
            require_session(tx, &request.session_id)?;
            let (kind, record_id) = request.record.stored();
            rows::text("Conversation record ID", record_id, false)?;
            let table = if kind == "finding" { "findings" } else { "drafts" };
            require_row_in_session(tx, table, record_id, &request.session_id, "Conversation record must belong to the Session")?;
            if kind == "test_cases_draft" {
                let stored_kind: String = tx.query_row("SELECT kind FROM drafts WHERE id=?1", [record_id], |r| r.get(0))?;
                if stored_kind != DraftKind::Testware.as_str() { return Err(validation("Only Test cases drafts can own a record conversation")); }
            }
            tx.execute("INSERT INTO chat_drafts (id,session_id,owner_kind,owner_record_id,mode,created_at) VALUES (?1,?2,?3,?4,'chat',?5)", params![request.draft_id,request.session_id,kind,record_id,now()])?;
            rows::touch_activity(tx, &request.draft_id)?;
            rows::read(tx, &request.draft_id)
        })
    }

    pub fn read_chat(&self, reference: &ChatRef) -> Result<ChatState> {
        rows::owned_id(self.database.connection(), reference)
    }

    pub fn activate_chat(&self, reference: &ChatRef) -> Result<ChatState> {
        self.database.with_immediate_tx(|tx| {
            rows::owned_id(tx, reference)?;
            rows::touch_activity(tx, &reference.draft_id)?;
            rows::read(tx, &reference.draft_id)
        })
    }

    pub fn list_chat_history(&self, scope: ChatHistoryScope) -> Result<Vec<ChatHistoryEntry>> {
        let (session_id, owner_filter) = match &scope {
            ChatHistoryScope::Notes { session_id } => (session_id, Some(("notes", None))),
            ChatHistoryScope::Record { session_id, record } => {
                let (kind, id) = record.stored();
                (session_id, Some((kind, Some(id))))
            }
            ChatHistoryScope::Session { session_id } => (session_id, None),
        };
        let connection = self.database.connection();
        require_session(connection, session_id)?;
        let mut stages = std::collections::HashMap::<String, Vec<StageOrigin>>::new();
        for origin in super::chat_refinements::staged_origins(connection, session_id)? {
            stages
                .entry(origin.reference.draft_id.clone())
                .or_default()
                .push(origin);
        }
        let predicate = if owner_filter.is_some() {
            "AND owner_kind=?2 AND owner_record_id IS ?3"
        } else {
            ""
        };
        let sql = format!("SELECT id,owner_kind,owner_record_id,created_at,last_active_at,last_active_order,archived,submitted_note_id,submitted_at,
            substr(CASE WHEN length(trim(composer))>0 THEN composer ELSE COALESCE((SELECT text FROM chat_messages WHERE draft_id=d.id ORDER BY sequence LIMIT 1),'') END,1,160),
            length(composer)>0 OR composer_intent!='message' OR EXISTS(SELECT 1 FROM chat_messages WHERE draft_id=d.id) OR EXISTS(SELECT 1 FROM chat_composer_images WHERE draft_id=d.id),
            (SELECT status FROM chat_messages WHERE draft_id=d.id AND role='user' ORDER BY sequence DESC LIMIT 1)
            FROM chat_drafts d WHERE session_id=?1 {predicate} ORDER BY last_active_order DESC,id");
        let mut statement = connection.prepare(&sql)?;
        let mut query = if let Some((kind, record_id)) = owner_filter {
            statement.query(params![session_id, kind, record_id])?
        } else {
            statement.query([session_id])?
        };
        let mut history = Vec::new();
        while let Some(row) = query.next()? {
            let draft_id: String = row.get(0)?;
            let kind: String = row.get(1)?;
            let note_id: Option<String> = row.get(7)?;
            let submitted_at: Option<String> = row.get(8)?;
            let submission = match (note_id, submitted_at) {
                (Some(note_id), Some(submitted_at)) => Some(ChatSubmissionReceipt {
                    draft_id: draft_id.clone(),
                    note_id,
                    submitted_at,
                }),
                (None, None) => None,
                _ => return Err(validation("Invalid stored chat receipt")),
            };
            history.push(ChatHistoryEntry {
                reference: ChatRef {
                    session_id: session_id.clone(),
                    draft_id: draft_id.clone(),
                },
                owner: ConversationOwner::from_stored(session_id.clone(), &kind, row.get(2)?)?,
                created_at: row.get(3)?,
                last_active_at: row.get(4)?,
                last_active_order: row.get(5)?,
                archived: row.get(6)?,
                submission,
                preview: row.get(9)?,
                has_content: row.get(10)?,
                last_turn_status: row
                    .get::<_, Option<String>>(11)?
                    .as_deref()
                    .map(ChatTurnStatus::from_stored)
                    .transpose()?,
                unresolved_stages: stages.remove(&draft_id).unwrap_or_default(),
            });
        }
        Ok(history)
    }
}
