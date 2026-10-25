use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

use super::SessionService;
use crate::{
    Result,
    chat::{MAX_CHAT_RECORD_CONTEXT_BYTES, MAX_CHAT_RECORD_REPLAY_BYTES},
    domain::*,
    error::validation,
};

impl SessionService {
    pub fn validate_chat_context_anchor(
        &self,
        chat: &ChatState,
        context: &ChatTarget,
    ) -> Result<()> {
        validate_anchor(chat, context)
    }

    pub fn capture_chat_context(
        &self,
        session_id: &str,
        context: ChatTarget,
    ) -> Result<ChatTarget> {
        capture(self.database.connection(), session_id, context)
    }

    pub fn validate_chat_retry_context_owner(
        &self,
        session_id: &str,
        persisted_context: &ChatTarget,
    ) -> Result<()> {
        validate_retry_owner(self.database.connection(), session_id, persisted_context)
    }
}

pub(super) fn validate_retry_owner(
    connection: &Connection,
    session_id: &str,
    persisted_context: &ChatTarget,
) -> Result<()> {
    let Some(snapshot) = persisted_context.snapshot() else {
        return Ok(());
    };
    if snapshot.session_id != session_id {
        return Err(validation("Record context must belong to the chat Session"));
    }
    let owner: Option<(String, Option<String>)> = match persisted_context {
        ChatTarget::Finding { .. } => connection
            .query_row(
                "SELECT session_id FROM findings WHERE id = ?1",
                [&snapshot.record_id],
                |row| Ok((row.get(0)?, None)),
            )
            .optional()?,
        ChatTarget::TestCasesDraft { .. } => connection
            .query_row(
                "SELECT session_id, kind FROM drafts WHERE id = ?1",
                [&snapshot.record_id],
                |row| Ok((row.get(0)?, Some(row.get(1)?))),
            )
            .optional()?,
        ChatTarget::Session => unreachable!(),
    };
    let Some((owner, kind)) = owner else {
        return Ok(());
    };
    if owner != session_id {
        return Err(validation("Record context must belong to the chat Session"));
    }
    if kind.is_some_and(|kind| kind != DraftKind::Testware.as_str()) {
        return Err(validation(
            "Only Test cases drafts can be used as record context",
        ));
    }
    Ok(())
}

pub(super) fn validate_owner(
    connection: &Connection,
    session_id: &str,
    context: &ChatTarget,
) -> Result<()> {
    let Some(snapshot) = context.snapshot() else {
        return Ok(());
    };
    if snapshot.session_id != session_id {
        return Err(validation("Record context must belong to the chat Session"));
    }
    let table = match context {
        ChatTarget::Finding { .. } => "findings",
        ChatTarget::TestCasesDraft { .. } => "drafts",
        ChatTarget::Session => unreachable!(),
    };
    super::require_row_in_session(
        connection,
        table,
        &snapshot.record_id,
        session_id,
        "Record context must belong to the chat Session",
    )?;
    if matches!(context, ChatTarget::TestCasesDraft { .. }) {
        let kind: String = connection.query_row(
            "SELECT kind FROM drafts WHERE id = ?1",
            [&snapshot.record_id],
            |r| r.get(0),
        )?;
        if kind != DraftKind::Testware.as_str() {
            return Err(validation(
                "Only Test cases drafts can be used as record context",
            ));
        }
    }
    Ok(())
}

