use qa_scribe_core::{
    QaScribeError, Result,
    ai::ProviderGenerationOutput,
    chat::{CHAT_PROMPT_VERSION, ChatInput},
    domain::*,
    services::SessionService,
};

#[cfg(test)]
use super::preparation::ChatPreparationSnapshot;
use super::{StartChatJobRequest, preparation::VerifiedChatPreparation};

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

#[cfg(test)]
pub(super) fn prepare_with_images(
    service: &SessionService,
    request: &StartChatJobRequest,
    app_data_dir: &std::path::Path,
) -> Result<PreparedChat> {
    let verified = ChatPreparationSnapshot::capture(service, request)?.verify(
        app_data_dir,
        request.provider,
        || false,
    )?;
    commit(service, request, verified)
}

pub(super) fn commit(
    service: &SessionService,
    request: &StartChatJobRequest,
    verified: VerifiedChatPreparation,
) -> Result<PreparedChat> {
    verified.recheck(service, request)?;
    let start = ChatStartRequest {
        scope: request.scope.clone(),
    };
    let mut started = if matches!(request.intent, ChatRequestIntent::Retry) {
        service.retry_chat_turn(start)?
    } else {
        service.start_chat_turn_with_response(
            start,
            request.context.clone(),
            request.intent.clone(),
        )?
    };
    let mut created_run: Option<AiRun> = None;
    let preparation: Result<PreparedChat> = (|| {
        let user_id = started
            .chat
            .messages
            .last()
            .expect("started user message")
            .id
            .clone();
        let mut input = verified.input(user_id.clone())?;
        if let Some(contract) = service.response_contract(&user_id)? {
            input = input.with_response_contract(&contract);
        }
        input
            .preflight_wire(request.provider)
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
