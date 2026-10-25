use super::{SessionService, chat_context, chat_rows};
use crate::{Result, domain::*, error::validation};
use rusqlite::Connection;

pub struct ResolvedChatMessage {
    pub text: String,
    pub context: ChatTarget,
    pub purpose: ChatResponsePurpose,
    pub answer: Option<ChatAnswer>,
    pub images: Vec<ChatImage>,
}
impl SessionService {
    pub fn prepare_chat_message(
        &self,
        chat: &ChatState,
        context: ChatTarget,
        intent: &ChatRequestIntent,
    ) -> Result<ResolvedChatMessage> {
        resolve(self.database.connection(), chat, context, intent)
    }
}
fn same_target(a: &ChatTarget, b: &ChatTarget) -> bool {
    std::mem::discriminant(a) == std::mem::discriminant(b)
        && a.snapshot().map(|s| (&s.session_id, &s.record_id))
            == b.snapshot().map(|s| (&s.session_id, &s.record_id))
}
pub(super) fn resolve(
    connection: &Connection,
    chat: &ChatState,
    active: ChatTarget,
    intent: &ChatRequestIntent,
) -> Result<ResolvedChatMessage> {
    chat_context::validate_anchor(chat, &active)?;
    chat_rows::editable(chat)?;
    chat_rows::idle(chat)?;
    let eligible = chat
        .messages
        .last()
        .filter(|m| m.role == ChatRole::Assistant && m.status == ChatTurnStatus::Completed)
        .and_then(|m| {
            m.response
                .as_ref()
                .and_then(|r| r.question.as_ref().map(|q| (m, r, q)))
        })
        .and_then(|(m, r, q)| {
            chat.messages
                .iter()
                .find(|u| u.id == r.source_user_message_id)
                .map(|u| (m, r, q, u))
        });
    let mut text = chat.composer.clone();
    let mut answer = None;
    let mut purpose = match (&chat.owner, &active) {
        (ConversationOwner::Record { .. }, ChatTarget::Finding { .. }) => {
            ChatResponsePurpose::Refinement {
                record_kind: RefinementRecordKind::Finding,
            }
        }
        (ConversationOwner::Record { .. }, ChatTarget::TestCasesDraft { .. }) => {
            ChatResponsePurpose::Refinement {
                record_kind: RefinementRecordKind::TestCasesDraft,
            }
        }
        _ => ChatResponsePurpose::Conversation,
    };
    let mut pinned = None;
    match intent {
        ChatRequestIntent::Retry => return Err(validation("Retry uses the existing user message")),
        ChatRequestIntent::QuestionReply {
            assistant_message_id,
            text: selected,
        } => {
            if !chat.composer.is_empty() || !chat.composer_images.is_empty() {
                return Err(validation(
                    "Your unsent message and images are retained. Send a typed reply or clear the composer to use a choice.",
                ));
            }
            let (message, response, question, user) = eligible.ok_or_else(|| {
                validation("This question is no longer active. Your input is retained.")
            })?;
            if &message.id != assistant_message_id || !question.choices.contains(selected) {
                return Err(validation(
                    "This choice does not belong to the active question",
                ));
            }
            if !same_target(&active, &user.context) {
                return Err(validation(
                    "Select the question's original source record to use this choice. Your input is retained.",
                ));
            }
            text = selected.clone();
            purpose = response.purpose.clone();
            pinned = Some(user.context.clone());
            answer = Some(ChatAnswer {
                assistant_message_id: message.id.clone(),
            });
        }
        ChatRequestIntent::Message => {
            if let Some((message, response, question, user)) = eligible
                && same_target(&active, &user.context)
                && question.choices.iter().any(|c| c == text.trim())
            {
                purpose = response.purpose.clone();
                pinned = Some(user.context.clone());
                answer = Some(ChatAnswer {
                    assistant_message_id: message.id.clone(),
                });
            }
        }
        ChatRequestIntent::RefineRecord => {
            purpose = ChatResponsePurpose::Refinement {
                record_kind: match active {
                    ChatTarget::Finding { .. } => RefinementRecordKind::Finding,
                    ChatTarget::TestCasesDraft { .. } => RefinementRecordKind::TestCasesDraft,
                    _ => {
                        return Err(validation(
                            "Select a Finding or Test cases record to refine",
                        ));
                    }
                },
            };
        }
        ChatRequestIntent::DraftJira => {
            if active.snapshot().is_none() {
                return Err(validation(
                    "Select a Finding or Test cases record to draft for Jira",
                ));
            }
            purpose = ChatResponsePurpose::JiraDrafting;
            text = format!(
                "Draft Jira content for this record. Show the content draft first, then ask for missing details one at a time. Do not create anything yet.{}",
                if text.trim().is_empty() {
                    String::new()
                } else {
                    format!("\n\n{text}")
                }
            );
        }
    }
    let context = if let Some(context) = pinned {
        chat_context::validate_owner(connection, &chat.session_id, &context)?;
        context
    } else {
        chat_context::capture(connection, &chat.session_id, active)?
    };
    chat_context::capacity(&chat.messages, &context)?;
    chat_rows::text("Chat message", &text, !chat.composer_images.is_empty())?;
    chat_rows::append_capacity(chat, &text, 2)?;
    Ok(ResolvedChatMessage {
        text,
        context,
        purpose,
        answer,
        images: chat.composer_images.clone(),
    })
}

pub(super) fn store_answer(
    connection: &Connection,
    draft: &str,
    turn: &str,
    answer: &ChatAnswer,
) -> Result<()> {
    connection.execute("INSERT INTO chat_answers(user_message_id,assistant_message_id) SELECT id,?1 FROM chat_messages WHERE draft_id=?2 AND turn_id=?3 AND role='user'", rusqlite::params![answer.assistant_message_id,draft,turn])?;
    Ok(())
}

pub fn readable_message(message: &ChatMessage) -> String {
    let mut text = message.text.clone();
    if let Some(question) = message.response.as_ref().and_then(|r| r.question.as_ref()) {
        text.push_str("\n\n");
        text.push_str(&literal(&question.prompt));
        for choice in &question.choices {
            text.push_str("\n\n");
            text.push_str(&literal(choice));
        }
    }
    text
}
fn literal(value: &str) -> String {
    value
        .chars()
        .flat_map(|c| {
            if "\\`*_{}[]<>()#+-.!|".contains(c) {
                vec!['\\', c]
            } else {
                vec![c]
            }
        })
        .collect()
}
