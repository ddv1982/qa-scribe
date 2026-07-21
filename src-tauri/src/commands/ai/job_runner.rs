use std::time::Instant;

use qa_scribe_core::generation::{
    GenerateAiActionRequest, finish_ai_action_generation, prepare_ai_action_generation,
};
use serde::Serialize;
use tauri::{AppHandle, Manager, State, ipc::Channel};
use uuid::Uuid;

use super::{
    job_events::{
        GenerationJobEvent, fallback_status, finish_cancelled_job, send_event, send_progress,
    },
    provider_execution::execute_provider_generation_streaming,
};
use crate::{
    commands::CommandError,
    jobs::{GenerationJobState, GenerationJobStatus, JobControl, JobStore},
    settings::AppState,
};

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StartAiActionJobResult {
    pub job_id: String,
    pub status: GenerationJobStatus,
}

#[tauri::command]
#[specta::specta]
pub fn start_ai_action_job(
    app: AppHandle,
    jobs: State<'_, JobStore>,
    request: GenerateAiActionRequest,
    events: Channel<GenerationJobEvent>,
) -> Result<StartAiActionJobResult, CommandError> {
    let job_id = Uuid::new_v4().to_string();
    let (status, control) = jobs
        .insert_generation_job(
            job_id.clone(),
            request.session_id.clone(),
            request.action.as_str().to_string(),
        )
        .map_err(CommandError::from)?;
    let app_handle = app.clone();
    let worker_job_id = job_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        run_ai_action_job(app_handle, worker_job_id, request, events, control);
    });

    Ok(StartAiActionJobResult { job_id, status })
}

#[tauri::command]
#[specta::specta]
pub fn get_ai_action_job_status(
    jobs: State<'_, JobStore>,
    job_id: String,
) -> Result<GenerationJobStatus, CommandError> {
    jobs.status(&job_id).map_err(CommandError::from)
}

/// Enumerate the AI-action jobs still running in the backend.
///
/// The webview can reload (or the app can be reopened onto a still-running
/// backend) without the worker threads noticing; when that happens the frontend
/// has lost its job map and the original invoke `Channel`. On boot it calls this
/// to recover the survivors and re-subscribe by polling `get_ai_action_job_status`.
#[tauri::command]
#[specta::specta]
pub fn list_active_ai_action_jobs(
    jobs: State<'_, JobStore>,
) -> Result<Vec<GenerationJobStatus>, CommandError> {
    jobs.active_jobs().map_err(CommandError::from)
}

#[tauri::command]
#[specta::specta]
pub fn cancel_ai_action_job(
    jobs: State<'_, JobStore>,
    job_id: String,
) -> Result<GenerationJobStatus, CommandError> {
    jobs.cancel(&job_id).map_err(CommandError::from)
}

