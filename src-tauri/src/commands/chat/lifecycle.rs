use qa_scribe_core::{
    QaScribeError, Result,
    ai::ProviderGenerationOutput,
    chat::{CHAT_PROMPT_VERSION, ChatPromptMessage, ChatPromptRole, build_chat_prompt},
    domain::*,
    services::SessionService,
};

use super::StartChatJobRequest;

#[derive(Clone)]
pub(super) struct PreparedChat {
    pub started: ChatTurnStarted,
    pub prompt: String,
    pub ai_run: AiRun,
}

pub(super) fn scope(chat: &ChatState) -> ChatRevision {
    ChatRevision {
        session_id: chat.session_id.clone(),
        draft_id: chat.draft_id.clone(),
        expected_revision: chat.revision,
    }
}

pub(super) fn prepare(
    service: &SessionService,
    request: &StartChatJobRequest,
) -> Result<PreparedChat> {
    let start = ChatStartRequest {
        scope: request.scope.clone(),
    };
    let mut started = if request.retry {
        service.retry_chat_turn(start)?
    } else {
        service.start_chat_turn(start)?
    };
    let mut created_run: Option<AiRun> = None;
    let preparation: Result<PreparedChat> = (|| {
        let session = service
            .get_session(&request.scope.session_id)?
            .ok_or_else(|| QaScribeError::NotFound(request.scope.session_id.clone()))?;
        let messages = replay(&started.chat, &started.turn_id);
        let prompt = build_chat_prompt(session.session_context.as_deref().unwrap_or(""), &messages)
            .map_err(QaScribeError::Validation)?;
        let ai_run = service.create_ai_run(AiRunCreate {
            session_id: request.scope.session_id.clone(),
            generation_context_id: None,
            provider: request.provider,
            model: if request.model.trim().is_empty() {
                "default".into()
            } else {
                request.model.clone()
            },
            reasoning_effort: request.reasoning_effort.clone(),
            prompt_version: CHAT_PROMPT_VERSION.into(),
        })?;
        created_run = Some(ai_run.clone());
        started.chat = service.associate_chat_turn_ai_run(ChatAssociateRunRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id.clone(),
            ai_run_id: ai_run.id.clone(),
        })?;
        Ok(PreparedChat {
            started: started.clone(),
            prompt,
            ai_run,
        })
    })();
    if let Err(error) = &preparation {
        // No fallible preparation remains after association. Reconcile both
        // records independently here so an association error never orphans the
        // newly created run, even if the unassociated turn cleanup also fails.
        let chat = service.fail_chat_turn(ChatFailRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            kind: ChatFailureKind::Failed,
            error_message: error.to_string(),
        });
        let run = created_run
            .as_ref()
            .map(|run| service.fail_ai_run(&run.id, &error.to_string()))
            .transpose();
        chat?;
        run?;
    }
    preparation
}

fn replay(chat: &ChatState, turn_id: &str) -> Vec<ChatPromptMessage> {
    chat.messages
        .iter()
        .filter(|message| {
            message.status == ChatTurnStatus::Completed
                || (message.turn_id == turn_id && message.role == ChatRole::User)
        })
        .map(|message| ChatPromptMessage {
            role: match message.role {
                ChatRole::User => ChatPromptRole::User,
                ChatRole::Assistant => ChatPromptRole::Assistant,
            },
            text: message.text.clone(),
        })
        .collect()
}

fn current_scope(service: &SessionService, prepared: &PreparedChat) -> Result<ChatRevision> {
    let chat = service.load_chat(&prepared.started.chat.session_id)?;
    if chat.draft_id != prepared.started.chat.draft_id {
        return Err(QaScribeError::Validation(
            "Chat conversation changed during generation".into(),
        ));
    }
    Ok(scope(&chat))
}

pub(super) fn fail(
    service: &SessionService,
    prepared: &PreparedChat,
    kind: ChatFailureKind,
    message: &str,
) -> Result<ChatState> {
    // Both reads/mutations happen under AppState's existing service mutex.
    service.fail_chat_turn_with_ai_run(
        ChatFailRequest {
            scope: current_scope(service, prepared)?,
            turn_id: prepared.started.turn_id.clone(),
            kind,
            error_message: message.into(),
        },
        &prepared.ai_run.id,
    )
}

pub(super) fn finish(
    service: &SessionService,
    prepared: &PreparedChat,
    output: ProviderGenerationOutput,
) -> Result<ChatState> {
    if !output.success() {
        return Err(QaScribeError::Validation(
            output.failure_message_for_provider(prepared.ai_run.provider),
        ));
    }
    let text = output.response_text().map_err(QaScribeError::Validation)?;
    if text.trim().is_empty() {
        return Err(QaScribeError::Validation(
            "Provider returned an empty Chat response".into(),
        ));
    }
    let reported_model = output.reported_model();
    service.finish_chat_turn_with_ai_run(
        ChatFinishRequest {
            scope: current_scope(service, prepared)?,
            turn_id: prepared.started.turn_id.clone(),
            assistant_text: text,
        },
        &prepared.ai_run.id,
        reported_model.as_deref(),
    )
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod boundaries;
