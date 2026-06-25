use rusqlite::{OptionalExtension, params};

use crate::{
    QaScribeError, Result,
    domain::{
        AiRun, AiRunCreate, GenerationContext, validate_optional_text, validate_required_text,
    },
    error::validation,
};

use super::super::session_rows::map_ai_run;
use super::{SessionService, new_id, now, require_session};

impl SessionService {
    pub fn create_generation_context(&self, session_id: &str) -> Result<GenerationContext> {
        require_session(self.database.connection(), session_id)?;
        let context_id = new_id();
        let now = now();
        self.database
            .connection()
            .execute_batch("BEGIN IMMEDIATE;")?;
        let create_result = (|| {
            self.database.connection().execute(
                "INSERT INTO generation_contexts (id, session_id, created_at) VALUES (?1, ?2, ?3)",
                params![context_id, session_id, now],
            )?;

            let mut statement = self.database.connection().prepare(
                "SELECT id FROM entries
                     WHERE session_id = ?1 AND excluded_from_generation = 0
                     ORDER BY created_at ASC",
            )?;
            let entry_ids = statement
                .query_map([session_id], |row| row.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            drop(statement);
            for entry_id in entry_ids {
                self.database.connection().execute(
                    "INSERT INTO generation_context_entries (id, generation_context_id, entry_id, included)
                     VALUES (?1, ?2, ?3, 1)",
                    params![new_id(), context_id, entry_id],
                )?;
            }

            let mut statement = self.database.connection().prepare(
                "SELECT id FROM attachments WHERE session_id = ?1 ORDER BY created_at ASC",
            )?;
            let attachment_ids = statement
                .query_map([session_id], |row| row.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            drop(statement);
            for attachment_id in attachment_ids {
                self.database.connection().execute(
                    "INSERT INTO generation_context_attachments (id, generation_context_id, attachment_id, included)
                     VALUES (?1, ?2, ?3, 1)",
                    params![new_id(), context_id, attachment_id],
                )?;
            }
            Ok(())
        })();

        match create_result {
            Ok(()) => self.database.connection().execute_batch("COMMIT;")?,
            Err(error) => {
                let _ = self.database.connection().execute_batch("ROLLBACK;");
                return Err(error);
            }
        }

        Ok(GenerationContext {
            id: context_id,
            session_id: session_id.to_string(),
            created_at: now,
        })
    }

    pub fn create_ai_run(&self, draft: AiRunCreate) -> Result<AiRun> {
        require_session(self.database.connection(), &draft.session_id)?;
        if let Some(context_id) = &draft.generation_context_id {
            let context_session_id: String = self.database.connection().query_row(
                "SELECT session_id FROM generation_contexts WHERE id = ?1",
                [context_id],
                |row| row.get(0),
            )?;
            if context_session_id != draft.session_id {
                return Err(validation(
                    "AI Run Generation Context must belong to the Session",
                ));
            }
        }
        let model = validate_required_text("AI model", &draft.model, 240)?;
        let prompt_version = validate_required_text("prompt version", &draft.prompt_version, 80)?;
        let reasoning_effort =
            validate_optional_text("reasoning effort", draft.reasoning_effort, 40)?;
        let id = new_id();
        let now = now();

        self.database.connection().execute(
            "INSERT INTO ai_runs (
                id, session_id, generation_context_id, provider, model, reasoning_effort,
                prompt_version, status, error_message, created_at, completed_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running', NULL, ?8, NULL)",
            params![
                id,
                draft.session_id,
                draft.generation_context_id,
                draft.provider.as_str(),
                model,
                reasoning_effort,
                prompt_version,
                now
            ],
        )?;

        self.ai_run(&id)?.ok_or(QaScribeError::NotFound(id))
    }

    pub fn complete_ai_run(&self, id: &str) -> Result<AiRun> {
        let now = now();
        self.database.connection().execute(
            "UPDATE ai_runs
             SET status = 'completed', error_message = NULL, completed_at = ?1
             WHERE id = ?2",
            params![now, id],
        )?;
        self.ai_run(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))
    }

    pub fn fail_ai_run(&self, id: &str, message: &str) -> Result<AiRun> {
        let now = now();
        let error_message = validate_required_text("AI Run error", message, 2_000)?;
        self.database.connection().execute(
            "UPDATE ai_runs
             SET status = 'failed', error_message = ?1, completed_at = ?2
             WHERE id = ?3",
            params![error_message, now, id],
        )?;
        self.ai_run(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))
    }

    fn ai_run(&self, id: &str) -> Result<Option<AiRun>> {
        self.database
            .connection()
            .query_row(
                "SELECT id, session_id, generation_context_id, provider, model, reasoning_effort,
                    prompt_version, status, error_message, created_at, completed_at
                 FROM ai_runs
                 WHERE id = ?1",
                [id],
                map_ai_run,
            )
            .optional()
            .map_err(Into::into)
    }
}
