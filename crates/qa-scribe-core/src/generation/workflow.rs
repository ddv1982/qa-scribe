//! The AI generation workflow: prepare a prompt + AiRun from session
//! material, then route a provider's output into the right record (testware
//! Draft, Finding with evidence links, or an updated note Entry).
//!
//! Provider execution itself happens between the two steps, behind
//! [`crate::ai::ProviderExecutor`]; the caller passes the resulting
//! [`ProviderGenerationOutput`] (or an error string) to the finish step.

use serde::{Deserialize, Serialize};

use crate::{
    QaScribeError, Result,
    ai::ProviderGenerationOutput,
    domain::{
        AiProvider, AiRun, AiRunCreate, Attachment, Draft, DraftCreate, DraftKind, Entry,
        EntryPatch, EntryType, Finding, FindingDraft, FindingKind, GenerationContext,
    },
    services::SessionService,
};

use super::{
    ActionPromptKind, OutputMarker, managed_attachment_ids_from_html,
    parse_rich_html_fragment_response,
    preferences::{
        TestwareGenerationPreferences, testware_metadata_json, testware_preferences_prompt,
    },
    preserve_managed_attachment_images, project_html_to_prompt_text, render_action_prompt,
    sanitize_generated_rich_html,
};

#[derive(Clone, Copy, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum GenerateAiActionKind {
    Testware,
    Finding,
    Summary,
}

impl GenerateAiActionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            GenerateAiActionKind::Testware => "testware",
            GenerateAiActionKind::Finding => "finding",
            GenerateAiActionKind::Summary => "summary",
        }
    }

    pub fn prompt_version(self) -> &'static str {
        match self {
            GenerateAiActionKind::Testware => "testware-v4",
            GenerateAiActionKind::Finding => "finding-v4",
            GenerateAiActionKind::Summary => "note-summary-v4",
        }
    }

    pub fn label(self) -> &'static str {
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

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAiActionRequest {
    pub session_id: String,
    pub provider: AiProvider,
    pub model: String,
    pub reasoning_effort: Option<String>,
    pub action: GenerateAiActionKind,
    #[specta(optional)]
    pub note_entry_id: Option<String>,
    #[specta(optional)]
    pub testware_preferences: Option<TestwareGenerationPreferences>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAiActionResult {
    pub generation_context: GenerationContext,
    pub ai_run: AiRun,
    pub draft: Option<Draft>,
    pub finding: Option<Finding>,
    pub note_entry: Option<Entry>,
}

/// Everything the prepare step persisted and derived: the AiRun to complete
/// or fail, the rendered prompt, and the source material the finish step
/// needs for evidence preservation. `output_marker` is the per-generation
/// sentinel the prompt asked the model to wrap its fragment in; the finish
/// step needs the same marker to extract the fragment from the response.
pub struct PreparedGeneration {
    pub session_id: String,
    pub session_title: String,
    pub generation_context: GenerationContext,
    pub ai_run: AiRun,
    pub prompt: String,
    pub output_marker: OutputMarker,
    pub selected_note_id: Option<String>,
    pub selected_note_body: Option<String>,
    pub attachments: Vec<Attachment>,
}

pub fn prepare_ai_action_generation(
    service: &SessionService,
    request: &GenerateAiActionRequest,
) -> Result<PreparedGeneration> {
    let session = service
        .get_session(&request.session_id)?
        .ok_or_else(|| QaScribeError::NotFound(request.session_id.clone()))?;
    let settings = service.get_settings()?;
    let entries = service.list_entries(&request.session_id)?;
    let note_entry = selected_note_entry(request, &entries)?;
    let attachments = service.list_attachments(&request.session_id)?;
    let generation_context =
        create_action_generation_context(service, &request.session_id, note_entry, &attachments)?;
    let ai_run = service.create_ai_run(AiRunCreate {
        session_id: request.session_id.clone(),
        generation_context_id: Some(generation_context.id.clone()),
        provider: request.provider,
        model: request.model.clone(),
        reasoning_effort: request.reasoning_effort.clone(),
        prompt_version: request.action.prompt_version().to_string(),
    })?;

    // Testware preferences are instructions, so they render inside the
    // prompt's instruction section (before the source material and the final
    // reminder) instead of being appended after the whole prompt.
    let extra_instructions = if matches!(request.action, GenerateAiActionKind::Testware) {
        testware_preferences_prompt(request.testware_preferences.as_ref())
    } else {
        String::new()
    };
    let output_marker = OutputMarker::new();
    let prompt = render_action_prompt(
        &settings,
        &session.title,
        note_entry,
        &attachments,
        request.action.prompt_kind(),
        &extra_instructions,
        &output_marker,
    );

    Ok(PreparedGeneration {
        session_id: request.session_id.clone(),
        session_title: session.title,
        generation_context,
        ai_run,
        prompt,
        output_marker,
        selected_note_id: note_entry.map(|entry| entry.id.clone()),
        selected_note_body: note_entry.map(|entry| entry.body.clone()),
        attachments,
    })
}

pub fn finish_ai_action_generation(
    service: &SessionService,
    request: &GenerateAiActionRequest,
    prepared: PreparedGeneration,
    output: std::result::Result<ProviderGenerationOutput, String>,
) -> Result<GenerateAiActionResult> {
    match output {
        Ok(output) if output.success() => {
            finish_successful_generation(service, request, prepared, output)
        }
        Ok(output) => {
            let message = output.failure_message_for_provider(request.provider);
            let failed_run = service.fail_ai_run(&prepared.ai_run.id, &message)?;
            Ok(failed_generation_result(prepared, failed_run))
        }
        Err(error) => {
            let failed_run = service.fail_ai_run(&prepared.ai_run.id, &error)?;
            Ok(failed_generation_result(prepared, failed_run))
        }
    }
}

fn selected_note_entry<'a>(
    request: &GenerateAiActionRequest,
    entries: &'a [Entry],
) -> Result<Option<&'a Entry>> {
    if let Some(note_entry_id) = request.note_entry_id.as_deref() {
        let entry = entries
            .iter()
            .find(|entry| entry.id == note_entry_id)
            .ok_or_else(|| {
                QaScribeError::Validation(
                    "Selected note entry was not found in this Session.".to_string(),
                )
            })?;
        if entry.entry_type != EntryType::Note {
            return Err(QaScribeError::Validation(
                "Selected entry must be a Note.".to_string(),
            ));
        }
        return Ok(Some(entry));
    }

    if matches!(request.action, GenerateAiActionKind::Summary) {
        return Err(QaScribeError::Validation(
            "Summarize notes requires an editable note entry.".to_string(),
        ));
    }

    Ok(entries
        .iter()
        .find(|entry| entry.entry_type == EntryType::Note))
}

