use qa_scribe_core::{
    QaScribeError, Result,
    ai::ProviderGenerationOutput,
    chat::{CHAT_PROMPT_VERSION, ChatInput, ChatInputMessage, ChatPromptRole, build_chat_input},
    domain::*,
    services::SessionService,
};

use super::StartChatJobRequest;

#[derive(Clone)]
pub(super) struct PreparedChat {
    pub started: ChatTurnStarted,
    pub input: ChatInput,
    pub ai_run: AiRun,
}

pub(super) fn scope(chat: &ChatState) -> ChatRevision {
    ChatRevision {
        session_id: chat.session_id.clone(),
        draft_id: chat.draft_id.clone(),
        expected_revision: chat.revision,
    }
}

pub(super) fn prepare_with_images(
    service: &SessionService,
    request: &StartChatJobRequest,
    app_data_dir: &std::path::Path,
) -> Result<PreparedChat> {
    let mut preview = service.load_chat(&request.scope.session_id)?;
    let preview_turn = if request.retry {
        preview
            .messages
            .last()
            .map(|message| message.turn_id.clone())
            .unwrap_or_default()
    } else {
        preview.messages.push(ChatMessage {
            id: "pending".into(),
            turn_id: "pending".into(),
            role: ChatRole::User,
            text: preview.composer.clone(),
            images: preview.composer_images.clone(),
            status: ChatTurnStatus::Running,
            error_message: None,
            ai_run_id: None,
            created_at: String::new(),
        });
        "pending".into()
    };
    prepare_input(service, &preview, &preview_turn, app_data_dir)?
        .preflight_wire(request.provider)
        .map_err(QaScribeError::Validation)?;
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
        let input = prepare_input(service, &started.chat, &started.turn_id, app_data_dir)?;
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
            input,
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

fn prepare_input(
    service: &SessionService,
    chat: &ChatState,
    turn_id: &str,
    app_data_dir: &std::path::Path,
) -> Result<ChatInput> {
    let session = service
        .get_session(&chat.session_id)?
        .ok_or_else(|| QaScribeError::NotFound(chat.session_id.clone()))?;
    let messages = chat
        .messages
        .iter()
        .filter(|message| {
            message.status == ChatTurnStatus::Completed
                || (message.turn_id == turn_id && message.role == ChatRole::User)
        })
        .map(|message| {
            Ok(ChatInputMessage {
                id: message.id.clone(),
                role: match message.role {
                    ChatRole::User => ChatPromptRole::User,
                    ChatRole::Assistant => ChatPromptRole::Assistant,
                },
                text: message.text.clone(),
                images: message
                    .images
                    .iter()
                    .map(|image| {
                        qa_scribe_core::attachments::chat::resolve_chat_image(
                            service,
                            app_data_dir,
                            &chat.session_id,
                            &image.attachment_id,
                        )
                    })
                    .collect::<Result<Vec<_>>>()?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    build_chat_input(session.session_context.as_deref().unwrap_or(""), messages)
        .map_err(QaScribeError::Validation)
}

#[cfg(test)]
fn prepare(service: &SessionService, request: &StartChatJobRequest) -> Result<PreparedChat> {
    prepare_with_images(service, request, &std::env::temp_dir())
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
    service.finish_chat_turn_with_ai_run(
        ChatFinishRequest {
            scope: current_scope(service, prepared)?,
            turn_id: prepared.started.turn_id.clone(),
            assistant_text: text,
        },
        &prepared.ai_run.id,
    )
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod boundaries;

#[cfg(test)]
mod images;
