use super::{new_id, now, require_row_in_session, require_session};
use crate::{QaScribeError, Result, domain::*, error::validation};
use rusqlite::{Connection, OptionalExtension, params};

pub(super) fn create(connection: &Connection, session_id: &str) -> Result<ChatState> {
    let id = new_id();
    connection.execute(
        "INSERT INTO chat_drafts (id, session_id, created_at) VALUES (?1, ?2, ?3)",
        params![id, session_id, now()],
    )?;
    read(connection, &id)
}

pub(super) fn read(connection: &Connection, id: &str) -> Result<ChatState> {
    let row = connection.query_row(
        "SELECT session_id, revision, composer, mode, submitted_note_id, submitted_at FROM chat_drafts WHERE id = ?1",
        [id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i32>(1)?, r.get::<_, String>(2)?,
            r.get::<_, String>(3)?, r.get::<_, Option<String>>(4)?, r.get::<_, Option<String>>(5)?)),
    ).optional()?.ok_or_else(|| QaScribeError::NotFound(id.into()))?;
    let mut statement = connection.prepare(
        "SELECT id, turn_id, role, text, status, error_message, created_at, ai_run_id FROM chat_messages WHERE draft_id = ?1 ORDER BY sequence",
    )?;
    let rows = statement.query_map([id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, Option<String>>(5)?,
            r.get::<_, String>(6)?,
            r.get::<_, Option<String>>(7)?,
        ))
    })?;
    let mut messages = Vec::new();
    for row in rows {
        let (id, turn_id, role, text, status, error_message, created_at, ai_run_id) = row?;
        messages.push(ChatMessage {
            id,
            turn_id,
            role: ChatRole::from_stored(&role)?,
            text,
            status: ChatTurnStatus::from_stored(&status)?,
            error_message,
            created_at,
            ai_run_id,
        });
    }
    let submission = match (row.4, row.5) {
        (Some(note_id), Some(submitted_at)) => Some(ChatSubmissionReceipt {
            draft_id: id.into(),
            note_id,
            submitted_at,
        }),
        (None, None) => None,
        _ => return Err(validation("Invalid stored chat receipt")),
    };
    let mut statement = connection.prepare(&format!(
        "SELECT {} FROM ai_runs WHERE id IN (SELECT ai_run_id FROM chat_messages WHERE draft_id = ?1 AND ai_run_id IS NOT NULL) ORDER BY created_at, id",
        super::super::session_rows::AI_RUN_COLUMNS,
    ))?;
    let ai_runs = statement
        .query_map([id], super::super::session_rows::map_ai_run)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ChatState {
        session_id: row.0,
        draft_id: id.into(),
        revision: row.1,
        composer: row.2,
        mode: ChatMode::from_stored(&row.3)?,
        messages,
        ai_runs,
        submission,
    })
}

pub(super) fn owned(connection: &Connection, scope: &ChatRevision) -> Result<ChatState> {
    require_session(connection, &scope.session_id)?;
    require_row_in_session(
        connection,
        "chat_drafts",
        &scope.draft_id,
        &scope.session_id,
        "Chat draft must belong to the Session",
    )?;
    read(connection, &scope.draft_id)
}

pub(super) fn checked(connection: &Connection, scope: &ChatRevision) -> Result<ChatState> {
    let chat = owned(connection, scope)?;
    if chat.revision != scope.expected_revision {
        return Err(validation(
            "Chat changed. Reload the conversation before retrying.",
        ));
    }
    let archived: bool = connection.query_row(
        "SELECT archived FROM chat_drafts WHERE id = ?1",
        [&scope.draft_id],
        |r| r.get(0),
    )?;
    if archived {
        return Err(validation("Chat draft is no longer active"));
    }
    Ok(chat)
}

pub(super) fn editable(chat: &ChatState) -> Result<()> {
    if chat.submission.is_some() {
        return Err(validation(
            "Chat has already been submitted. Start a new conversation.",
        ));
    }
    Ok(())
}

pub(super) fn idle(chat: &ChatState) -> Result<()> {
    if chat
        .messages
        .iter()
        .any(|m| m.status == ChatTurnStatus::Running)
    {
        return Err(validation("Chat turn is still running"));
    }
    Ok(())
}

pub(super) fn active_turn(chat: &ChatState, turn_id: &str) -> Result<()> {
    editable(chat)?;
    if !chat.messages.iter().any(|m| {
        m.turn_id == turn_id && m.role == ChatRole::User && m.status == ChatTurnStatus::Running
    }) {
        return Err(validation("Chat turn is no longer running"));
    }
    Ok(())
}

pub(super) fn text(label: &str, text: &str, blank_allowed: bool) -> Result<()> {
    if !blank_allowed && text.trim().is_empty() {
        return Err(validation(format!("{label} is required")));
    }
    if text.chars().count() > TEXT_BODY_MAX_LENGTH {
        return Err(validation(format!("{label} is too long")));
    }
    Ok(())
}

/// Durable limits include failed turns, not just the completed replay projection.
pub(super) fn append_capacity(
    chat: &ChatState,
    text: &str,
    reserved_messages: usize,
) -> Result<()> {
    use crate::chat::{MAX_CHAT_MESSAGE_BYTES, MAX_CHAT_MESSAGES, MAX_CHAT_TRANSCRIPT_BYTES};
    if text.len() > MAX_CHAT_MESSAGE_BYTES {
        return Err(validation(format!(
            "Chat message exceeds {MAX_CHAT_MESSAGE_BYTES} bytes"
        )));
    }
    if chat.messages.len().saturating_add(reserved_messages) > MAX_CHAT_MESSAGES {
        return Err(validation(
            "Chat has reached its message limit. Start a new conversation.",
        ));
    }
    let total: usize = chat.messages.iter().map(|message| message.text.len()).sum();
    if total.saturating_add(text.len()) > MAX_CHAT_TRANSCRIPT_BYTES {
        return Err(validation(
            "Chat has reached its text limit. Start a new conversation.",
        ));
    }
    Ok(())
}

pub(super) fn bump(connection: &Connection, id: &str) -> Result<()> {
    connection.execute(
        "UPDATE chat_drafts SET revision = revision + 1 WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

pub(super) fn append(
    connection: &Connection,
    draft: &str,
    turn: &str,
    role: ChatRole,
    text: &str,
    status: ChatTurnStatus,
) -> Result<()> {
    connection.execute(
        "INSERT INTO chat_messages (id, draft_id, turn_id, sequence, role, text, status, created_at)
         VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sequence) + 1, 0) FROM chat_messages WHERE draft_id = ?2), ?4, ?5, ?6, ?7)",
        params![new_id(), draft, turn, role.as_str(), text, status.as_str(), now()],
    )?;
    Ok(())
}
