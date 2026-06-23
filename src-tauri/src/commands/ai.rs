use std::{
    io::Write,
    process::{Command, Output, Stdio},
    time::Instant,
};

use qa_scribe_core::{
    ai::{GenerationCommand, generation_command},
    domain::{
        AiProvider, AiRun, AiRunCreate, Draft, DraftCreate, DraftKind, Entry, EntryPatch,
        EntryType, Finding, FindingDraft, FindingKind, GenerationContext,
    },
    generation::{
        ActionPromptKind, SESSION_REPORT_PROMPT_VERSION, parse_session_report_response,
        render_action_prompt, render_session_report_prompt,
    },
};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::providers::provider_readiness;
use crate::{provider_command::apply_provider_path, settings::AppState};

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
    fn prompt_version(self) -> &'static str {
        match self {
            GenerateAiActionKind::Testware => "testware-v2",
            GenerateAiActionKind::Finding => "finding-v2",
            GenerateAiActionKind::Summary => "note-summary-v2",
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

struct PreparedGeneration {
    session_id: String,
    session_title: String,
    generation_context: GenerationContext,
    ai_run: AiRun,
    prompt: String,
}

#[tauri::command]
pub fn generate_ai_action(
    state: State<'_, AppState>,
    request: GenerateAiActionRequest,
) -> Result<GenerateAiActionResult, String> {
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
        })
    })?;
    eprintln!(
        "qa-scribe AI action prompt prepared: action={}, provider={}, model={}, prompt_bytes={}",
        request.action.label(),
        request.provider.as_str(),
        request.model,
        prepared.prompt.len()
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
        &prepared.prompt,
        &format!("AI action action={}", request.action.label()),
    );

    state.with_service(|service| match output {
        Ok(output) if output.status.success() => {
            let response = String::from_utf8_lossy(&output.stdout);
            let body = parse_session_report_response(&response);
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
                    let Some(note_entry_id) = request.note_entry_id else {
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
                    let note_entry = service.update_entry(
                        &note_entry_id,
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
            let message = provider_failure_message(&output);
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
    })
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
        &prepared.prompt,
        "session report",
    );

    state.with_service(|service| match output {
        Ok(output) if output.status.success() => {
            let response = String::from_utf8_lossy(&output.stdout);
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
            let message = provider_failure_message(&output);
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
    prompt: &str,
    log_context: &str,
) -> Result<Output, String> {
    let readiness = provider_readiness(provider);
    if !readiness.descriptor.status.is_ready() {
        return Err(readiness.descriptor.reason);
    }

    let command = generation_command(provider, prompt, model, readiness.copilot_runtime)?;
    let started = Instant::now();
    let output = run_generation_command(&command);
    eprintln!(
        "qa-scribe {log_context} provider finished: elapsed_ms={}, success={}",
        started.elapsed().as_millis(),
        output
            .as_ref()
            .map(|output| output.status.success())
            .unwrap_or(false)
    );
    output
}

fn provider_failure_message(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.trim().is_empty() {
        "provider command failed".to_string()
    } else {
        stderr.trim().to_string()
    }
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

fn derive_title(markdown: &str, fallback: &str) -> String {
    markdown
        .lines()
        .map(|line| line.trim().trim_start_matches('#').trim())
        .find(|line| !line.is_empty())
        .unwrap_or(fallback)
        .chars()
        .take(120)
        .collect()
}
