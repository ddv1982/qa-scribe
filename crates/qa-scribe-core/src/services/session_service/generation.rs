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
        let changed = self.database.connection().execute(
            "UPDATE ai_runs
             SET status = 'completed', error_message = NULL, completed_at = ?1
             WHERE id = ?2 AND status = 'running'",
            params![now, id],
        )?;
        if changed == 0 {
            return Err(self.ai_run_transition_error(id)?);
        }
        self.ai_run(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))
    }

    pub fn fail_ai_run(&self, id: &str, message: &str) -> Result<AiRun> {
        let now = now();
        let error_message = normalize_ai_run_error_message(message);
        let changed = self.database.connection().execute(
            "UPDATE ai_runs
             SET status = 'failed', error_message = ?1, completed_at = ?2
             WHERE id = ?3 AND status = 'running'",
            params![error_message, now, id],
        )?;
        if changed == 0 {
            return Err(self.ai_run_transition_error(id)?);
        }
        self.ai_run(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))
    }

    /// Marks every AI Run still `running` as `failed`. Runs are only ever left
    /// `running` when the app is interrupted mid-generation (e.g. a crash), so
    /// this is meant to be called once at startup to recover from that state;
    /// it is safe to call repeatedly since it only touches `running` rows.
    pub fn fail_orphaned_running_ai_runs(&self) -> Result<usize> {
        let now = now();
        let changed = self.database.connection().execute(
            "UPDATE ai_runs
             SET status = 'failed', error_message = ?1, completed_at = ?2
             WHERE status = 'running'",
            params![ORPHANED_AI_RUN_ERROR_MESSAGE, now],
        )?;
        Ok(changed)
    }

    pub fn get_ai_run(&self, id: &str) -> Result<Option<AiRun>> {
        self.ai_run(id)
    }

    /// Builds the error to return when a `running`-guarded UPDATE affects no
    /// rows: distinguishes "the AI Run does not exist" (NotFound) from "the
    /// AI Run exists but is not running" (Validation), matching how the rest
    /// of the service reports failed state transitions.
    fn ai_run_transition_error(&self, id: &str) -> Result<QaScribeError> {
        match self.ai_run(id)? {
            Some(_) => Ok(validation("AI Run is not running")),
            None => Ok(QaScribeError::NotFound(id.to_string())),
        }
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

/// Maximum length (in bytes, on a char boundary) for a stored AI Run error message.
const AI_RUN_ERROR_MESSAGE_MAX_LEN: usize = 2_000;

/// Placeholder used when a provider reports a failure without a usable message.
const AI_RUN_ERROR_MESSAGE_PLACEHOLDER: &str = "Provider reported no error detail.";

/// Error message stored for AI Runs recovered by `fail_orphaned_running_ai_runs`.
const ORPHANED_AI_RUN_ERROR_MESSAGE: &str = "Interrupted: application closed during generation.";

/// Normalizes a provider-supplied failure message for storage. Unlike
/// `validate_required_text`, this never rejects input: recording a failure
/// must always succeed, even when the underlying provider error is blank or
/// an oversized stack trace/JSON dump, so the real failure is not masked by a
/// secondary validation error.
fn normalize_ai_run_error_message(message: &str) -> String {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return AI_RUN_ERROR_MESSAGE_PLACEHOLDER.to_string();
    }
    truncate_at_char_boundary(trimmed, AI_RUN_ERROR_MESSAGE_MAX_LEN)
}

fn truncate_at_char_boundary(value: &str, max_len: usize) -> String {
    if value.len() <= max_len {
        return value.to_string();
    }
    let mut end = max_len;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_ai_run_error_message_trims_whitespace() {
        assert_eq!(
            normalize_ai_run_error_message("  provider timed out  \n"),
            "provider timed out"
        );
    }

    #[test]
    fn normalize_ai_run_error_message_substitutes_placeholder_for_blank_input() {
        assert_eq!(
            normalize_ai_run_error_message("   \n\t "),
            AI_RUN_ERROR_MESSAGE_PLACEHOLDER
        );
        assert_eq!(
            normalize_ai_run_error_message(""),
            AI_RUN_ERROR_MESSAGE_PLACEHOLDER
        );
    }

    #[test]
    fn normalize_ai_run_error_message_truncates_to_the_limit() {
        let huge = "x".repeat(10_000);
        let normalized = normalize_ai_run_error_message(&huge);
        assert_eq!(normalized.len(), AI_RUN_ERROR_MESSAGE_MAX_LEN);
        assert_eq!(normalized, "x".repeat(AI_RUN_ERROR_MESSAGE_MAX_LEN));
    }

    #[test]
    fn normalize_ai_run_error_message_truncates_on_a_char_boundary() {
        // Each 'é' is 2 bytes in UTF-8, so a naive byte-index truncation at an
        // odd offset would split a character and panic.
        let message = "é".repeat(1_500); // 3_000 bytes
        let normalized = normalize_ai_run_error_message(&message);
        assert!(normalized.len() <= AI_RUN_ERROR_MESSAGE_MAX_LEN);
        assert!(normalized.chars().all(|character| character == 'é'));
    }
}
