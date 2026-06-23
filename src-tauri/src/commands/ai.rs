use std::{
    io::{BufRead, BufReader, Read, Write},
    process::{Command, ExitStatus, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

use qa_scribe_core::{
    ai::{
        GenerationCommand, GenerationOutputFormat, generation_command, streaming_generation_command,
    },
    domain::{
        AiProvider, AiRun, AiRunCreate, Draft, DraftCreate, DraftKind, Entry, EntryPatch,
        EntryType, Finding, FindingDraft, FindingKind, GenerationContext,
    },
    generation::{
        ActionPromptKind, SESSION_REPORT_PROMPT_VERSION, parse_rich_html_fragment_response,
        parse_session_report_response, preserve_managed_attachment_images,
        project_html_to_prompt_text, render_action_prompt, render_session_report_prompt,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State, ipc::Channel};
use uuid::Uuid;

use super::providers::provider_readiness;
use crate::{
    jobs::{GenerationJobState, GenerationJobStatus, JobControl, JobStore},
    provider_command::apply_provider_path,
    settings::AppState,
};

const PARTIAL_UPDATE_MIN_BYTES: usize = 512;
const PARTIAL_UPDATE_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateSessionReportRequest {
    pub session_id: String,
    pub provider: AiProvider,
    pub model: String,
    pub reasoning_effort: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateSessionReportResult {
    pub generation_context: GenerationContext,
    pub ai_run: AiRun,
    pub draft: Option<Draft>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GenerateAiActionKind {
    Testware,
    Finding,
    Summary,
}

impl GenerateAiActionKind {
    fn as_str(self) -> &'static str {
        match self {
            GenerateAiActionKind::Testware => "testware",
            GenerateAiActionKind::Finding => "finding",
            GenerateAiActionKind::Summary => "summary",
        }
    }

    fn prompt_version(self) -> &'static str {
        match self {
            GenerateAiActionKind::Testware => "testware-v3",
            GenerateAiActionKind::Finding => "finding-v3",
            GenerateAiActionKind::Summary => "note-summary-v3",
        }
    }

    fn label(self) -> &'static str {
        match self {
            GenerateAiActionKind::Testware => "Generate test cases",
            GenerateAiActionKind::Finding => "Create finding",
            GenerateAiActionKind::Summary => "Summarize notes",
        }
    }

    fn prompt_kind(self) -> ActionPromptKind {
        match self {
            GenerateAiActionKind::Testware => ActionPromptKind::Testware,
            GenerateAiActionKind::Finding => ActionPromptKind::Finding,
            GenerateAiActionKind::Summary => ActionPromptKind::Summary,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAiActionRequest {
    pub session_id: String,
    pub provider: AiProvider,
    pub model: String,
    pub reasoning_effort: Option<String>,
    pub action: GenerateAiActionKind,
    pub note_entry_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAiActionResult {
    pub generation_context: GenerationContext,
    pub ai_run: AiRun,
    pub draft: Option<Draft>,
    pub finding: Option<Finding>,
    pub note_entry: Option<Entry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAiActionJobResult {
    pub job_id: String,
    pub status: GenerationJobStatus,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum GenerationJobEvent {
    Started {
        job_id: String,
        status: GenerationJobStatus,
        generation_context: GenerationContext,
        ai_run: AiRun,
    },
    Progress {
        job_id: String,
        status: GenerationJobStatus,
        message: String,
    },
    Partial {
        job_id: String,
        status: GenerationJobStatus,
        body: String,
    },
    Completed {
        job_id: String,
        status: GenerationJobStatus,
        result: Box<GenerateAiActionResult>,
    },
    Failed {
        job_id: String,
        status: GenerationJobStatus,
        error_message: String,
        ai_run: Option<AiRun>,
    },
    Cancelled {
        job_id: String,
        status: GenerationJobStatus,
        ai_run: Option<AiRun>,
    },
}

struct PreparedGeneration {
    session_id: String,
    session_title: String,
    generation_context: GenerationContext,
    ai_run: AiRun,
    prompt: String,
    selected_note_body: Option<String>,
    attachments: Vec<qa_scribe_core::domain::Attachment>,
}

#[tauri::command]
pub fn generate_ai_action(
    state: State<'_, AppState>,
    request: GenerateAiActionRequest,
) -> Result<GenerateAiActionResult, String> {
    let prepare_started = Instant::now();
    let prepared = state.with_service(|service| prepare_ai_action_generation(service, &request))?;
    eprintln!(
        "qa-scribe AI action prompt prepared: action={}, provider={}, model={}, prompt_bytes={}, prompt_chars={}, elapsed_ms={}",
        request.action.label(),
        request.provider.as_str(),
        request.model,
        prepared.prompt.len(),
        prepared.prompt.chars().count(),
        prepare_started.elapsed().as_millis()
    );

    if matches!(request.action, GenerateAiActionKind::Summary) && request.note_entry_id.is_none() {
        let message = "Summarize notes requires an editable note entry.";
        return state.with_service(|service| {
            let failed_run = service.fail_ai_run(&prepared.ai_run.id, message)?;
            Ok(GenerateAiActionResult {
                generation_context: prepared.generation_context,
                ai_run: failed_run,
                draft: None,
                finding: None,
                note_entry: None,
            })
        });
    }

    let output = execute_provider_generation(
        request.provider,
        &request.model,
        request.reasoning_effort.as_deref(),
        &prepared.prompt,
        &format!("AI action action={}", request.action.label()),
    );

    state.with_service(|service| finish_ai_action_generation(service, &request, prepared, output))
}

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

    if matches!(request.action, GenerateAiActionKind::Summary) && request.note_entry_id.is_none() {
        let message = "Summarize notes requires an editable note entry.";
        let result = state.with_service(|service| {
            let failed_run = service.fail_ai_run(&prepared.ai_run.id, message)?;
            Ok(GenerateAiActionResult {
                generation_context: prepared.generation_context,
                ai_run: failed_run,
                draft: None,
                finding: None,
                note_entry: None,
            })
        });
        send_job_failure(
            &events,
            &jobs,
            &job_id,
            &request,
            result,
            message.to_string(),
        );
        return;
    }

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

fn prepare_ai_action_generation(
    service: &qa_scribe_core::services::SessionService,
    request: &GenerateAiActionRequest,
) -> qa_scribe_core::Result<PreparedGeneration> {
    let session = service
        .get_session(&request.session_id)?
        .ok_or_else(|| qa_scribe_core::QaScribeError::NotFound(request.session_id.clone()))?;
    let settings = service.get_settings()?;
    let entries = service.list_entries(&request.session_id)?;
    let findings = service.list_findings(&request.session_id)?;
    let attachments = service.list_attachments(&request.session_id)?;
    let generation_context = service.create_generation_context(&request.session_id)?;
    let ai_run = service.create_ai_run(AiRunCreate {
        session_id: request.session_id.clone(),
        generation_context_id: Some(generation_context.id.clone()),
        provider: request.provider,
        model: request.model.clone(),
        reasoning_effort: request.reasoning_effort.clone(),
        prompt_version: request.action.prompt_version().to_string(),
    })?;

    let note_entry = request
        .note_entry_id
        .as_deref()
        .and_then(|id| entries.iter().find(|entry| entry.id == id))
        .or_else(|| {
            entries
                .iter()
                .find(|entry| entry.entry_type == EntryType::Note)
        });
    let mut prompt = render_action_prompt(
        &settings,
        &session.title,
        note_entry,
        &entries,
        &findings,
        &attachments,
        request.action.prompt_kind(),
    );
    prompt.push_str(&format!(
        "\n# Provider Request\nAction: {}\nProvider: {}\nModel: {}\nReasoning Effort: {}\n",
        request.action.label(),
        request.provider.as_str(),
        request.model,
        request.reasoning_effort.as_deref().unwrap_or("unspecified")
    ));

    Ok(PreparedGeneration {
        session_id: request.session_id.clone(),
        session_title: session.title,
        generation_context,
        ai_run,
        prompt,
        selected_note_body: note_entry.map(|entry| entry.body.clone()),
        attachments,
    })
}

fn finish_ai_action_generation(
    service: &qa_scribe_core::services::SessionService,
    request: &GenerateAiActionRequest,
    prepared: PreparedGeneration,
    output: Result<ProviderGenerationOutput, String>,
) -> qa_scribe_core::Result<GenerateAiActionResult> {
    match output {
        Ok(output) if output.success() => {
            let response = output.response_text();
            let body = parse_rich_html_fragment_response(&response);
            let completed_run = service.complete_ai_run(&prepared.ai_run.id)?;
            match request.action {
                GenerateAiActionKind::Testware => {
                    let draft = service.create_draft(DraftCreate {
                        session_id: prepared.session_id,
                        ai_run_id: Some(completed_run.id.clone()),
                        kind: DraftKind::Testware,
                        title: format!("{} Test Cases", prepared.session_title),
                        body,
                    })?;
                    Ok(GenerateAiActionResult {
                        generation_context: prepared.generation_context,
                        ai_run: completed_run,
                        draft: Some(draft),
                        finding: None,
                        note_entry: None,
                    })
                }
                GenerateAiActionKind::Finding => {
                    let finding = service.create_finding(FindingDraft {
                        session_id: prepared.session_id,
                        title: derive_title(&body, "AI Finding"),
                        body,
                        kind: FindingKind::Bug,
                        metadata_json: None,
                    })?;
                    Ok(GenerateAiActionResult {
                        generation_context: prepared.generation_context,
                        ai_run: completed_run,
                        draft: None,
                        finding: Some(finding),
                        note_entry: None,
                    })
                }
                GenerateAiActionKind::Summary => {
                    let Some(note_entry_id) = &request.note_entry_id else {
                        let failed_run = service.fail_ai_run(
                            &completed_run.id,
                            "Summarize notes requires an editable note entry.",
                        )?;
                        return Ok(GenerateAiActionResult {
                            generation_context: prepared.generation_context,
                            ai_run: failed_run,
                            draft: None,
                            finding: None,
                            note_entry: None,
                        });
                    };
                    let body = preserve_managed_attachment_images(
                        &body,
                        prepared.selected_note_body.as_deref().unwrap_or_default(),
                        &prepared.attachments,
                    );
                    let note_entry = service.update_entry(
                        note_entry_id,
                        EntryPatch {
                            body: Some(body),
                            ..EntryPatch::default()
                        },
                    )?;
                    Ok(GenerateAiActionResult {
                        generation_context: prepared.generation_context,
                        ai_run: completed_run,
                        draft: None,
                        finding: None,
                        note_entry: Some(note_entry),
                    })
                }
            }
        }
        Ok(output) => {
            let message = output.failure_message();
            let failed_run = service.fail_ai_run(&prepared.ai_run.id, &message)?;
            Ok(GenerateAiActionResult {
                generation_context: prepared.generation_context,
                ai_run: failed_run,
                draft: None,
                finding: None,
                note_entry: None,
            })
        }
        Err(error) => {
            let failed_run = service.fail_ai_run(&prepared.ai_run.id, &error)?;
            Ok(GenerateAiActionResult {
                generation_context: prepared.generation_context,
                ai_run: failed_run,
                draft: None,
                finding: None,
                note_entry: None,
            })
        }
    }
}

#[tauri::command]
pub fn generate_session_report(
    state: State<'_, AppState>,
    request: GenerateSessionReportRequest,
) -> Result<GenerateSessionReportResult, String> {
    let prepared = state.with_service(|service| {
        let session = service
            .get_session(&request.session_id)?
            .ok_or_else(|| qa_scribe_core::QaScribeError::NotFound(request.session_id.clone()))?;
        let settings = service.get_settings()?;
        let entries = service.list_entries(&request.session_id)?;
        let findings = service.list_findings(&request.session_id)?;
        let attachments = service.list_attachments(&request.session_id)?;
        let generation_context = service.create_generation_context(&request.session_id)?;
        let ai_run = service.create_ai_run(AiRunCreate {
            session_id: request.session_id.clone(),
            generation_context_id: Some(generation_context.id.clone()),
            provider: request.provider,
            model: request.model.clone(),
            reasoning_effort: request.reasoning_effort.clone(),
            prompt_version: SESSION_REPORT_PROMPT_VERSION.to_string(),
        })?;
        let mut prompt =
            render_session_report_prompt(&settings, &session, &entries, &findings, &attachments);
        prompt.push_str(&format!(
            "\n# Provider Request\nProvider: {}\nModel: {}\nReasoning Effort: {}\n",
            request.provider.as_str(),
            request.model,
            request.reasoning_effort.as_deref().unwrap_or("unspecified")
        ));

        Ok(PreparedGeneration {
            session_id: request.session_id.clone(),
            session_title: session.title,
            generation_context,
            ai_run,
            prompt,
            selected_note_body: None,
            attachments,
        })
    })?;
    eprintln!(
        "qa-scribe session report prompt prepared: provider={}, model={}, prompt_bytes={}",
        request.provider.as_str(),
        request.model,
        prepared.prompt.len()
    );

    let output = execute_provider_generation(
        request.provider,
        &request.model,
        request.reasoning_effort.as_deref(),
        &prepared.prompt,
        "session report",
    );

    state.with_service(|service| match output {
        Ok(output) if output.success() => {
            let response = output.response_text();
            let body = parse_session_report_response(&response);
            let completed_run = service.complete_ai_run(&prepared.ai_run.id)?;
            let draft = service.create_draft(DraftCreate {
                session_id: prepared.session_id,
                ai_run_id: Some(completed_run.id.clone()),
                kind: DraftKind::SessionReport,
                title: format!("{} Session Report Draft", prepared.session_title),
                body,
            })?;
            Ok(GenerateSessionReportResult {
                generation_context: prepared.generation_context,
                ai_run: completed_run,
                draft: Some(draft),
            })
        }
        Ok(output) => {
            let message = output.failure_message();
            let failed_run = service.fail_ai_run(&prepared.ai_run.id, &message)?;
            Ok(GenerateSessionReportResult {
                generation_context: prepared.generation_context,
                ai_run: failed_run,
                draft: None,
            })
        }
        Err(error) => {
            let failed_run = service.fail_ai_run(&prepared.ai_run.id, &error)?;
            Ok(GenerateSessionReportResult {
                generation_context: prepared.generation_context,
                ai_run: failed_run,
                draft: None,
            })
        }
    })
}

fn execute_provider_generation(
    provider: AiProvider,
    model: &str,
    reasoning_effort: Option<&str>,
    prompt: &str,
    log_context: &str,
) -> Result<ProviderGenerationOutput, String> {
    let readiness = provider_readiness(provider);
    if !readiness.descriptor.status.is_ready() {
        return Err(readiness.descriptor.reason);
    }

    let command = generation_command(
        provider,
        prompt,
        model,
        reasoning_effort,
        readiness.copilot_runtime,
    )?;
    let started = Instant::now();
    let output = run_generation_command(&command).map(ProviderGenerationOutput::from);
    eprintln!(
        "qa-scribe {log_context} provider finished: elapsed_ms={}, success={}",
        started.elapsed().as_millis(),
        output
            .as_ref()
            .map(ProviderGenerationOutput::success)
            .unwrap_or(false)
    );
    output
}

#[allow(clippy::too_many_arguments)]
fn execute_provider_generation_streaming(
    provider: AiProvider,
    model: &str,
    reasoning_effort: Option<&str>,
    prompt: &str,
    log_context: &str,
    job_id: &str,
    jobs: &JobStore,
    events: &Channel<GenerationJobEvent>,
    control: &JobControl,
) -> Result<ProviderGenerationOutput, String> {
    let readiness = provider_readiness(provider);
    if !readiness.descriptor.status.is_ready() {
        return Err(readiness.descriptor.reason);
    }

    let command = streaming_generation_command(
        provider,
        prompt,
        model,
        reasoning_effort,
        readiness.copilot_runtime,
    )?;
    let started = Instant::now();
    let mut last_partial_len = 0usize;
    let mut last_partial_emit = Instant::now()
        .checked_sub(PARTIAL_UPDATE_INTERVAL)
        .unwrap_or_else(Instant::now);
    let output = run_generation_command_streaming(&command, control, |update| match update {
        StreamUpdate::Progress(message) => {
            let _ = send_progress(events, jobs, job_id, &message);
        }
        StreamUpdate::Partial(body) => {
            let body_len = body.len();
            let enough_new_text = body_len < last_partial_len
                || body_len.saturating_sub(last_partial_len) >= PARTIAL_UPDATE_MIN_BYTES;
            if !enough_new_text && last_partial_emit.elapsed() < PARTIAL_UPDATE_INTERVAL {
                return;
            }
            last_partial_len = body_len;
            last_partial_emit = Instant::now();
            let status = jobs.update_partial(job_id, &body);
            if let Ok(status) = status {
                send_event(
                    events,
                    GenerationJobEvent::Partial {
                        job_id: job_id.to_string(),
                        status,
                        body,
                    },
                );
            }
        }
    });
    eprintln!(
        "qa-scribe {log_context} provider stream finished: elapsed_ms={}, success={}",
        started.elapsed().as_millis(),
        output
            .as_ref()
            .map(ProviderGenerationOutput::success)
            .unwrap_or(false)
    );
    output
}

fn run_generation_command(command: &GenerationCommand) -> Result<Output, String> {
    let mut process = Command::new(&command.program);
    process
        .args(&command.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_provider_path(&mut process);

    let mut child = process.spawn().map_err(|error| error.to_string())?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(command.stdin.as_bytes())
            .map_err(|error| error.to_string())?;
    }

    child.wait_with_output().map_err(|error| error.to_string())
}

fn run_generation_command_streaming(
    command: &GenerationCommand,
    control: &JobControl,
    mut on_update: impl FnMut(StreamUpdate),
) -> Result<ProviderGenerationOutput, String> {
    if control.is_cancelled() {
        return Ok(ProviderGenerationOutput::cancelled());
    }

    let mut process = Command::new(&command.program);
    process
        .args(&command.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_provider_path(&mut process);

    let mut child = process.spawn().map_err(|error| error.to_string())?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(command.stdin.as_bytes())
            .map_err(|error| error.to_string())?;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "provider stdout was not available".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "provider stderr was not available".to_string())?;
    control.set_child(child)?;

    let stderr_reader = thread::spawn(move || {
        let mut buffer = Vec::new();
        let mut reader = BufReader::new(stderr);
        let _ = reader.read_to_end(&mut buffer);
        buffer
    });

    let mut stdout_reader = BufReader::new(stdout);
    let mut stdout_bytes = Vec::new();
    let mut parser = ProviderStreamParser::new(command.output_format);
    let mut chunk = Vec::new();

    loop {
        chunk.clear();
        let read = stdout_reader
            .read_until(b'\n', &mut chunk)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        stdout_bytes.extend_from_slice(&chunk);
        for update in parser.push_bytes(&chunk) {
            on_update(update);
        }
        if control.is_cancelled()
            && let Some(mut child) = control.take_child()?
        {
            let _ = child.kill();
            control.set_child(child)?;
        }
    }

    let status = match control.take_child()? {
        Some(mut child) => Some(child.wait().map_err(|error| error.to_string())?),
        None => None,
    };
    let stderr = stderr_reader
        .join()
        .map_err(|_| "provider stderr reader panicked".to_string())?;

    Ok(ProviderGenerationOutput {
        status,
        stdout: stdout_bytes,
        stderr,
        assistant_text: parser.finish(),
        cancelled: control.is_cancelled(),
    })
}

struct ProviderGenerationOutput {
    status: Option<ExitStatus>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    assistant_text: Option<String>,
    cancelled: bool,
}

impl ProviderGenerationOutput {
    fn cancelled() -> Self {
        Self {
            status: None,
            stdout: Vec::new(),
            stderr: Vec::new(),
            assistant_text: None,
            cancelled: true,
        }
    }

    fn success(&self) -> bool {
        !self.cancelled && self.status.is_some_and(|status| status.success())
    }

    fn response_text(&self) -> String {
        self.assistant_text
            .as_ref()
            .filter(|text| !text.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| String::from_utf8_lossy(&self.stdout).to_string())
    }

    fn failure_message(&self) -> String {
        if self.cancelled {
            return "Generation cancelled.".to_string();
        }
        let stderr = String::from_utf8_lossy(&self.stderr);
        if stderr.trim().is_empty() {
            "provider command failed".to_string()
        } else {
            stderr.trim().to_string()
        }
    }
}

impl From<Output> for ProviderGenerationOutput {
    fn from(output: Output) -> Self {
        Self {
            status: Some(output.status),
            stdout: output.stdout,
            stderr: output.stderr,
            assistant_text: None,
            cancelled: false,
        }
    }
}

enum StreamUpdate {
    Progress(String),
    Partial(String),
}

struct ProviderStreamParser {
    output_format: GenerationOutputFormat,
    assistant_text: String,
}

impl ProviderStreamParser {
    fn new(output_format: GenerationOutputFormat) -> Self {
        Self {
            output_format,
            assistant_text: String::new(),
        }
    }

    fn push_bytes(&mut self, bytes: &[u8]) -> Vec<StreamUpdate> {
        match self.output_format {
            GenerationOutputFormat::PlainText => self.push_plain(bytes),
            GenerationOutputFormat::CodexJsonl | GenerationOutputFormat::ClaudeStreamJson => {
                self.push_json_line(bytes)
            }
        }
    }

    fn finish(self) -> Option<String> {
        let text = self.assistant_text.trim().to_string();
        if text.is_empty() { None } else { Some(text) }
    }

    fn push_plain(&mut self, bytes: &[u8]) -> Vec<StreamUpdate> {
        let text = String::from_utf8_lossy(bytes);
        self.assistant_text.push_str(&text);
        vec![StreamUpdate::Partial(self.assistant_text.clone())]
    }

    fn push_json_line(&mut self, bytes: &[u8]) -> Vec<StreamUpdate> {
        let line = String::from_utf8_lossy(bytes);
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            return vec![StreamUpdate::Progress(
                "Provider emitted output".to_string(),
            )];
        };

        let event_name = stream_event_name(&value);
        if let Some(final_text) = final_text_from_event(&value) {
            self.assistant_text = final_text;
            return vec![StreamUpdate::Partial(self.assistant_text.clone())];
        }

        if let Some(delta) = delta_text_from_event(&value, &event_name) {
            self.assistant_text.push_str(&delta);
            return vec![StreamUpdate::Partial(self.assistant_text.clone())];
        }

        if let Some(snapshot) = snapshot_text_from_event(&value, &event_name)
            && snapshot.len() >= self.assistant_text.len()
        {
            self.assistant_text = snapshot;
            return vec![StreamUpdate::Partial(self.assistant_text.clone())];
        }

        event_name
            .map(|name| StreamUpdate::Progress(provider_event_label(&name)))
            .into_iter()
            .collect()
    }
}

fn stream_event_name(value: &Value) -> Option<String> {
    ["type", "event", "method"]
        .iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(ToString::to_string)
        .or_else(|| {
            value
                .get("msg")
                .and_then(stream_event_name)
                .or_else(|| value.get("message").and_then(stream_event_name))
        })
}

fn final_text_from_event(value: &Value) -> Option<String> {
    for key in ["result", "final", "finalMessage", "lastMessage", "output"] {
        if let Some(text) = value.get(key).and_then(Value::as_str)
            && !text.trim().is_empty()
        {
            return Some(text.to_string());
        }
    }

    let event_name = stream_event_name(value).unwrap_or_default();
    if !(event_name.contains("completed")
        || event_name.contains("complete")
        || event_name.contains("result"))
    {
        return None;
    }

    snapshot_text_from_event(value, &Some(event_name))
}

fn delta_text_from_event(value: &Value, event_name: &Option<String>) -> Option<String> {
    let event_name = event_name.as_deref().unwrap_or_default();
    if !(event_name.contains("delta") || event_name.contains("partial")) {
        return None;
    }

    let mut parts = Vec::new();
    collect_delta_strings(value, &mut parts);
    let text = parts.join("");
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

fn snapshot_text_from_event(value: &Value, event_name: &Option<String>) -> Option<String> {
    let event_name = event_name.as_deref().unwrap_or_default();
    if !(event_name.contains("assistant")
        || event_name.contains("message")
        || event_name.contains("completed")
        || event_name.contains("result"))
    {
        return None;
    }

    let candidate = value
        .get("message")
        .or_else(|| value.get("item"))
        .or_else(|| value.get("content"))
        .unwrap_or(value);
    let mut parts = Vec::new();
    collect_text_strings(candidate, &mut parts);
    let text = parts.join("");
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

fn collect_delta_strings(value: &Value, parts: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            if let Some(delta) = map.get("delta") {
                collect_text_strings(delta, parts);
            }
            if let Some(text) = map.get("text").and_then(Value::as_str)
                && map
                    .get("type")
                    .and_then(Value::as_str)
                    .is_some_and(|kind| kind.contains("delta"))
            {
                parts.push(text.to_string());
            }
            for nested in map.values() {
                collect_delta_strings(nested, parts);
            }
        }
        Value::Array(values) => {
            for nested in values {
                collect_delta_strings(nested, parts);
            }
        }
        _ => {}
    }
}

fn collect_text_strings(value: &Value, parts: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(Value::as_str) {
                parts.push(text.to_string());
            }
            if let Some(content) = map.get("content") {
                collect_text_strings(content, parts);
            }
            if let Some(delta) = map.get("delta") {
                collect_text_strings(delta, parts);
            }
        }
        Value::Array(values) => {
            for nested in values {
                collect_text_strings(nested, parts);
            }
        }
        Value::String(text) => parts.push(text.clone()),
        _ => {}
    }
}

fn provider_event_label(event_name: &str) -> String {
    match event_name {
        name if name.contains("turn.started") || name.contains("start") => {
            "Provider started".to_string()
        }
        name if name.contains("reason") => "Provider is reasoning".to_string(),
        name if name.contains("tool") || name.contains("command") => {
            "Provider is using local tools".to_string()
        }
        name if name.contains("complete") => "Provider completed response".to_string(),
        _ => "Provider is working".to_string(),
    }
}

fn send_event(events: &Channel<GenerationJobEvent>, event: GenerationJobEvent) {
    let _ = events.send(event);
}

fn send_progress(
    events: &Channel<GenerationJobEvent>,
    jobs: &JobStore,
    job_id: &str,
    message: &str,
) -> Result<GenerationJobStatus, String> {
    let status = jobs.update_progress(job_id, message)?;
    send_event(
        events,
        GenerationJobEvent::Progress {
            job_id: job_id.to_string(),
            status: status.clone(),
            message: message.to_string(),
        },
    );
    Ok(status)
}

fn send_job_failure(
    events: &Channel<GenerationJobEvent>,
    jobs: &JobStore,
    job_id: &str,
    request: &GenerateAiActionRequest,
    result: Result<GenerateAiActionResult, String>,
    fallback_error: String,
) {
    match result {
        Ok(result) => {
            let error_message = result
                .ai_run
                .error_message
                .clone()
                .unwrap_or(fallback_error);
            let status = jobs.fail(job_id, &error_message).unwrap_or_else(|_| {
                fallback_status(job_id, request, GenerationJobState::Failed, &error_message)
            });
            send_event(
                events,
                GenerationJobEvent::Failed {
                    job_id: job_id.to_string(),
                    status,
                    error_message,
                    ai_run: Some(result.ai_run),
                },
            );
        }
        Err(error) => {
            let status = jobs.fail(job_id, &error).unwrap_or_else(|_| {
                fallback_status(job_id, request, GenerationJobState::Failed, &error)
            });
            send_event(
                events,
                GenerationJobEvent::Failed {
                    job_id: job_id.to_string(),
                    status,
                    error_message: error,
                    ai_run: None,
                },
            );
        }
    }
}

fn finish_cancelled_job(
    events: &Channel<GenerationJobEvent>,
    jobs: &JobStore,
    state: &AppState,
    job_id: &str,
    request: &GenerateAiActionRequest,
    ai_run_id: &str,
) {
    let ai_run = state
        .with_service(|service| service.fail_ai_run(ai_run_id, "Generation cancelled."))
        .ok();
    let status = jobs.mark_cancelled(job_id).unwrap_or_else(|_| {
        fallback_status(
            job_id,
            request,
            GenerationJobState::Cancelled,
            "Generation cancelled.",
        )
    });
    send_event(
        events,
        GenerationJobEvent::Cancelled {
            job_id: job_id.to_string(),
            status,
            ai_run,
        },
    );
}

fn fallback_status(
    job_id: &str,
    request: &GenerateAiActionRequest,
    state: GenerationJobState,
    message: &str,
) -> GenerationJobStatus {
    GenerationJobStatus {
        job_id: job_id.to_string(),
        session_id: request.session_id.clone(),
        action: request.action.as_str().to_string(),
        state,
        progress_message: message.to_string(),
        ai_run_id: None,
        error_message: (!message.is_empty()).then(|| message.to_string()),
        partial_text: None,
    }
}

fn derive_title(markdown: &str, fallback: &str) -> String {
    project_html_to_prompt_text(markdown)
        .lines()
        .map(|line| line.trim().trim_start_matches('#').trim())
        .map(|line| line.trim_start_matches("- ").trim())
        .find(|line| !line.is_empty())
        .unwrap_or(fallback)
        .chars()
        .take(120)
        .collect()
}

#[cfg(test)]
mod tests {
    use std::{os::unix::process::ExitStatusExt, process::ExitStatus};

    use qa_scribe_core::{
        ai::GenerationOutputFormat,
        domain::{AiProvider, EntryDraft, EntryType, SessionDraft},
        services::SessionService,
    };

    use super::{
        GenerateAiActionKind, GenerateAiActionRequest, ProviderGenerationOutput,
        ProviderStreamParser, StreamUpdate, finish_ai_action_generation,
        prepare_ai_action_generation,
    };

    #[test]
    fn stream_parser_accumulates_codex_style_deltas() {
        let mut parser = ProviderStreamParser::new(GenerationOutputFormat::CodexJsonl);

        parser.push_bytes(br#"{"type":"item/agentMessage/delta","delta":"Hello "}"#);
        let updates = parser.push_bytes(br#"{"type":"item/agentMessage/delta","delta":"world"}"#);

        assert!(matches!(
            updates.last(),
            Some(StreamUpdate::Partial(body)) if body == "Hello world"
        ));
        assert_eq!(parser.finish().as_deref(), Some("Hello world"));
    }

    #[test]
    fn stream_parser_prefers_final_result_text() {
        let mut parser = ProviderStreamParser::new(GenerationOutputFormat::ClaudeStreamJson);

        parser.push_bytes(br#"{"type":"content_block_delta","delta":{"text":"draft"}}"#);
        parser.push_bytes(br##"{"type":"result","result":"# Final draft"}"##);

        assert_eq!(parser.finish().as_deref(), Some("# Final draft"));
    }

    #[test]
    fn stream_parser_keeps_plain_text_output() {
        let mut parser = ProviderStreamParser::new(GenerationOutputFormat::PlainText);

        parser.push_bytes(b"line one\n");
        parser.push_bytes(b"line two\n");

        assert_eq!(parser.finish().as_deref(), Some("line one\nline two"));
    }

    #[test]
    fn action_completion_repairs_escaped_rich_html_before_persistence() {
        for action in [
            GenerateAiActionKind::Testware,
            GenerateAiActionKind::Finding,
            GenerateAiActionKind::Summary,
        ] {
            let result = finish_action_with_output(
                action,
                "&lt;h2&gt;Escaped Title&lt;/h2&gt;&lt;p&gt;Generated rich content.&lt;/p&gt;",
            );
            let body = match action {
                GenerateAiActionKind::Testware => result.draft.expect("draft").body,
                GenerateAiActionKind::Finding => {
                    let finding = result.finding.expect("finding");
                    assert_eq!(finding.title, "Escaped Title");
                    finding.body
                }
                GenerateAiActionKind::Summary => result.note_entry.expect("note entry").body,
            };

            assert!(body.contains("<h2>Escaped Title</h2>"));
            assert!(body.contains("<p>Generated rich content.</p>"));
            assert!(!body.contains("&lt;p&gt;"));
            assert!(!body.contains("&lt;h2&gt;"));
        }
    }

    fn finish_action_with_output(
        action: GenerateAiActionKind,
        response: &str,
    ) -> super::GenerateAiActionResult {
        let service = SessionService::in_memory().expect("service should open");
        let session = service
            .create_session(SessionDraft {
                title: "Gmail login".to_string(),
                ..SessionDraft::default()
            })
            .expect("session should create");
        let note = service
            .create_entry(EntryDraft {
                session_id: session.id.clone(),
                entry_type: EntryType::Note,
                title: Some("Gmail login".to_string()),
                body: "<p>Gmail login fails.</p>".to_string(),
                metadata_json: None,
                excluded_from_generation: false,
            })
            .expect("note should create");
        let request = GenerateAiActionRequest {
            session_id: session.id,
            provider: AiProvider::CodexCli,
            model: "test-model".to_string(),
            reasoning_effort: None,
            action,
            note_entry_id: Some(note.id),
        };
        let prepared =
            prepare_ai_action_generation(&service, &request).expect("generation should prepare");

        finish_ai_action_generation(
            &service,
            &request,
            prepared,
            Ok(success_generation_output(response)),
        )
        .expect("generation should finish")
    }

    fn success_generation_output(response: &str) -> ProviderGenerationOutput {
        ProviderGenerationOutput {
            status: Some(ExitStatus::from_raw(0)),
            stdout: response.as_bytes().to_vec(),
            stderr: Vec::new(),
            assistant_text: None,
            cancelled: false,
        }
    }
}
