use std::time::Instant;

use tauri::{AppHandle, Manager, State, ipc::Channel};
use uuid::Uuid;

use super::{
    action::{finish_ai_action_generation, prepare_ai_action_generation},
    job_events::{
        GenerationJobEvent, fallback_status, finish_cancelled_job, send_event, send_progress,
    },
    provider_execution::execute_provider_generation_streaming,
    types::{GenerateAiActionRequest, StartAiActionJobResult},
};
use crate::{
    jobs::{GenerationJobState, GenerationJobStatus, JobControl, JobStore},
    settings::AppState,
};

#[tauri::command]
pub fn start_ai_action_job(
    app: AppHandle,
    jobs: State<'_, JobStore>,
    request: GenerateAiActionRequest,
    events: Channel<GenerationJobEvent>,
) -> Result<StartAiActionJobResult, String> {
    let job_id = Uuid::new_v4().to_string();
    let (status, control) = jobs.insert_generation_job(
        job_id.clone(),
        request.session_id.clone(),
        request.action.as_str().to_string(),
    )?;
    let app_handle = app.clone();
    let worker_job_id = job_id.clone();

    tauri::async_runtime::spawn_blocking(move || {
        run_ai_action_job(app_handle, worker_job_id, request, events, control);
    });

    Ok(StartAiActionJobResult { job_id, status })
}

#[tauri::command]
pub fn get_ai_action_job_status(
    jobs: State<'_, JobStore>,
    job_id: String,
) -> Result<GenerationJobStatus, String> {
    jobs.status(&job_id)
}

#[tauri::command]
pub fn cancel_ai_action_job(
    jobs: State<'_, JobStore>,
    job_id: String,
) -> Result<GenerationJobStatus, String> {
    jobs.cancel(&job_id)
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

    let prepare_started = Instant::now();
    let prepared =
        match state.with_service(|service| prepare_ai_action_generation(service, &request)) {
            Ok(prepared) => prepared,
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
    eprintln!(
        "qa-scribe AI action job prompt prepared: action={}, provider={}, model={}, prompt_bytes={}, prompt_chars={}, elapsed_ms={}",
        request.action.label(),
        request.provider.as_str(),
        request.model,
        prepared.prompt.len(),
        prepared.prompt.chars().count(),
        prepare_started.elapsed().as_millis()
    );

    let running_status = match jobs.mark_running(
        &job_id,
        prepared.ai_run.id.clone(),
        "Provider process starting",
    ) {
        Ok(status) => status,
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
            &prepared.ai_run.id,
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
    {
        finish_cancelled_job(
            &events,
            &jobs,
            &state,
            &job_id,
            &request,
            &prepared.ai_run.id,
        );
        return;
    }

    let result = state
        .with_service(|service| finish_ai_action_generation(service, &request, prepared, output));
    match result {
        Ok(result) if result.ai_run.error_message.is_none() => {
            let status = jobs.complete(&job_id).unwrap_or_else(|_| {
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
            let status = jobs.fail(&job_id, &error_message).unwrap_or_else(|_| {
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
        }
    }
}
