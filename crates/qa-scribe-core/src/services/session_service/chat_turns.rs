use super::{SessionService, chat_rows as rows, new_id, now, require_row_in_session};
use crate::{Result, domain::*, error::validation};
use rusqlite::{Connection, params};

impl SessionService {
    /// Explicit retry of only the latest terminal user message, never a new transcript entry.
    pub fn retry_chat_turn(&self, request: ChatStartRequest) -> Result<ChatTurnStarted> {
        self.database.with_immediate_tx(|tx| {
            let chat = rows::checked(tx, &request.scope)?;
            rows::editable(&chat)?;
            rows::idle(&chat)?;
            if !chat.composer.is_empty() || !chat.composer_images.is_empty() {
                return Err(validation("Clear the Chat composer before retrying the previous message"));
            }
            let message = chat.messages.last().filter(|m| m.role == ChatRole::User
                && matches!(m.status, ChatTurnStatus::Failed | ChatTurnStatus::Cancelled | ChatTurnStatus::Interrupted))
                .ok_or_else(|| validation("The latest Chat message is not retryable"))?;
            super::chat_context::validate_owner(tx, &chat.session_id, &message.context)?;
            let turn_id = new_id();
            tx.execute("UPDATE chat_messages SET turn_id = ?1, status = 'running', error_message = NULL, ai_run_id = NULL WHERE id = ?2",
                params![turn_id, message.id])?;
            rows::bump(tx, &chat.draft_id)?;
            Ok(ChatTurnStarted { chat: rows::read(tx, &chat.draft_id)?, turn_id })
        })
    }

    /// Associates a running AI Run before provider execution. Returns the new chat revision.
    pub fn associate_chat_turn_ai_run(
        &self,
        request: ChatAssociateRunRequest,
    ) -> Result<ChatState> {
        self.database.with_immediate_tx(|tx| {
            let chat = rows::checked(tx, &request.scope)?;
            guard_association(&chat, &request.turn_id, None)?;
            running_run(tx, &chat.session_id, &request.ai_run_id)?;
            let used: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_messages WHERE ai_run_id = ?1)",
                [&request.ai_run_id], |r| r.get(0))?;
            if used { return Err(validation("AI Run is already associated with a Chat turn")); }
            tx.execute("UPDATE chat_messages SET ai_run_id = ?1 WHERE draft_id = ?2 AND turn_id = ?3 AND role = 'user' AND status = 'running'",
                params![request.ai_run_id, chat.draft_id, request.turn_id])?;
            rows::bump(tx, &chat.draft_id)?;
            rows::read(tx, &chat.draft_id)
        })
    }

    pub fn finish_chat_turn_with_ai_run(
        &self,
        request: ChatFinishRequest,
        ai_run_id: &str,
    ) -> Result<ChatState> {
        self.database.with_immediate_tx(|tx| {
            running_run(tx, &request.scope.session_id, ai_run_id)?;
            let chat = finish(tx, &request, Some(ai_run_id))?;
            let changed = tx.execute(
                "UPDATE ai_runs SET status = 'completed', error_message = NULL, completed_at = ?1 WHERE id = ?2 AND status = 'running'",
                params![now(), ai_run_id],
            )?;
            if changed != 1 { return Err(validation("AI Run is no longer running")); }
            rows::read(tx, &chat.draft_id)
        })
    }

    pub fn fail_chat_turn_with_ai_run(
        &self,
        request: ChatFailRequest,
        ai_run_id: &str,
    ) -> Result<ChatState> {
        self.database.with_immediate_tx(|tx| {
            running_run(tx, &request.scope.session_id, ai_run_id)?;
            let chat = fail(tx, &request, Some(ai_run_id))?;
            let changed = tx.execute(
                "UPDATE ai_runs SET status = 'failed', error_message = ?1, completed_at = ?2 WHERE id = ?3 AND status = 'running'",
                params![request.error_message, now(), ai_run_id],
            )?;
            if changed != 1 { return Err(validation("AI Run is no longer running")); }
            rows::read(tx, &chat.draft_id)
        })
    }
}

fn running_run(connection: &Connection, session_id: &str, id: &str) -> Result<()> {
    require_row_in_session(
        connection,
        "ai_runs",
        id,
        session_id,
        "Chat AI Run must belong to the Session",
    )?;
    let status: String =
        connection.query_row("SELECT status FROM ai_runs WHERE id = ?1", [id], |r| {
            r.get(0)
        })?;
    if status != "running" {
        return Err(validation("AI Run is no longer running"));
    }
    Ok(())
}

fn guard_association(chat: &ChatState, turn_id: &str, expected_run: Option<&str>) -> Result<()> {
    rows::active_turn(chat, turn_id)?;
    let user = chat
        .messages
        .iter()
        .find(|m| m.turn_id == turn_id && m.role == ChatRole::User)
        .ok_or_else(|| validation("Chat user message is missing"))?;
    if user.ai_run_id.as_deref() != expected_run {
        return Err(validation(
            "Chat turn AI Run association does not match. Use the atomic lifecycle API for associated turns.",
        ));
    }
    Ok(())
}

// Connection helpers run within the caller's transaction, never create nested transactions.
pub(super) fn finish(
    connection: &Connection,
    request: &ChatFinishRequest,
    ai_run_id: Option<&str>,
) -> Result<ChatState> {
    rows::text("Assistant response", &request.assistant_text, false)?;
    let chat = rows::checked(connection, &request.scope)?;
    guard_association(&chat, &request.turn_id, ai_run_id)?;
    let user = chat
        .messages
        .iter()
        .find(|m| m.turn_id == request.turn_id && m.role == ChatRole::User)
        .ok_or_else(|| validation("User message is missing"))?;
    let (assistant_text, proposal) =
        super::chat_refinements::completed(connection, user, &request.assistant_text)?;
    rows::text("Assistant response", &assistant_text, false)?;
    rows::append_capacity(&chat, &assistant_text, 1)?;
    connection.execute("UPDATE chat_messages SET status = 'completed' WHERE draft_id = ?1 AND turn_id = ?2 AND status = 'running'",
        params![chat.draft_id, request.turn_id])?;
    rows::append(
        connection,
        &chat.draft_id,
        &request.turn_id,
        ChatRole::Assistant,
        &assistant_text,
        ChatTurnStatus::Completed,
    )?;
    if let Some(id) = ai_run_id {
        connection.execute("UPDATE chat_messages SET ai_run_id = ?1 WHERE draft_id = ?2 AND turn_id = ?3 AND role = 'assistant'",
            params![id, chat.draft_id, request.turn_id])?;
    }
    if let Some(proposal) = proposal {
        super::chat_refinements::insert(connection, &chat.draft_id, &request.turn_id, proposal)?;
    }
    rows::bump(connection, &chat.draft_id)?;
    rows::read(connection, &chat.draft_id)
}

pub(super) fn fail(
    connection: &Connection,
    request: &ChatFailRequest,
    ai_run_id: Option<&str>,
) -> Result<ChatState> {
    rows::text("Chat error", &request.error_message, true)?;
    let chat = rows::checked(connection, &request.scope)?;
    guard_association(&chat, &request.turn_id, ai_run_id)?;
    connection.execute("UPDATE chat_messages SET status = ?1, error_message = ?2 WHERE draft_id = ?3 AND turn_id = ?4 AND status = 'running'",
        params![request.kind.as_str(), request.error_message, chat.draft_id, request.turn_id])?;
    rows::bump(connection, &chat.draft_id)?;
    rows::read(connection, &chat.draft_id)
}