pub(super) fn capture(
    connection: &Connection,
    session_id: &str,
    mut context: ChatTarget,
) -> Result<ChatTarget> {
    validate_owner(connection, session_id, &context)?;
    let table = if matches!(context, ChatTarget::Finding { .. }) {
        "findings"
    } else {
        "drafts"
    };
    let snapshot = match &mut context {
        ChatTarget::Session => return Ok(context),
        ChatTarget::Finding { snapshot } | ChatTarget::TestCasesDraft { snapshot } => snapshot,
    };
    if json_bytes(snapshot)?.len() > MAX_CHAT_RECORD_CONTEXT_BYTES {
        return Err(validation(
            "Record context exceeds 32 KiB. Shorten the record or detach context; your input is retained.",
        ));
    }
    super::chat_rows::text("Record context title", &snapshot.title, false)?;
    let document: serde_json::Value = serde_json::from_str(&snapshot.document_json)
        .map_err(|_| validation("Record context rich document is invalid"))?;
    if document["schemaVersion"] != 1
        || document["doc"]["type"] != "doc"
        || !document["doc"]["content"].is_array()
    {
        return Err(validation(
            "Record context requires a version 1 rich document",
        ));
    }
    if let Some(metadata) = &snapshot.metadata_json {
        let value: serde_json::Value = serde_json::from_str(metadata)
            .map_err(|_| validation("Record context metadata is invalid"))?;
        if !value.is_object() {
            return Err(validation("Record context metadata must be an object"));
        }
    }
    if table == "findings" {
        FindingKind::from_stored(&snapshot.record_kind)?;
    } else if snapshot.record_kind != DraftKind::Testware.as_str() {
        return Err(validation("Record context must have Test cases kind"));
    }
    snapshot.local_fingerprint = digest(&json_bytes(&(
        &snapshot.title,
        &document,
        &snapshot.record_kind,
        &snapshot.metadata_json,
    ))?);
    snapshot.stored_base_token =
        super::record_bases::stored(connection, table, session_id, &snapshot.record_id)?;
    encoded(&context)?;
    Ok(context)
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn encoded(context: &ChatTarget) -> Result<String> {
    let json = serde_json::to_string(context).map_err(|error| validation(error.to_string()))?;
    if json.len() > MAX_CHAT_RECORD_CONTEXT_BYTES {
        return Err(validation(
            "Record context exceeds 32 KiB. Shorten the record or detach context; your input is retained.",
        ));
    }
    Ok(json)
}

pub(super) fn capacity(messages: &[ChatMessage], context: &ChatTarget) -> Result<()> {
    let bytes = messages
        .iter()
        .filter(|m| m.role == ChatRole::User)
        .try_fold(encoded(context)?.len(), |total, message| {
            Ok::<_, crate::QaScribeError>(total.saturating_add(encoded(&message.context)?.len()))
        })?;
    if bytes > MAX_CHAT_RECORD_REPLAY_BYTES {
        return Err(validation(
            "Record context history exceeds 128 KiB. Start a new conversation; your input is retained.",
        ));
    }
    Ok(())
}

pub(super) fn store(
    connection: &Connection,
    draft_id: &str,
    turn_id: &str,
    context: &ChatTarget,
) -> Result<()> {
    connection.execute(
        "INSERT INTO chat_message_contexts (message_id, version, context_json)
        SELECT id, 1, ?1 FROM chat_messages WHERE draft_id = ?2 AND turn_id = ?3 AND role = 'user'",
        params![encoded(context)?, draft_id, turn_id],
    )?;
    Ok(())
}

pub(super) fn read(connection: &Connection, message_id: &str) -> Result<ChatTarget> {
    let raw: Option<String> = connection
        .query_row(
            "SELECT context_json FROM chat_message_contexts WHERE message_id = ?1 AND version = 1",
            [message_id],
            |r| r.get(0),
        )
        .optional()?;
    raw.map(|json| serde_json::from_str(&json).map_err(|error| validation(error.to_string())))
        .unwrap_or(Ok(ChatTarget::Session))
}

fn json_bytes(value: &impl serde::Serialize) -> Result<Vec<u8>> {
    serde_json::to_vec(value).map_err(|error| validation(error.to_string()))
}

pub(super) fn validate_anchor(chat: &ChatState, context: &ChatTarget) -> Result<()> {
    if let ConversationOwner::Record { session_id, record } = &chat.owner {
        let matches = match (record, context) {
            (ConversationRecord::Finding { record_id }, ChatTarget::Finding { snapshot })
            | (
                ConversationRecord::TestCasesDraft { record_id },
                ChatTarget::TestCasesDraft { snapshot },
            ) => snapshot.session_id == *session_id && snapshot.record_id == *record_id,
            _ => false,
        };
        if !matches {
            return Err(validation(
                "Record context must match the conversation owner",
            ));
        }
    }
    Ok(())
}
