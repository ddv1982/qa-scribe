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
        EntryType, EvidenceLinkDraft, Finding, FindingDraft, FindingKind, GenerationContext,
    },
    generation::{
        ActionPromptKind, SESSION_REPORT_PROMPT_VERSION, managed_attachment_ids_from_html,
        parse_rich_html_fragment_response, parse_session_report_response,
        preserve_managed_attachment_images, project_html_to_prompt_text, render_action_prompt,
        render_session_report_prompt,
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
    pub testware_preferences: Option<TestwareGenerationPreferences>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TestwareTechnique {
    Auto,
    UseCase,
    EquivalenceBoundary,
    DecisionTable,
    StateTransition,
    Pairwise,
    RiskBased,
    Exploratory,
    Bdd,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TestwareOutputFormat {
    QaCases,
    Checklist,
    Gherkin,
    Charters,
    CoverageOutline,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TestwareDepth {
    Lean,
    Balanced,
    Thorough,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestwareGenerationPreferences {
    pub technique: TestwareTechnique,
    pub output_format: TestwareOutputFormat,
    pub depth: TestwareDepth,
    pub include_negative_cases: bool,
    pub include_boundary_cases: bool,
    pub include_test_data: bool,
    pub preserve_evidence: bool,
    pub custom_instructions: Option<String>,
}

impl TestwareTechnique {
    fn label(self) -> &'static str {
        match self {
            TestwareTechnique::Auto => "Auto-select",
            TestwareTechnique::UseCase => "Use case flows",
            TestwareTechnique::EquivalenceBoundary => "Equivalence and boundary",
            TestwareTechnique::DecisionTable => "Decision table",
            TestwareTechnique::StateTransition => "State transition",
            TestwareTechnique::Pairwise => "Pairwise coverage",
            TestwareTechnique::RiskBased => "Risk-based",
            TestwareTechnique::Exploratory => "Exploratory charters",
            TestwareTechnique::Bdd => "BDD scenarios",
        }
    }

    fn guidance(self) -> &'static str {
        match self {
            TestwareTechnique::Auto => {
                "Inspect the note and choose the strongest fitting technique. State the chosen technique in the output."
            }
            TestwareTechnique::UseCase => {
                "Model the main user or system flows, including happy paths, alternate paths, and exception paths."
            }
            TestwareTechnique::EquivalenceBoundary => {
                "Identify equivalence classes and relevant boundaries. Include valid and invalid partitions, plus min/at/max style checks when the note supports them."
            }
            TestwareTechnique::DecisionTable => {
                "Identify conditions, actions, and rule combinations. Render the table-like coverage as headings and lists, not a literal HTML table."
            }
            TestwareTechnique::StateTransition => {
                "Identify states, events, transitions, and invalid transitions. Cover meaningful state changes and recovery paths."
            }
            TestwareTechnique::Pairwise => {
                "Extract parameters and values, then create a compact pairwise-style scenario set. If dimensions are missing, state assumptions and fall back to scenario coverage."
            }
            TestwareTechnique::RiskBased => {
                "Prioritize cases by likely product risk, impact, likelihood, and recent change complexity. Add concise risk notes per group."
            }
            TestwareTechnique::Exploratory => {
                "Create exploratory charters with mission, risks, setup/data, timebox, checks, and observation prompts."
            }
            TestwareTechnique::Bdd => {
                "Use Gherkin-like Given/When/Then scenario structure in clean HTML, without code fences."
            }
        }
    }
}

impl TestwareOutputFormat {
    fn label(self) -> &'static str {
        match self {
            TestwareOutputFormat::QaCases => "QA test cases",
            TestwareOutputFormat::Checklist => "Checklist",
            TestwareOutputFormat::Gherkin => "Gherkin-style scenarios",
            TestwareOutputFormat::Charters => "Exploratory charters",
            TestwareOutputFormat::CoverageOutline => "Coverage outline",
        }
    }

    fn guidance(self) -> &'static str {
        match self {
            TestwareOutputFormat::QaCases => {
                "Use h2 scenario groups and h3 test cases. For each case include preconditions, test data, steps, expected result, and coverage notes when applicable."
            }
            TestwareOutputFormat::Checklist => {
                "Use checklist items for executable checks. Keep each item directly testable and include expected results where useful."
            }
            TestwareOutputFormat::Gherkin => {
                "Use Feature/Scenario style content with Given/When/Then phrasing in h2, h3, p, ul, and ol elements."
            }
            TestwareOutputFormat::Charters => {
                "Use exploratory charter sections with mission, scope, risks, setup/data, timebox, and notes to capture observations."
            }
            TestwareOutputFormat::CoverageOutline => {
                "Start with a compact coverage map, then list the concrete cases needed to exercise each area."
            }
        }
    }
}

