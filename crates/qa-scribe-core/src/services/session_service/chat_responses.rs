use super::{SessionService, new_id};
use crate::{Result, domain::*, error::validation};
use rusqlite::{Connection, OptionalExtension, params};

impl SessionService {
    pub fn response_contract(&self, message_id: &str) -> Result<Option<ChatResponseContract>> {
        contract(self.database.connection(), message_id)
    }
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
pub(super) fn start(
    connection: &Connection,
    draft: &str,
    turn: &str,
    purpose: ChatResponsePurpose,
) -> Result<()> {
    let id: String = connection.query_row(
        "SELECT id FROM chat_messages WHERE draft_id=?1 AND turn_id=?2 AND role='user'",
        params![draft, turn],
        |r| r.get(0),
    )?;
    let contract = ChatResponseContract::Current(ChatResponseContractV2 {
        version: 2,
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
            let warning = if matches!(purpose, ChatResponsePurpose::Refinement { .. }) {
                "No editable proposal was created. The response is retained as text without interactive controls."
            } else {
                "This response is retained as text without interactive choices."
            };
            result.response = Some(ChatResponseInfo {
                source_user_message_id: user.id.clone(),
                purpose,
                question: None,
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
        result.markdown.push_str(
            "\n\nSuggested local refinement. Review before applying. No record has been saved.",
        );
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
        let purpose = contract(connection, &source)?
            .ok_or_else(|| validation("Response contract is missing"))?
            .purpose();
        let question = question
            .map(|s| serde_json::from_str(&s).map_err(|e| validation(e.to_string())))
            .transpose()?;
        Ok(ChatResponseInfo {
            source_user_message_id: source,
            purpose,
            question,
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