fn finish_successful_generation(
    service: &SessionService,
    request: &GenerateAiActionRequest,
    prepared: PreparedGeneration,
    output: ProviderGenerationOutput,
) -> Result<GenerateAiActionResult> {
    let response = output.response_text();
    let body = parse_rich_html_fragment_response(&response, &prepared.output_marker);
    let ai_run_id = prepared.ai_run.id.clone();
    let result = match request.action {
        GenerateAiActionKind::Testware => {
            finish_testware_generation(service, request, prepared, body)
        }
        GenerateAiActionKind::Finding => finish_finding_generation(service, prepared, body),
        GenerateAiActionKind::Summary => finish_summary_generation(service, prepared, body),
    };

    match result {
        Ok(result) => Ok(result),
        Err(error) => {
            let _ = service.fail_ai_run(&ai_run_id, &error.to_string());
            Err(error)
        }
    }
}

fn create_action_generation_context(
    service: &SessionService,
    session_id: &str,
    note_entry: Option<&Entry>,
    attachments: &[Attachment],
) -> Result<GenerationContext> {
    let entry_ids = note_entry
        .map(|entry| vec![entry.id.clone()])
        .unwrap_or_default();
    let managed_attachment_ids = note_entry
        .map(|entry| managed_attachment_ids_from_html(&entry.body))
        .unwrap_or_default();
    let attachment_ids = attachments
        .iter()
        .filter(|attachment| managed_attachment_ids.iter().any(|id| id == &attachment.id))
        .map(|attachment| attachment.id.clone())
        .collect::<Vec<_>>();
    service.create_generation_context_from_material(session_id, &entry_ids, &attachment_ids)
}