impl TestwareDepth {
    fn label(self) -> &'static str {
        match self {
            TestwareDepth::Lean => "Lean",
            TestwareDepth::Balanced => "Balanced",
            TestwareDepth::Thorough => "Thorough",
        }
    }

    fn guidance(self) -> &'static str {
        match self {
            TestwareDepth::Lean => "Target 3-5 high-value cases or charters.",
            TestwareDepth::Balanced => "Target 6-10 cases or charters when the note supports it.",
            TestwareDepth::Thorough => {
                "Target 10-16 cases or charters when the note supports it, with broader negative and edge coverage."
            }
        }
    }
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
    selected_note_id: Option<String>,
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
    if matches!(request.action, GenerateAiActionKind::Testware) {
        prompt.push_str(&testware_preferences_prompt(
            request.testware_preferences.as_ref(),
        ));
    }
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
        selected_note_id: note_entry.map(|entry| entry.id.clone()),
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
                    let body = preserve_managed_attachment_images(
                        &body,
                        prepared.selected_note_body.as_deref().unwrap_or_default(),
                        &prepared.attachments,
                    );
                    let draft = service.create_draft(DraftCreate {
                        session_id: prepared.session_id,
                        ai_run_id: Some(completed_run.id.clone()),
                        kind: DraftKind::Testware,
                        title: format!("{} Test Cases", prepared.session_title),
                        body,
                        body_json: None,
                        body_format: Some("html".to_string()),
                        metadata_json: testware_metadata_json(
                            request.testware_preferences.as_ref(),
                        ),
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
                    let body = preserve_managed_attachment_images(
                        &body,
                        prepared.selected_note_body.as_deref().unwrap_or_default(),
                        &prepared.attachments,
                    );
                    let finding = service.create_finding(FindingDraft {
                        session_id: prepared.session_id.clone(),
                        title: derive_title(&body, "AI Finding"),
                        body,
                        body_json: None,
                        body_format: Some("html".to_string()),
                        kind: FindingKind::Bug,
                        metadata_json: None,
                    })?;
                    create_generated_finding_evidence_links(
                        service,
                        &finding.id,
                        prepared.selected_note_id.as_deref(),
                        prepared.selected_note_body.as_deref().unwrap_or_default(),
                        &prepared.attachments,
                    )?;
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
                            body_json: Some(None),
                            body_format: Some(Some("html".to_string())),
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
            let message = output.failure_message_for_provider(request.provider);
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

fn default_testware_preferences() -> TestwareGenerationPreferences {
    TestwareGenerationPreferences {
        technique: TestwareTechnique::Auto,
        output_format: TestwareOutputFormat::QaCases,
        depth: TestwareDepth::Balanced,
        include_negative_cases: true,
        include_boundary_cases: true,
        include_test_data: true,
        preserve_evidence: true,
        custom_instructions: None,
    }
}

fn testware_preferences_prompt(preferences: Option<&TestwareGenerationPreferences>) -> String {
    let default_preferences;
    let preferences = match preferences {
        Some(preferences) => preferences,
        None => {
            default_preferences = default_testware_preferences();
            &default_preferences
        }
    };
    let custom_instructions = preferences
        .custom_instructions
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("None");

    format!(
        "\n# Testware Generation Preferences\n\
Technique: {}\n\
Technique guidance: {}\n\
Output format: {}\n\
Output contract: {}\n\
Depth: {} - {}\n\
Include negative cases: {}\n\
Include boundary cases: {}\n\
Include test data: {}\n\
Preserve evidence: {}\n\
Additional user guidance: {}\n\
\n\
Honor these preferences while still using only supplied note material and managed image references. \
If the selected technique cannot be applied cleanly, say what was missing and use the nearest useful coverage structure.\n",
        preferences.technique.label(),
        preferences.technique.guidance(),
        preferences.output_format.label(),
        preferences.output_format.guidance(),
        preferences.depth.label(),
        preferences.depth.guidance(),
        yes_no(preferences.include_negative_cases),
        yes_no(preferences.include_boundary_cases),
        yes_no(preferences.include_test_data),
        yes_no(preferences.preserve_evidence),
        custom_instructions,
    )
}

fn yes_no(value: bool) -> &'static str {
    if value { "yes" } else { "no" }
}

fn testware_metadata_json(preferences: Option<&TestwareGenerationPreferences>) -> Option<String> {
    let default_preferences;
    let preferences = match preferences {
        Some(preferences) => preferences,
        None => {
            default_preferences = default_testware_preferences();
            &default_preferences
        }
    };

    serde_json::to_string(&serde_json::json!({
        "testwareGeneration": preferences,
    }))
    .ok()
}

fn create_generated_finding_evidence_links(
    service: &qa_scribe_core::services::SessionService,
    finding_id: &str,
    selected_note_id: Option<&str>,
    selected_note_body: &str,
    attachments: &[qa_scribe_core::domain::Attachment],
) -> qa_scribe_core::Result<()> {
    if let Some(entry_id) = selected_note_id {
        service.create_evidence_link(EvidenceLinkDraft {
            finding_id: finding_id.to_string(),
            entry_id: Some(entry_id.to_string()),
            attachment_id: None,
        })?;
    }

    let managed_attachment_ids = managed_attachment_ids_from_html(selected_note_body);
    for attachment in attachments
        .iter()
        .filter(|attachment| managed_attachment_ids.iter().any(|id| id == &attachment.id))
    {
        service.create_evidence_link(EvidenceLinkDraft {
            finding_id: finding_id.to_string(),
            entry_id: None,
            attachment_id: Some(attachment.id.clone()),
        })?;
    }

    Ok(())
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
        let source_html = session_report_source_html(&entries, &findings);
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
            selected_note_id: None,
            selected_note_body: Some(source_html),
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
            let body = preserve_managed_attachment_images(
                &parse_session_report_response(&response),
                prepared.selected_note_body.as_deref().unwrap_or_default(),
                &prepared.attachments,
            );
            let completed_run = service.complete_ai_run(&prepared.ai_run.id)?;
            let draft = service.create_draft(DraftCreate {
                session_id: prepared.session_id,
                ai_run_id: Some(completed_run.id.clone()),
                kind: DraftKind::SessionReport,
                title: format!("{} Session Report Draft", prepared.session_title),
                body,
                body_json: None,
                body_format: Some("html".to_string()),
                metadata_json: None,
            })?;
            Ok(GenerateSessionReportResult {
                generation_context: prepared.generation_context,
                ai_run: completed_run,
                draft: Some(draft),
            })
        }
        Ok(output) => {
            let message = output.failure_message_for_provider(request.provider);
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
        "qa-scribe {log_context} provider finished: elapsed_ms={}, success={}, failure={}",
        started.elapsed().as_millis(),
        output
            .as_ref()
            .map(ProviderGenerationOutput::success)
            .unwrap_or(false),
        output_failure_for_log(&output)
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
        "qa-scribe {log_context} provider stream finished: elapsed_ms={}, success={}, failure={}",
        started.elapsed().as_millis(),
        output
            .as_ref()
            .map(ProviderGenerationOutput::success)
            .unwrap_or(false),
        output_failure_for_log(&output)
    );
    output
}

