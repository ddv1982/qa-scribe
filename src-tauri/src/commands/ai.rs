use std::process::Command;

use qa_scribe_core::{
    ai::generation_command,
    domain::{AiProvider, AiRun, AiRunCreate, Draft, DraftCreate, DraftKind, GenerationContext},
    generation::{
        SESSION_REPORT_PROMPT_VERSION, parse_session_report_response, render_session_report_prompt,
    },
};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::settings::AppState;

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

struct PreparedGeneration {
    session_id: String,
    session_title: String,
    generation_context: GenerationContext,
    ai_run: AiRun,
    prompt: String,
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

    let (program, args) = generation_command(request.provider, &prepared.prompt);
    let output = Command::new(program).args(args).output();

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
            let stderr = String::from_utf8_lossy(&output.stderr);
            let message = if stderr.trim().is_empty() {
                "provider command failed"
            } else {
                stderr.trim()
            };
            let failed_run = service.fail_ai_run(&prepared.ai_run.id, message)?;
            Ok(GenerateSessionReportResult {
                generation_context: prepared.generation_context,
                ai_run: failed_run,
                draft: None,
            })
        }
        Err(error) => {
            let failed_run = service.fail_ai_run(&prepared.ai_run.id, &error.to_string())?;
            Ok(GenerateSessionReportResult {
                generation_context: prepared.generation_context,
                ai_run: failed_run,
                draft: None,
            })
        }
    })
}