fn finish_testware_generation(
    service: &SessionService,
    request: &GenerateAiActionRequest,
    prepared: PreparedGeneration,
    body: String,
) -> Result<GenerateAiActionResult> {
    let body = preserve_managed_attachment_images(
        &body,
        prepared.selected_note_body.as_deref().unwrap_or_default(),
        &prepared.attachments,
    );
    let body = sanitize_generated_rich_html(&body);
    let (ai_run, draft) = service.complete_ai_run_with_generated_draft(
        &prepared.ai_run.id,
        DraftCreate {
            session_id: prepared.session_id,
            ai_run_id: Some(prepared.ai_run.id.clone()),
            kind: DraftKind::Testware,
            title: format!("{} Test Cases", prepared.session_title),
            body,
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: testware_metadata_json(request.testware_preferences.as_ref()),
        },
    )?;
    Ok(GenerateAiActionResult {
        generation_context: prepared.generation_context,
        ai_run,
        draft: Some(draft),
        finding: None,
        note_entry: None,
    })
}

fn finish_finding_generation(
    service: &SessionService,
    prepared: PreparedGeneration,
    body: String,
) -> Result<GenerateAiActionResult> {
    let body = preserve_managed_attachment_images(
        &body,
        prepared.selected_note_body.as_deref().unwrap_or_default(),
        &prepared.attachments,
    );
    let body = sanitize_generated_rich_html(&body);
    let evidence_attachment_ids = generated_finding_evidence_attachment_ids(
        prepared.selected_note_body.as_deref().unwrap_or_default(),
        &prepared.attachments,
    );
    let (ai_run, finding) = service.complete_ai_run_with_generated_finding(
        &prepared.ai_run.id,
        FindingDraft {
            session_id: prepared.session_id.clone(),
            title: derive_title(&body, "AI Finding"),
            body,
            body_json: None,
            body_format: Some("html".to_string()),
            kind: FindingKind::Bug,
            metadata_json: None,
        },
        prepared.selected_note_id.as_deref(),
        &evidence_attachment_ids,
    )?;
    Ok(GenerateAiActionResult {
        generation_context: prepared.generation_context,
        ai_run,
        draft: None,
        finding: Some(finding),
        note_entry: None,
    })
}

fn finish_summary_generation(
    service: &SessionService,
    prepared: PreparedGeneration,
    body: String,
) -> Result<GenerateAiActionResult> {
    let Some(note_entry_id) = prepared.selected_note_id.as_deref() else {
        let failed_run = service.fail_ai_run(
            &prepared.ai_run.id,
            "Summarize notes requires an editable note entry.",
        )?;
        return Ok(failed_generation_result(prepared, failed_run));
    };
    let body = preserve_managed_attachment_images(
        &body,
        prepared.selected_note_body.as_deref().unwrap_or_default(),
        &prepared.attachments,
    );
    let body = sanitize_generated_rich_html(&body);
    let (ai_run, note_entry) = service.complete_ai_run_with_generated_note_update(
        &prepared.ai_run.id,
        note_entry_id,
        prepared.selected_note_body.as_deref().unwrap_or_default(),
        EntryPatch {
            body: Some(body),
            body_json: Some(None),
            body_format: Some(Some("html".to_string())),
            ..EntryPatch::default()
        },
    )?;
    Ok(GenerateAiActionResult {
        generation_context: prepared.generation_context,
        ai_run,
        draft: None,
        finding: None,
        note_entry: Some(note_entry),
    })
}

fn failed_generation_result(prepared: PreparedGeneration, ai_run: AiRun) -> GenerateAiActionResult {
    GenerateAiActionResult {
        generation_context: prepared.generation_context,
        ai_run,
        draft: None,
        finding: None,
        note_entry: None,
    }
}

fn generated_finding_evidence_attachment_ids(
    selected_note_body: &str,
    attachments: &[Attachment],
) -> Vec<String> {
    let managed_attachment_ids = managed_attachment_ids_from_html(selected_note_body);
    attachments
        .iter()
        .filter(|attachment| managed_attachment_ids.iter().any(|id| id == &attachment.id))
        .map(|attachment| attachment.id.clone())
        .collect()
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
mod tests;