fn output_failure_for_log(output: &Result<ProviderGenerationOutput, String>) -> String {
    match output {
        Ok(output) if output.success() => "none".to_string(),
        Ok(output) => truncate_for_log(&output.failure_message(), 500),
        Err(error) => truncate_for_log(error, 500),
    }
}

fn truncate_for_log(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    let mut chars = trimmed.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else if truncated.is_empty() {
        "none".to_string()
    } else {
        truncated
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

    fn failure_message_for_provider(&self, provider: AiProvider) -> String {
        let message = self.failure_message();
        if provider != AiProvider::CopilotCli {
            return message;
        }

        copilot_generation_failure_message(&message).unwrap_or(message)
    }
}

fn copilot_generation_failure_message(message: &str) -> Option<String> {
    let detail = message.to_ascii_lowercase();
    let auth_required = [
        "no authentication information found",
        "authentication failed",
        "authenticate",
        "not logged",
        "unauthorized",
        "401",
        "token",
        "login",
    ]
    .iter()
    .any(|needle| detail.contains(needle));
    if auth_required {
        return Some(format!(
            "GitHub Copilot CLI could not authenticate. Run `copilot login`, or set `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`. Last response: {message}"
        ));
    }

    let policy_or_license = ["forbidden", "403", "license", "policy", "copilot requests"]
        .iter()
        .any(|needle| detail.contains(needle));
    if policy_or_license {
        return Some(format!(
            "GitHub Copilot CLI was rejected by account, license, or policy settings. Check Copilot CLI access for this GitHub account. Last response: {message}"
        ));
    }

    None
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
    value
        .get("event")
        .and_then(stream_event_name)
        .or_else(|| value.get("message").and_then(stream_event_name))
        .or_else(|| value.get("msg").and_then(stream_event_name))
        .or_else(|| {
            ["type", "method"]
                .iter()
                .find_map(|key| value.get(*key).and_then(Value::as_str))
                .map(ToString::to_string)
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
            for (key, nested) in map {
                if key == "delta" {
                    continue;
                }
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

fn session_report_source_html(entries: &[Entry], findings: &[Finding]) -> String {
    let mut source = String::new();
    for entry in entries
        .iter()
        .filter(|entry| !entry.excluded_from_generation)
    {
        source.push_str(&entry.body);
        source.push('\n');
    }
    for finding in findings {
        source.push_str(&finding.body);
        source.push('\n');
    }
    source
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
        domain::{AiProvider, AttachmentDraft, EntryDraft, EntryPatch, EntryType, SessionDraft},
        services::SessionService,
    };

    use super::{
        GenerateAiActionKind, GenerateAiActionRequest, ProviderGenerationOutput,
        ProviderStreamParser, StreamUpdate, TestwareDepth, TestwareGenerationPreferences,
        TestwareOutputFormat, TestwareTechnique, finish_ai_action_generation,
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
    fn stream_parser_handles_verbose_claude_text_events() {
        let mut parser = ProviderStreamParser::new(GenerationOutputFormat::ClaudeStreamJson);

        parser.push_bytes(br#"{"type":"system","subtype":"init","model":"claude"}"#);
        parser.push_bytes(
            br#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"reasoning"}}}"#,
        );
        let updates = parser.push_bytes(
            br#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"<p>ok</p>"}}}"#,
        );

        assert!(matches!(
            updates.last(),
            Some(StreamUpdate::Partial(body)) if body == "<p>ok</p>"
        ));
        assert_eq!(parser.finish().as_deref(), Some("<p>ok</p>"));
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

    #[test]
    fn finding_completion_preserves_managed_screenshots_and_links_evidence() {
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
                body_json: None,
                body_format: Some("html".to_string()),
                metadata_json: None,
                excluded_from_generation: false,
            })
            .expect("note should create");
        let attachment = service
            .create_attachment(AttachmentDraft {
                session_id: session.id.clone(),
                entry_id: Some(note.id.clone()),
                filename: "gmail-error.png".to_string(),
                mime_type: Some("image/png".to_string()),
                size_bytes: 123,
                sha256: "a".repeat(64),
                relative_path: "attachments/session/gmail-error.png".to_string(),
            })
            .expect("attachment should create");
        let note = service
            .update_entry(
                &note.id,
                EntryPatch {
                    body: Some(format!(
                        "<p>Gmail login fails.</p><img src=\"qa-scribe-attachment://{}\" data-attachment-id=\"{}\" alt=\"Gmail error\" />",
                        attachment.id, attachment.id
                    )),
                    ..EntryPatch::default()
                },
            )
            .expect("note should update");
        let request = GenerateAiActionRequest {
            session_id: session.id.clone(),
            provider: AiProvider::CodexCli,
            model: "test-model".to_string(),
            reasoning_effort: None,
            action: GenerateAiActionKind::Finding,
            note_entry_id: Some(note.id.clone()),
            testware_preferences: None,
        };
        let prepared =
            prepare_ai_action_generation(&service, &request).expect("generation should prepare");
        let response = format!(
            "<h2>Gmail login fails</h2><p>Evidence:</p><img src=\"{}\" alt=\"Updated evidence\" />",
            attachment.relative_path
        );

        let result = finish_ai_action_generation(
            &service,
            &request,
            prepared,
            Ok(success_generation_output(&response)),
        )
        .expect("generation should finish");

        let finding = result.finding.expect("finding should be created");
        assert!(
            finding
                .body
                .contains(&format!("qa-scribe-attachment://{}", attachment.id))
        );
        assert!(
            finding
                .body
                .contains(&format!("data-attachment-id=\"{}\"", attachment.id))
        );
        assert!(
            !finding
                .body
                .contains(&format!("src=\"{}\"", attachment.relative_path))
        );

        let evidence_links = service
            .list_evidence_links(&session.id)
            .expect("evidence links should list");
        assert!(evidence_links.iter().any(|link| {
            link.finding_id == finding.id && link.entry_id.as_deref() == Some(note.id.as_str())
        }));
        assert!(evidence_links.iter().any(|link| {
            link.finding_id == finding.id
                && link.attachment_id.as_deref() == Some(attachment.id.as_str())
        }));
    }

    #[test]
    fn testware_completion_preserves_managed_screenshots() {
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
                body_json: None,
                body_format: Some("html".to_string()),
                metadata_json: None,
                excluded_from_generation: false,
            })
            .expect("note should create");
        let attachment = service
            .create_attachment(AttachmentDraft {
                session_id: session.id.clone(),
                entry_id: Some(note.id.clone()),
                filename: "gmail-error.png".to_string(),
                mime_type: Some("image/png".to_string()),
                size_bytes: 123,
                sha256: "a".repeat(64),
                relative_path: "attachments/session/gmail-error.png".to_string(),
            })
            .expect("attachment should create");
        let note = service
            .update_entry(
                &note.id,
                EntryPatch {
                    body: Some(format!(
                        "<p>Gmail login fails.</p><img src=\"qa-scribe-attachment://{}\" data-attachment-id=\"{}\" alt=\"Gmail error\" />",
                        attachment.id, attachment.id
                    )),
                    ..EntryPatch::default()
                },
            )
            .expect("note should update");
        let request = GenerateAiActionRequest {
            session_id: session.id.clone(),
            provider: AiProvider::CodexCli,
            model: "test-model".to_string(),
            reasoning_effort: None,
            action: GenerateAiActionKind::Testware,
            note_entry_id: Some(note.id.clone()),
            testware_preferences: None,
        };
        let prepared =
            prepare_ai_action_generation(&service, &request).expect("generation should prepare");

        let result = finish_ai_action_generation(
            &service,
            &request,
            prepared,
            Ok(success_generation_output(
                "<h2>Login test</h2><p>Verify the login error.</p>",
            )),
        )
        .expect("generation should finish");

        let draft = result.draft.expect("testware draft should be created");
        assert!(
            draft
                .body
                .contains(&format!("qa-scribe-attachment://{}", attachment.id))
        );
        assert!(
            draft
                .body
                .contains(&format!("data-attachment-id=\"{}\"", attachment.id))
        );
        assert!(draft.body.contains("alt=\"Gmail error\""));
    }

    #[test]
    fn testware_preferences_are_added_to_prompt_and_draft_metadata() {
        let service = SessionService::in_memory().expect("service should open");
        let session = service
            .create_session(SessionDraft {
                title: "Checkout rules".to_string(),
                ..SessionDraft::default()
            })
            .expect("session should create");
        let note = service
            .create_entry(EntryDraft {
                session_id: session.id.clone(),
                entry_type: EntryType::Note,
                title: Some("Checkout rules".to_string()),
                body: "<p>Discounts depend on country and basket total.</p>".to_string(),
                body_json: None,
                body_format: Some("html".to_string()),
                metadata_json: None,
                excluded_from_generation: false,
            })
            .expect("note should create");
        let preferences = TestwareGenerationPreferences {
            technique: TestwareTechnique::DecisionTable,
            output_format: TestwareOutputFormat::CoverageOutline,
            depth: TestwareDepth::Thorough,
            include_negative_cases: true,
            include_boundary_cases: true,
            include_test_data: false,
            preserve_evidence: true,
            custom_instructions: Some(
                "Prioritize country and basket total combinations.".to_string(),
            ),
        };
        let request = GenerateAiActionRequest {
            session_id: session.id.clone(),
            provider: AiProvider::CodexCli,
            model: "test-model".to_string(),
            reasoning_effort: None,
            action: GenerateAiActionKind::Testware,
            note_entry_id: Some(note.id),
            testware_preferences: Some(preferences),
        };
        let prepared =
            prepare_ai_action_generation(&service, &request).expect("generation should prepare");

        assert!(prepared.prompt.contains("Decision table"));
        assert!(prepared.prompt.contains("Coverage outline"));
        assert!(
            prepared
                .prompt
                .contains("Prioritize country and basket total combinations.")
        );

        let result = finish_ai_action_generation(
            &service,
            &request,
            prepared,
            Ok(success_generation_output("<h2>Coverage</h2><p>Case.</p>")),
        )
        .expect("generation should finish");
        let metadata = result
            .draft
            .expect("testware draft")
            .metadata_json
            .expect("testware metadata");
        assert!(metadata.contains("\"technique\":\"decision_table\""));
        assert!(metadata.contains("\"outputFormat\":\"coverage_outline\""));
        assert!(metadata.contains("\"includeTestData\":false"));
    }

    #[test]
    fn summary_completion_preserves_managed_screenshots_on_note_overwrite() {
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
                body_json: None,
                body_format: Some("html".to_string()),
                metadata_json: None,
                excluded_from_generation: false,
            })
            .expect("note should create");
        let attachment = service
            .create_attachment(AttachmentDraft {
                session_id: session.id.clone(),
                entry_id: Some(note.id.clone()),
                filename: "gmail-error.png".to_string(),
                mime_type: Some("image/png".to_string()),
                size_bytes: 123,
                sha256: "a".repeat(64),
                relative_path: "attachments/session/gmail-error.png".to_string(),
            })
            .expect("attachment should create");
        let note = service
            .update_entry(
                &note.id,
                EntryPatch {
                    body: Some(format!(
                        "<p>Gmail login fails.</p><img src=\"qa-scribe-attachment://{}\" data-attachment-id=\"{}\" alt=\"Gmail error\" />",
                        attachment.id, attachment.id
                    )),
                    ..EntryPatch::default()
                },
            )
            .expect("note should update");
        let request = GenerateAiActionRequest {
            session_id: session.id.clone(),
            provider: AiProvider::CodexCli,
            model: "test-model".to_string(),
            reasoning_effort: None,
            action: GenerateAiActionKind::Summary,
            note_entry_id: Some(note.id.clone()),
            testware_preferences: None,
        };
        let prepared =
            prepare_ai_action_generation(&service, &request).expect("generation should prepare");

        let result = finish_ai_action_generation(
            &service,
            &request,
            prepared,
            Ok(success_generation_output(
                "<h2>Summary</h2><p>Gmail login fails with an error.</p>",
            )),
        )
        .expect("generation should finish");

        let note_entry = result.note_entry.expect("note entry should update");
        assert!(
            note_entry
                .body
                .contains(&format!("qa-scribe-attachment://{}", attachment.id))
        );
        assert!(
            note_entry
                .body
                .contains(&format!("data-attachment-id=\"{}\"", attachment.id))
        );
        assert!(note_entry.body.contains("alt=\"Gmail error\""));
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
                body_json: None,
                body_format: Some("html".to_string()),
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
            testware_preferences: None,
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

    #[test]
    fn copilot_generation_auth_failure_gets_actionable_message() {
        let output = ProviderGenerationOutput {
            status: Some(ExitStatus::from_raw(1)),
            stdout: Vec::new(),
            stderr: b"Error: No authentication information found".to_vec(),
            assistant_text: None,
            cancelled: false,
        };

        let message = output.failure_message_for_provider(AiProvider::CopilotCli);

        assert!(message.contains("copilot login"));
        assert!(message.contains("COPILOT_GITHUB_TOKEN"));
        assert!(message.contains("No authentication information found"));
    }

    #[test]
    fn non_copilot_generation_failure_stays_raw() {
        let output = ProviderGenerationOutput {
            status: Some(ExitStatus::from_raw(1)),
            stdout: Vec::new(),
            stderr: b"Error: No authentication information found".to_vec(),
            assistant_text: None,
            cancelled: false,
        };

        assert_eq!(
            output.failure_message_for_provider(AiProvider::CodexCli),
            "Error: No authentication information found"
        );
    }
}
