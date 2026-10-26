use qa_scribe_core::domain::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, ipc::Channel};

use crate::{
    commands::CommandError,
    jobs::{
        ChatPermissionDecisionRequest, GenerationJobState, GenerationJobStatus, JobControl,
        JobStore,
    },
    settings::AppState,
};

#[cfg(test)]
mod composer_tests;
#[cfg(test)]
mod context_tests;
#[cfg(test)]
mod conversation_ownership_tests;
#[cfg(test)]
mod conversation_question_tests;
mod image_import;
#[cfg(test)]
mod image_preflight_tests;
mod lifecycle;
#[cfg(test)]
mod ownership_tests;
#[cfg(test)]
mod permission_tests;
mod preparation;
#[cfg(test)]
mod preparation_tests;
#[cfg(test)]
mod question_tests;
mod runner;
mod transport;

fn apply_chat_permission_decision(
    jobs: &JobStore,
    request: ChatPermissionDecisionRequest,
) -> Result<GenerationJobStatus, CommandError> {
    jobs.decide_chat_permission(request)
        .map_err(CommandError::from)
}

#[tauri::command]
#[specta::specta]
pub fn decide_chat_permission(
    jobs: State<'_, JobStore>,
    request: ChatPermissionDecisionRequest,
) -> Result<GenerationJobStatus, CommandError> {
    apply_chat_permission_decision(&jobs, request)
}

fn prepare_chat_job(
    state: &AppState,
    jobs: &JobStore,
    request: &StartChatJobRequest,
    job_id: &str,
) -> Result<(lifecycle::PreparedChat, GenerationJobStatus, JobControl), CommandError> {
    prepare_chat_job_with(state, jobs, request, job_id, |snapshot, control| {
        if snapshot.has_images() {
            transport::validate_image_provider(request.provider)
                .map_err(CommandError::validation)?;
            let readiness =
                crate::commands::providers::provider_readiness_for_job(request.provider, control);
            if !readiness.descriptor.status.is_ready() {
                return Err(CommandError::validation(readiness.descriptor.reason));
            }
            transport::validate_image_model(&readiness.descriptor, &request.model)
                .map_err(CommandError::validation)?;
        }
        snapshot
            .verify(state.app_data_dir(), request.provider, || {
                control.is_cancelled()
            })
            .map_err(CommandError::from)
    })
}

fn prepare_chat_job_with(
    state: &AppState,
    jobs: &JobStore,
    request: &StartChatJobRequest,
    job_id: &str,
    verify: impl FnOnce(
        preparation::ChatPreparationSnapshot,
        &JobControl,
    ) -> Result<preparation::VerifiedChatPreparation, CommandError>,
) -> Result<(lifecycle::PreparedChat, GenerationJobStatus, JobControl), CommandError> {
    let (status, control) = jobs.insert_chat_job(
        job_id.to_string(),
        ChatRef {
            session_id: request.scope.session_id.clone(),
            draft_id: request.scope.draft_id.clone(),
        },
    )?;
    let verified = state
        .with_service(|service| preparation::ChatPreparationSnapshot::capture(service, request))
        .and_then(|snapshot| verify(snapshot, &control));
    let preparation = match verified {
        Ok(verified) => control.run_if_not_cancelled(|| {
            state.with_service(|service| lifecycle::commit(service, request, verified))
        }),
        Err(error) => Ok(Some(Err(error))),
    };
    let error = match preparation {
        Ok(Some(Ok(prepared))) => return Ok((prepared, status, control)),
        Ok(Some(Err(error))) => error,
        Ok(None) => CommandError::validation("Generation cancelled."),
        Err(error) => CommandError::internal(error),
    };
    reconcile_chat_failure(state, jobs, job_id, &control, None, &error.message)?;
    Err(error)
}

