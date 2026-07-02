use qa_scribe_core::{
    domain::{
        AiRunCreate, DraftCreate, DraftKind, EntryPatch, EvidenceLinkDraft, FindingDraft,
        FindingKind,
    },
    generation::{
        managed_attachment_ids_from_html, parse_rich_html_fragment_response,
        preserve_managed_attachment_images, project_html_to_prompt_text, render_action_prompt,
    },
    services::SessionService,
};

use super::{
    preferences::{testware_metadata_json, testware_preferences_prompt},
    provider_execution::ProviderGenerationOutput,
    selection::selected_note_entry,
    types::{
        GenerateAiActionKind, GenerateAiActionRequest, GenerateAiActionResult, PreparedGeneration,
    },
};

pub(super) fn prepare_ai_action_generation(
    service: &SessionService,
    request: &GenerateAiActionRequest,
) -> qa_scribe_core::Result<PreparedGeneration> {
    let session = service
        .get_session(&request.session_id)?
        .ok_or_else(|| qa_scribe_core::QaScribeError::NotFound(request.session_id.clone()))?;
    let settings = service.get_settings()?;
    let entries = service.list_entries(&request.session_id)?;
    let note_entry = selected_note_entry(request, &entries)?;
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

pub(super) fn finish_ai_action_generation(
    service: &SessionService,
    request: &GenerateAiActionRequest,
    prepared: PreparedGeneration,
    output: Result<ProviderGenerationOutput, String>,
) -> qa_scribe_core::Result<GenerateAiActionResult> {
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

fn finish_successful_generation(
    service: &SessionService,
    request: &GenerateAiActionRequest,
    prepared: PreparedGeneration,
    output: ProviderGenerationOutput,
) -> qa_scribe_core::Result<GenerateAiActionResult> {
    let response = output.response_text();
    let body = parse_rich_html_fragment_response(&response);
    let completed_run = service.complete_ai_run(&prepared.ai_run.id)?;
    match request.action {
        GenerateAiActionKind::Testware => {
            finish_testware_generation(service, request, prepared, completed_run, body)
        }
        GenerateAiActionKind::Finding => {
            finish_finding_generation(service, prepared, completed_run, body)
        }
        GenerateAiActionKind::Summary => {
            finish_summary_generation(service, prepared, completed_run, body)
        }
    }
}

fn finish_testware_generation(
    service: &SessionService,
    request: &GenerateAiActionRequest,
    prepared: PreparedGeneration,
    completed_run: qa_scribe_core::domain::AiRun,
    body: String,
) -> qa_scribe_core::Result<GenerateAiActionResult> {
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
        metadata_json: testware_metadata_json(request.testware_preferences.as_ref()),
    })?;
    Ok(GenerateAiActionResult {
        generation_context: prepared.generation_context,
        ai_run: completed_run,
        draft: Some(draft),
        finding: None,
        note_entry: None,
    })
}

fn finish_finding_generation(
    service: &SessionService,
    prepared: PreparedGeneration,
    completed_run: qa_scribe_core::domain::AiRun,
    body: String,
) -> qa_scribe_core::Result<GenerateAiActionResult> {
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

fn finish_summary_generation(
    service: &SessionService,
    prepared: PreparedGeneration,
    completed_run: qa_scribe_core::domain::AiRun,
    body: String,
) -> qa_scribe_core::Result<GenerateAiActionResult> {
    let Some(note_entry_id) = prepared.selected_note_id.as_deref() else {
        let failed_run = service.fail_ai_run(
            &completed_run.id,
            "Summarize notes requires an editable note entry.",
        )?;
        return Ok(failed_generation_result(prepared, failed_run));
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

fn failed_generation_result(
    prepared: PreparedGeneration,
    ai_run: qa_scribe_core::domain::AiRun,
) -> GenerateAiActionResult {
    GenerateAiActionResult {
        generation_context: prepared.generation_context,
        ai_run,
        draft: None,
        finding: None,
        note_entry: None,
    }
}

fn create_generated_finding_evidence_links(
    service: &SessionService,
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
