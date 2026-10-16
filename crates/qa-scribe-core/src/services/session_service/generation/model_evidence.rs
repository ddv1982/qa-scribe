use super::{
    AiRun, AiRunCreate, QaScribeError, SessionService, new_id, now, require_row_in_session,
    require_session, validate_optional_text, validate_required_text,
};
use crate::{
    Result,
    domain::{AiRunStatus, ReportedModel, RunModelSelection},
    error::validation,
};
use rusqlite::params;

impl SessionService {
    pub fn create_ai_run(&self, draft: AiRunCreate) -> Result<AiRun> {
        require_session(self.database.connection(), &draft.session_id)?;
        if let Some(context_id) = &draft.generation_context_id {
            require_row_in_session(
                self.database.connection(),
                "generation_contexts",
                context_id,
                &draft.session_id,
                "AI Run Generation Context must belong to the Session",
            )?;
        }
        let requested = crate::domain::RequestedModel::from_request(draft.provider, &draft.model)?;
        let model = if draft.model.trim().is_empty() {
            "default"
        } else {
            draft.model.trim()
        };
        let model_selection = serde_json::to_string(&crate::domain::RunModelSelection::Recorded {
            requested,
            reported: None,
        })
        .map_err(|_| validation("AI model selection could not serialize"))?;
        let prompt_version = validate_required_text("prompt version", &draft.prompt_version, 80)?;
        let reasoning_effort =
            validate_optional_text("reasoning effort", draft.reasoning_effort, 40)?;
        let id = new_id();
        let now = now();

        self.database.connection().execute(
            "INSERT INTO ai_runs (
                id, session_id, generation_context_id, provider, model, reasoning_effort,
                prompt_version, status, error_message, created_at, completed_at, model_selection_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running', NULL, ?8, NULL, ?9)",
            params![
                id,
                draft.session_id,
                draft.generation_context_id,
                draft.provider.as_str(),
                model,
                reasoning_effort,
                prompt_version,
                now,
                model_selection
            ],
        )?;

        self.ai_run(&id)?.ok_or(QaScribeError::NotFound(id))
    }

    pub fn record_running_ai_run_model_report(
        &self,
        id: &str,
        report: Option<&ReportedModel>,
    ) -> Result<()> {
        let Some(report) = report else {
            return Ok(());
        };
        let run = self
            .get_ai_run(id)?
            .ok_or_else(|| crate::QaScribeError::NotFound(id.into()))?;
        if run.status != AiRunStatus::Running {
            return Err(validation("AI Run is not running"));
        }
        if !report.valid_for(run.provider) {
            return Err(validation("AI model report is invalid for this provider"));
        }
        let RunModelSelection::Recorded {
            requested,
            reported,
        } = run.model_selection
        else {
            return Err(validation("Legacy AI Run cannot accept model evidence"));
        };
        if reported.as_ref() == Some(report) {
            return Ok(());
        }
        if reported.is_some() {
            return Err(validation("AI Run model report is already recorded"));
        }
        let json = serde_json::to_string(&RunModelSelection::Recorded {
            requested,
            reported: Some(report.clone()),
        })
        .map_err(|_| validation("AI model report could not serialize"))?;
        let changed = self.database.connection().execute(
            "UPDATE ai_runs SET model_selection_json = ?1 WHERE id = ?2 AND status = 'running'",
            params![json, id],
        )?;
        if changed != 1 {
            return Err(validation("AI Run is not running"));
        }
        Ok(())
    }
}
