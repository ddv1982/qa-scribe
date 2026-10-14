use qa_scribe_core::domain::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, ipc::Channel};

use crate::{
    commands::CommandError,
    jobs::{GenerationJobStatus, JobStore},
    settings::AppState,
};

mod lifecycle;
mod runner;
mod transport;

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
    let prepared = state.with_service(|service| lifecycle::prepare(service, &request))?;
    let job_id = uuid::Uuid::new_v4().to_string();
    let (status, control) = match jobs.insert_generation_job(
        job_id.clone(),
        request.scope.session_id.clone(),
        "chat".into(),
    ) {
        Ok(job) => job,
        Err(error) => {
            state.with_service(|service| {
                lifecycle::fail(
                    service,
                    &prepared,
                    ChatFailureKind::Failed,
                    &error.to_string(),
                )
            })?;
            return Err(error.into());
        }
    };
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
    let spawn = std::thread::Builder::new()
        .name("qa-scribe-chat".into())
        .spawn(move || {
            runner::run(
                worker_app,
                worker_id,
                request,
                worker_prepared,
                events,
                control,
            );
        });
    if let Err(error) = spawn {
        let message = format!("Could not start Chat worker: {error}");
        let persistence = state.with_service(|service| {
            lifecycle::fail(service, &prepared, ChatFailureKind::Failed, &message)
        });
        let terminal = jobs.fail(&job_id, &message).map_err(CommandError::from);
        persistence?;
        terminal?;
        return Err(CommandError::internal(message));
    }
    Ok(result)
}
