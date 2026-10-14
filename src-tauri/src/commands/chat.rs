use qa_scribe_core::domain::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, ipc::Channel};

use crate::{
    commands::CommandError,
    jobs::{GenerationJobState, GenerationJobStatus, JobControl, JobStore},
    settings::AppState,
};

mod lifecycle;
mod runner;
mod transport;

fn prepare_chat_job(
    state: &AppState,
    jobs: &JobStore,
    request: &StartChatJobRequest,
    job_id: &str,
) -> Result<(lifecycle::PreparedChat, GenerationJobStatus, JobControl), CommandError> {
    let (status, control) = jobs.insert_generation_job(
        job_id.to_string(),
        request.scope.session_id.clone(),
        "chat".into(),
    )?;
    // Reserve before persisted preparation. Both preparation and finalization
    // acquire the control gate before the service mutex, never the reverse.
    let preparation = control.run_if_not_cancelled(|| {
        state.with_service(|service| lifecycle::prepare(service, request))
    });
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

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StartChatJobRequest {
    pub scope: ChatRevision,
    #[serde(default)]
    pub retry: bool,
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
pub fn save_chat_composer(
    state: State<'_, AppState>,
    request: ChatComposerRequest,
) -> Result<ChatState, CommandError> {
    state.with_service(|service| service.save_chat_composer(request))
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
pub fn start_chat_job(
    app: AppHandle,
    state: State<'_, AppState>,
    jobs: State<'_, JobStore>,
    request: StartChatJobRequest,
    events: Channel<GenerationJobStatus>,
) -> Result<StartChatJobResult, CommandError> {
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