fn run_ai_action_job(
    app: AppHandle,
    job_id: String,
    request: GenerateAiActionRequest,
    events: Channel<GenerationJobEvent>,
    control: JobControl,
) {
    let jobs = app.state::<JobStore>();
    let state = app.state::<AppState>();
    let _ = send_progress(&events, &jobs, &job_id, "Preparing prompt");
    if control.is_cancelled() {
        finish_cancelled_job(&events, &jobs, &state, &job_id, &request, None);
        return;
    }

    let prepare_started = Instant::now();
    let prepared =
        match state.with_service(|service| prepare_ai_action_generation(service, &request)) {
            Ok(prepared) => prepared,
            Err(error) => {
                let error = error.message;
                let failed_status = control.run_if_not_cancelled(|| jobs.fail(&job_id, &error));
                let Ok(Some(failed_status)) = failed_status else {
                    finish_cancelled_job(&events, &jobs, &state, &job_id, &request, None);
                    return;
                };
                let status = failed_status.unwrap_or_else(|_| {
                    fallback_status(&job_id, &request, GenerationJobState::Failed, &error)
                });
                send_event(
                    &events,
                    GenerationJobEvent::Failed {
                        job_id,
                        status,
                        error_message: error,
                        ai_run: None,
                    },
                );
                return;
            }
        };
    eprintln!(
        "qa-scribe AI action job prompt prepared: action={}, provider={}, prompt_bytes={}, prompt_chars={}, elapsed_ms={}",
        request.action.label(),
        request.provider.as_str(),
        prepared.prompt.len(),
        prepared.prompt.chars().count(),
        prepare_started.elapsed().as_millis()
    );

    let running_status = control.run_if_not_cancelled(|| {
        jobs.mark_running(
            &job_id,
            prepared.ai_run.id.clone(),
            "Provider process starting",
        )
    });
    let running_status = match running_status {
        Ok(Some(Ok(status))) => status,
        Ok(None) => {
            finish_cancelled_job(
                &events,
                &jobs,
                &state,
                &job_id,
                &request,
                Some(&prepared.ai_run.id),
            );
            return;
        }
        Ok(Some(Err(error))) => {
            let error = error.to_string();
            send_event(
                &events,
                GenerationJobEvent::Failed {
                    job_id: job_id.clone(),
                    status: fallback_status(&job_id, &request, GenerationJobState::Failed, &error),
                    error_message: error,
                    ai_run: Some(prepared.ai_run),
                },
            );
            return;
        }
        Err(error) => {
            send_event(
                &events,
                GenerationJobEvent::Failed {
                    job_id: job_id.clone(),
                    status: fallback_status(&job_id, &request, GenerationJobState::Failed, &error),
                    error_message: error,
                    ai_run: Some(prepared.ai_run),
                },
            );
            return;
        }
    };
    send_event(
        &events,
        GenerationJobEvent::Started {
            job_id: job_id.clone(),
            status: running_status,
            generation_context: prepared.generation_context.clone(),
            ai_run: prepared.ai_run.clone(),
        },
    );

    if control.is_cancelled() {
        finish_cancelled_job(
            &events,
            &jobs,
            &state,
            &job_id,
            &request,
            Some(&prepared.ai_run.id),
        );
        return;
    }

    let output = execute_provider_generation_streaming(
        request.provider,
        &request.model,
        request.reasoning_effort.as_deref(),
        &prepared.prompt,
        &format!("AI action action={}", request.action.label()),
        &job_id,
        &jobs,
        &events,
        &control,
    );

    if output
        .as_ref()
        .map(|output| output.cancelled)
        .unwrap_or_else(|error| error == "Generation cancelled.")
        || control.is_cancelled()
    {
        finish_cancelled_job(
            &events,
            &jobs,
            &state,
            &job_id,
            &request,
            Some(&prepared.ai_run.id),
        );
        return;
    }

    let ai_run_id = prepared.ai_run.id.clone();
    let finalization = control.run_if_not_cancelled(|| {
        let result = state.with_service(|service| {
            finish_ai_action_generation(service, &request, prepared, output)
        });
        let status = match &result {
            Ok(result) if result.ai_run.error_message.is_none() => jobs.complete(&job_id),
            Ok(result) => jobs.fail(
                &job_id,
                result
                    .ai_run
                    .error_message
                    .as_deref()
                    .unwrap_or("Generation failed"),
            ),
            Err(error) => jobs.fail(&job_id, &error.message),
        };
        (result, status)
    });
    let (result, terminal_status) = match finalization {
        Ok(Some(finalization)) => finalization,
        Ok(None) => {
            finish_cancelled_job(&events, &jobs, &state, &job_id, &request, Some(&ai_run_id));
            return;
        }
        Err(error) => {
            let status = jobs.fail(&job_id, &error).unwrap_or_else(|_| {
                fallback_status(&job_id, &request, GenerationJobState::Failed, &error)
            });
            send_event(
                &events,
                GenerationJobEvent::Failed {
                    job_id,
                    status,
                    error_message: error,
                    ai_run: None,
                },
            );
            return;
        }
    };
    match result {
        Ok(result) if result.ai_run.error_message.is_none() => {
            let status = terminal_status.unwrap_or_else(|_| {
                fallback_status(&job_id, &request, GenerationJobState::Completed, "")
            });
            send_event(
                &events,
                GenerationJobEvent::Completed {
                    job_id,
                    status,
                    result: Box::new(result),
                },
            );
        }
        Ok(result) => {
            let error_message = result
                .ai_run
                .error_message
                .clone()
                .unwrap_or_else(|| "Generation failed".to_string());
            let status = terminal_status.unwrap_or_else(|_| {
                fallback_status(
                    &job_id,
                    &request,
                    GenerationJobState::Failed,
                    &error_message,
                )
            });
            send_event(
                &events,
                GenerationJobEvent::Failed {
                    job_id,
                    status,
                    error_message,
                    ai_run: Some(result.ai_run),
                },
            );
        }
        Err(error) => {
            let error = error.message;
            let status = terminal_status.unwrap_or_else(|_| {
                fallback_status(&job_id, &request, GenerationJobState::Failed, &error)
            });
            send_event(
                &events,
                GenerationJobEvent::Failed {
                    job_id,
                    status,
                    error_message: error,
                    ai_run: None,
                },
            );
        }
    }
}
