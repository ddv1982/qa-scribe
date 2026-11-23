use super::{SessionService, new_id};
use crate::{Result, domain::*, error::validation};
use rusqlite::{Connection, OptionalExtension, params};

impl SessionService {
    pub fn response_contract(&self, message_id: &str) -> Result<Option<ChatResponseContract>> {
        contract(self.database.connection(), message_id)
    }
}
/// Fingerprint of the stored Session Note body, used to reject stale whole-note suggestions.
pub(super) fn note_fingerprint(connection: &Connection, session_id: &str) -> Result<String> {
    use sha2::{Digest, Sha256};
    let note = super::entries::note_entry(connection, session_id)?;
    Ok(format!(
        "{:x}",
        Sha256::digest(note.map(|entry| entry.body).unwrap_or_default().as_bytes())
    ))
}
pub(super) fn contract(connection: &Connection, id: &str) -> Result<Option<ChatResponseContract>> {
    let raw: Option<String> = connection
        .query_row(
            "SELECT contract_json FROM chat_response_contracts WHERE message_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    raw.map(|s| serde_json::from_str(&s).map_err(|e| validation(e.to_string())))
        .transpose()
}
pub(super) fn capture_note_retry(
    connection: &Connection,
    session_id: &str,
    message_id: &str,
    turn_id: &str,
) -> Result<()> {
    if contract(connection, message_id)?.is_some_and(|contract| {
        contract.purpose()
            == ChatResponsePurpose::Refinement {
                record_kind: RefinementRecordKind::Note,
            }
    }) {
        if !super::chat_questions::note_fits_context(connection, session_id)? {
            return Err(validation(
                "The Note is too long to rewrite in one response.",
            ));
        }
        let note = super::entries::note_entry(connection, session_id)?;
        connection.execute(
            "INSERT INTO chat_note_retry_sources (message_id,turn_id,fingerprint) VALUES (?1,?2,?3)
             ON CONFLICT(message_id) DO UPDATE SET turn_id=excluded.turn_id,fingerprint=excluded.fingerprint",
            params![message_id, turn_id, super::chat_note_updates::content_fingerprint(note.as_ref())],
        )?;
    }
    Ok(())
}

pub(super) fn note_source(
    connection: &Connection,
    proposal: &RefinementProposal,
) -> Result<Option<String>> {
    let retry: Option<String> = connection
        .query_row(
            "SELECT s.fingerprint FROM chat_note_retry_sources s
         JOIN chat_messages a ON a.id=?2 AND a.turn_id=s.turn_id WHERE s.message_id=?1",
            params![proposal.user_message_id, proposal.assistant_message_id],
            |row| row.get(0),
        )
        .optional()?;
    if retry.is_some() {
        return Ok(retry);
    }
    Ok(contract(connection, &proposal.user_message_id)?
        .and_then(|ChatResponseContract::Current(contract)| contract.note_source))
}

pub(super) fn start(
    connection: &Connection,
    session_id: &str,
    draft: &str,
    turn: &str,
    purpose: ChatResponsePurpose,
    record_owned: bool,
    local_edit: bool,
) -> Result<()> {
    let id: String = connection.query_row(
        "SELECT id FROM chat_messages WHERE draft_id=?1 AND turn_id=?2 AND role='user'",
        params![draft, turn],
        |r| r.get(0),
    )?;
    let note_edit = purpose
        == (ChatResponsePurpose::Refinement {
            record_kind: RefinementRecordKind::Note,
        });
    let note_source = if note_edit {
        let note = super::entries::note_entry(connection, session_id)?;
        Some(super::chat_note_updates::content_fingerprint(note.as_ref()))
    } else {
        None
    };
    let contract = ChatResponseContract::Current(ChatResponseContractV2 {
        note_source,
        local_edit,
        version: if local_edit
            || note_edit
            || record_owned && matches!(purpose, ChatResponsePurpose::Refinement { .. })
        {
            3
        } else {
            2
        },
        request_id: id.clone(),
        purpose,
    });
    connection.execute(
        "INSERT INTO chat_response_contracts(message_id,contract_json) VALUES (?1,?2)",
        params![
            id,
            serde_json::to_string(&contract).map_err(|e| validation(e.to_string()))?
        ],
    )?;
    Ok(())
}
pub(super) struct Completion {
    pub markdown: String,
    pub proposal: Option<RefinementProposal>,
    pub response: Option<ChatResponseInfo>,
}
pub(super) fn completed(
    connection: &Connection,
    user: &ChatMessage,
    raw: &str,
) -> Result<Completion> {
    let mut result = Completion {
        markdown: raw.into(),
        proposal: None,
        response: None,
    };
    let Some(contract) = contract(connection, &user.id)? else {
        return Ok(result);
    };
    let purpose = contract.purpose();
    let parsed = match crate::chat::response::interpret(raw, &contract, &user.context) {
        Ok(response) => response,
        Err(_) => {
            result.markdown = serde_json::from_str::<serde_json::Value>(raw)
                .ok()
                .and_then(|value| {
                    value
                        .get("markdown")
                        .and_then(|m| m.as_str())
                        .filter(|m| !m.trim().is_empty())
                        .map(str::to_owned)
                })
                .unwrap_or_else(|| raw.to_owned());
            let warning = if contract.version() == 3 {
                "No edit was created. The reply did not contain a usable suggestion."
            } else if matches!(purpose, ChatResponsePurpose::Refinement { .. }) {
                "No editable proposal was created. The response is retained as text without interactive controls."
            } else {
                "This response is retained as text without interactive choices."
            };
            result.response = Some(ChatResponseInfo {
                source_user_message_id: user.id.clone(),
                purpose,
                question: None,
                local_edit: contract.local_edit(),
                warning: Some(warning.into()),
            });
            return Ok(result);
        }
    };
    result.markdown = parsed.markdown;
    result.response = Some(ChatResponseInfo {
        source_user_message_id: user.id.clone(),
        purpose,
        question: parsed.question,
        local_edit: contract.local_edit(),
        warning: None,
    });
    if let Some((before, after)) = parsed.values {
        result.proposal = Some(RefinementProposal {
            version: 1,
            id: new_id(),
            user_message_id: user.id.clone(),
            assistant_message_id: String::new(),
            target: user.context.clone(),
            patch: parsed.patch.expect("validated patch"),
            before,
            after,
            state: RefinementState::Offered,
        });
    }
    Ok(result)
}
pub(super) fn insert(
    connection: &Connection,
    draft: &str,
    turn: &str,
    response: ChatResponseInfo,
) -> Result<()> {
    let id: String = connection.query_row(
        "SELECT id FROM chat_messages WHERE draft_id=?1 AND turn_id=?2 AND role='assistant'",
        params![draft, turn],
        |r| r.get(0),
    )?;
    let question = response
        .question
        .map(|q| serde_json::to_string(&q))
        .transpose()
        .map_err(|e| validation(e.to_string()))?;
    connection.execute("INSERT INTO chat_response_messages(assistant_message_id,source_user_message_id,question_json,warning_text) VALUES (?1,?2,?3,?4)", params![id,response.source_user_message_id,question,response.warning])?;
    Ok(())
}
pub(super) fn read(connection: &Connection, id: &str) -> Result<Option<ChatResponseInfo>> {
    let row: Option<(String,Option<String>,Option<String>)> = connection.query_row("SELECT source_user_message_id,question_json,warning_text FROM chat_response_messages WHERE assistant_message_id=?1", [id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    row.map(|(source, question, warning)| {
        let contract = contract(connection, &source)?
            .ok_or_else(|| validation("Response contract is missing"))?;
        let purpose = contract.purpose();
        let question = question
            .map(|s| serde_json::from_str(&s).map_err(|e| validation(e.to_string())))
            .transpose()?;
        Ok(ChatResponseInfo {
            source_user_message_id: source,
            purpose,
            question,
            local_edit: contract.local_edit(),
            warning,
        })
    })
    .transpose()
}
pub(super) fn answer(connection: &Connection, id: &str) -> Result<Option<ChatAnswer>> {
    Ok(connection
        .query_row(
            "SELECT assistant_message_id FROM chat_answers WHERE user_message_id=?1",
            [id],
            |r| {
                Ok(ChatAnswer {
                    assistant_message_id: r.get(0)?,
                })
            },
        )
        .optional()?)
}
