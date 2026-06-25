use qa_scribe_core::{
    domain::{AiRunCreate, DraftCreate, DraftKind, Entry, Finding},
    generation::{
        SESSION_REPORT_PROMPT_VERSION, parse_session_report_response,
        preserve_managed_attachment_images, render_session_report_prompt,
    },
};
use tauri::State;

use super::{
    provider_execution::execute_provider_generation,
    types::{GenerateSessionReportRequest, GenerateSessionReportResult, PreparedGeneration},
};
use crate::settings::AppState;

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