fn reconcile_chat_failure(
    state: &AppState,
    jobs: &JobStore,
    job_id: &str,
    control: &JobControl,
    prepared: Option<&lifecycle::PreparedChat>,
    message: &str,
) -> Result<GenerationJobStatus, CommandError> {
    let persist_failure = |kind, message: &str| {
        prepared
            .map(|prepared| {
                state.with_service(|service| lifecycle::fail(service, prepared, kind, message))
            })
            .transpose()
    };
    match control.run_if_not_cancelled(|| {
        let persistence = persist_failure(ChatFailureKind::Failed, message);
        let message = persistence
            .err()
            .map(|error| format!("{message} (Chat reconciliation failed: {})", error.message))
            .unwrap_or_else(|| message.to_string());
        jobs.fail(job_id, &message)
    }) {
        Ok(Some(result)) => result.map_err(CommandError::from),
        Ok(None) => {
            // Shutdown can signal the control before updating JobStore. Reconcile
            // that transition before taking the service mutex, not inside it.
            let status = jobs.cancel(job_id)?;
            if status.state != GenerationJobState::Cancelling {
                return Ok(status);
            }
            if let Err(error) = persist_failure(ChatFailureKind::Cancelled, "Generation cancelled.")
            {
                // Deletion can already have removed these rows. Cancellation
                // still won and the stopped worker must retire from JobStore.
                eprintln!(
                    "qa-scribe Chat cancellation reconciliation failed: {}",
                    error.message
                );
            }
            jobs.mark_cancelled(job_id).map_err(CommandError::from)
        }
        Err(error) => {
            // A poisoned gate cannot admit a successful finalizer. Retire the
            // stopped worker without trying to reacquire that same gate.
            let cancelling = jobs.status(job_id)?.state == GenerationJobState::Cancelling;
            let kind = if cancelling {
                ChatFailureKind::Cancelled
            } else {
                ChatFailureKind::Failed
            };
            let _ = persist_failure(kind, &error);
            if cancelling {
                jobs.mark_cancelled(job_id).map_err(CommandError::from)
            } else {
                jobs.fail(job_id, &error).map_err(CommandError::from)
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ChatSendIntent {
    Composer,
    QuestionReply {
        assistant_message_id: String,
        text: String,
    },
    Retry,
}

impl ChatSendIntent {
    fn resolve(&self, saved: ChatComposerIntent) -> ChatRequestIntent {
        match self {
            Self::Composer => match saved {
                ChatComposerIntent::Message => ChatRequestIntent::Message,
                ChatComposerIntent::RefineRecord => ChatRequestIntent::RefineRecord,
                ChatComposerIntent::DraftJira => ChatRequestIntent::DraftJira,
            },
            Self::QuestionReply {
                assistant_message_id,
                text,
            } => ChatRequestIntent::QuestionReply {
                assistant_message_id: assistant_message_id.clone(),
                text: text.clone(),
            },
            Self::Retry => ChatRequestIntent::Retry,
        }
    }
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartChatJobRequest {
    pub intent: ChatSendIntent,
    #[serde(default)]
    #[specta(optional)]
    pub context: ChatTarget,
    pub scope: ChatRevision,
    pub provider: AiProvider,
    pub model: String,
    pub reasoning_effort: Option<String>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StartChatJobResult {
    pub job_id: String,
    pub turn_id: String,
    pub chat: ChatState,
    pub status: GenerationJobStatus,
}

#[tauri::command]
#[specta::specta]
pub fn get_chat(state: State<'_, AppState>, session_id: String) -> Result<ChatState, CommandError> {
    state.with_service(|service| service.load_chat(&session_id))
}

#[tauri::command]
#[specta::specta]
pub fn begin_record_chat(
    state: State<'_, AppState>,
    request: BeginRecordChatRequest,
) -> Result<ChatState, CommandError> {
    state.with_service(|service| service.begin_record_chat(request))
}

#[tauri::command]
#[specta::specta]
pub fn get_conversation(
    state: State<'_, AppState>,
    reference: ChatRef,
) -> Result<ChatState, CommandError> {
    state.with_service(|service| service.read_chat(&reference))
}

#[tauri::command]
#[specta::specta]
pub fn activate_conversation(
    state: State<'_, AppState>,
    reference: ChatRef,
) -> Result<ChatState, CommandError> {
    state.with_service(|service| service.activate_chat(&reference))
}

#[tauri::command]
#[specta::specta]
pub fn list_chat_history(
    state: State<'_, AppState>,
    scope: ChatHistoryScope,
) -> Result<Vec<ChatHistoryEntry>, CommandError> {
    state.with_service(|service| service.list_chat_history(scope))
}

#[tauri::command]
#[specta::specta]
pub async fn save_chat_composer<R: tauri::Runtime>(
    app: AppHandle<R>,
    request: ChatComposerRequest,
) -> Result<ChatState, CommandError> {
    super::files::attachment_task("Chat composer save", move || {
        use tauri::Manager;
        let state = app.state::<AppState>();
        state.with_service(|service| {
            qa_scribe_core::attachments::chat_cleanup::save_chat_composer_with_cleanup(
                service,
                state.app_data_dir(),
                request,
            )
        })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn import_chat_image(
    app: AppHandle,
    scope: ChatRevision,
    filename: String,
    data_url: String,
) -> Result<ChatState, CommandError> {
    super::files::attachment_task("Chat image import", move || {
        use tauri::Manager;
        let state = app.state::<AppState>();
        image_import::import(&state, scope, filename, &data_url)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub fn restart_chat(
    state: State<'_, AppState>,
    request: ChatRestartRequest,
) -> Result<ChatState, CommandError> {
    state.with_service(|service| service.restart_chat(request))
}

#[tauri::command]
#[specta::specta]
pub fn submit_chat(
    state: State<'_, AppState>,
    request: ChatSubmitRequest,
) -> Result<ChatSubmissionReceipt, CommandError> {
    state.with_service(|service| service.submit_chat(request))
}

/// The status channel deliberately shares polling/cancellation with AI actions.
/// Reload the canonical ChatState when the job reaches a terminal status.
#[tauri::command]
#[specta::specta]
pub async fn start_chat_job(
    app: AppHandle,
    request: StartChatJobRequest,
    events: Channel<GenerationJobStatus>,
) -> Result<StartChatJobResult, CommandError> {
    super::files::attachment_task("Chat preparation", move || {
        start_chat_job_blocking(app, request, events)
    })
    .await
}

fn start_chat_job_blocking(
    app: AppHandle,
    request: StartChatJobRequest,
    events: Channel<GenerationJobStatus>,
) -> Result<StartChatJobResult, CommandError> {
    use tauri::Manager;
    let state = app.state::<AppState>();
    let jobs = app.state::<JobStore>();
    let job_id = uuid::Uuid::new_v4().to_string();
    let (prepared, status, control) = prepare_chat_job(&state, &jobs, &request, &job_id)?;
    let result = StartChatJobResult {
        job_id: job_id.clone(),
        turn_id: prepared.started.turn_id.clone(),
        chat: prepared.started.chat.clone(),
        status,
    };
    // Thread creation is fallible, unlike spawn_blocking's detached API. No
    // runtime join failure can silently strand a persisted user turn.
    let worker_app = app.clone();
    let worker_id = job_id.clone();
    let worker_prepared = prepared.clone();
    let worker_control = control.clone();
    let spawn = std::thread::Builder::new()
        .name("qa-scribe-chat".into())
        .spawn(move || {
            runner::run(
                worker_app,
                worker_id,
                request,
                worker_prepared,
                events,
                worker_control,
            );
        });
    if let Err(error) = spawn {
        let message = format!("Could not start Chat worker: {error}");
        reconcile_chat_failure(&state, &jobs, &job_id, &control, Some(&prepared), &message)?;
        return Err(CommandError::internal(message));
    }
    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub fn resolve_refinement(
    state: State<'_, AppState>,
    request: RefinementRequest,
) -> Result<ChatState, CommandError> {
    state.with_service(|service| service.resolve_refinement(request))
}

#[cfg(test)]
mod record_assistance_tests;
