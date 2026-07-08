use rusqlite::{Connection, OptionalExtension, Transaction, params};
use std::time::Instant;

use crate::{
    QaScribeError, Result,
    domain::{
        AiRun, AiRunCreate, BODY_FORMAT_MAX_LENGTH, DRAFT_BODY_MAX_LENGTH, Draft, DraftCreate,
        Entry, EntryPatch, Finding, FindingDraft, GenerationContext, TEXT_BODY_MAX_LENGTH,
        TITLE_MAX_LENGTH, validate_body_json, validate_body_text, validate_metadata_json,
        validate_optional_text, validate_required_text,
    },
    error::validation,
};

use super::super::session_rows::{map_ai_run, map_draft, map_entry, map_finding};
use super::{SessionService, new_id, now, require_row_in_session, require_session};

impl SessionService {
    pub fn create_generation_context(&self, session_id: &str) -> Result<GenerationContext> {
        require_session(self.database.connection(), session_id)?;
        let context_id = new_id();
        let now = now();

        self.database.with_immediate_tx(|tx| {
            tx.execute(
                "INSERT INTO generation_contexts (id, session_id, created_at) VALUES (?1, ?2, ?3)",
                params![context_id, session_id, now],
            )?;

            let mut statement = tx.prepare(
                "SELECT id FROM entries
                     WHERE session_id = ?1 AND excluded_from_generation = 0
                     ORDER BY created_at ASC",
            )?;
            let entry_ids = statement
                .query_map([session_id], |row| row.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            drop(statement);
            for entry_id in entry_ids {
                tx.execute(
                    "INSERT INTO generation_context_entries (id, generation_context_id, entry_id, included)
                     VALUES (?1, ?2, ?3, 1)",
                    params![new_id(), context_id, entry_id],
                )?;
            }

            let mut statement = tx.prepare(
                "SELECT id FROM attachments WHERE session_id = ?1 ORDER BY created_at ASC",
            )?;
            let attachment_ids = statement
                .query_map([session_id], |row| row.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            drop(statement);
            for attachment_id in attachment_ids {
                tx.execute(
                    "INSERT INTO generation_context_attachments (id, generation_context_id, attachment_id, included)
                     VALUES (?1, ?2, ?3, 1)",
                    params![new_id(), context_id, attachment_id],
                )?;
            }
            Ok(())
        })?;

        Ok(GenerationContext {
            id: context_id,
            session_id: session_id.to_string(),
            created_at: now,
        })
    }

    pub fn create_generation_context_from_material(
        &self,
        session_id: &str,
        entry_ids: &[String],
        attachment_ids: &[String],
    ) -> Result<GenerationContext> {
        require_session(self.database.connection(), session_id)?;
        for entry_id in entry_ids {
            require_row_in_session(
                self.database.connection(),
                "entries",
                entry_id,
                session_id,
                "Generation Context Entry must belong to the Session",
            )?;
        }
        for attachment_id in attachment_ids {
            require_row_in_session(
                self.database.connection(),
                "attachments",
                attachment_id,
                session_id,
                "Generation Context Attachment must belong to the Session",
            )?;
        }

        let context_id = new_id();
        let now = now();
        self.database.with_immediate_tx(|tx| {
            tx.execute(
                "INSERT INTO generation_contexts (id, session_id, created_at) VALUES (?1, ?2, ?3)",
                params![context_id, session_id, now],
            )?;
            for entry_id in entry_ids {
                tx.execute(
                    "INSERT INTO generation_context_entries (id, generation_context_id, entry_id, included)
                     VALUES (?1, ?2, ?3, 1)",
                    params![new_id(), context_id, entry_id],
                )?;
            }
            for attachment_id in attachment_ids {
                tx.execute(
                    "INSERT INTO generation_context_attachments (id, generation_context_id, attachment_id, included)
                     VALUES (?1, ?2, ?3, 1)",
                    params![new_id(), context_id, attachment_id],
                )?;
            }
            Ok(())
        })?;

        Ok(GenerationContext {
            id: context_id,
            session_id: session_id.to_string(),
            created_at: now,
        })
    }

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

    pub fn complete_ai_run_with_generated_draft(
        &self,
        ai_run_id: &str,
        draft: DraftCreate,
    ) -> Result<(AiRun, Draft)> {
        let now = now();
        self.database.with_immediate_tx(|tx| {
            require_session(tx, &draft.session_id)?;
            require_row_in_session(
                tx,
                "ai_runs",
                ai_run_id,
                &draft.session_id,
                "Draft AI Run must belong to the Session",
            )?;

            let draft_id = new_id();
            let title = validate_required_text("Draft title", &draft.title, TITLE_MAX_LENGTH)?;
            let body = validate_body_text("Draft body", &draft.body, DRAFT_BODY_MAX_LENGTH)?;
            let body_json = validate_body_json(draft.body_json)?;
            let body_format = validate_optional_text(
                "Draft body format",
                draft.body_format,
                BODY_FORMAT_MAX_LENGTH,
            )?;
            let metadata_json = validate_metadata_json(draft.metadata_json)?;

            tx.execute(
                "INSERT INTO drafts (id, session_id, ai_run_id, kind, title, body, body_json, body_format, metadata_json, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, COALESCE(?8, 'html'), ?9, ?10, ?10)",
                params![
                    draft_id,
                    draft.session_id,
                    ai_run_id,
                    draft.kind.as_str(),
                    title,
                    body,
                    body_json,
                    body_format,
                    metadata_json,
                    now,
                ],
            )?;

            let ai_run = complete_running_ai_run_tx(tx, ai_run_id, &now)?;
            let draft = draft_by_id(tx, &draft_id)?.ok_or(QaScribeError::NotFound(draft_id))?;
            Ok((ai_run, draft))
        })
    }

    pub fn complete_ai_run_with_generated_finding(
        &self,
        ai_run_id: &str,
        draft: FindingDraft,
        selected_note_id: Option<&str>,
        attachment_ids: &[String],
    ) -> Result<(AiRun, Finding)> {
        let now = now();
        self.database.with_immediate_tx(|tx| {
            require_session(tx, &draft.session_id)?;
            require_row_in_session(
                tx,
                "ai_runs",
                ai_run_id,
                &draft.session_id,
                "Finding AI Run must belong to the Session",
            )?;
            if let Some(entry_id) = selected_note_id {
                require_row_in_session(
                    tx,
                    "entries",
                    entry_id,
                    &draft.session_id,
                    "Generated Finding evidence Entry must belong to the Session",
                )?;
            }
            for attachment_id in attachment_ids {
                require_row_in_session(
                    tx,
                    "attachments",
                    attachment_id,
                    &draft.session_id,
                    "Generated Finding evidence attachment must belong to the Session",
                )?;
            }

            let finding_id = new_id();
            let title = validate_required_text("Finding title", &draft.title, TITLE_MAX_LENGTH)?;
            let body = validate_body_text("Finding body", &draft.body, TEXT_BODY_MAX_LENGTH)?;
            let body_json = validate_body_json(draft.body_json)?;
            let body_format = validate_optional_text(
                "Finding body format",
                draft.body_format,
                BODY_FORMAT_MAX_LENGTH,
            )?;
            let metadata_json = validate_metadata_json(draft.metadata_json)?;

            tx.execute(
                "INSERT INTO findings (id, session_id, title, body, body_json, body_format, kind, metadata_json, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(?6, 'html'), ?7, ?8, ?9, ?9)",
                params![
                    finding_id,
                    draft.session_id,
                    title,
                    body,
                    body_json,
                    body_format,
                    draft.kind.as_str(),
                    metadata_json,
                    now,
                ],
            )?;

            if let Some(entry_id) = selected_note_id {
                tx.execute(
                    "INSERT INTO evidence_links (id, finding_id, entry_id, attachment_id, created_at)
                     VALUES (?1, ?2, ?3, NULL, ?4)",
                    params![new_id(), finding_id, entry_id, now],
                )?;
            }
            for attachment_id in attachment_ids {
                tx.execute(
                    "INSERT INTO evidence_links (id, finding_id, entry_id, attachment_id, created_at)
                     VALUES (?1, ?2, NULL, ?3, ?4)",
                    params![new_id(), finding_id, attachment_id, now],
                )?;
            }

            let ai_run = complete_running_ai_run_tx(tx, ai_run_id, &now)?;
            let finding = finding_by_id(tx, &finding_id)?.ok_or(QaScribeError::NotFound(finding_id))?;
            Ok((ai_run, finding))
        })
    }

    pub fn complete_ai_run_with_generated_note_update(
        &self,
        ai_run_id: &str,
        entry_id: &str,
        expected_body: &str,
        patch: EntryPatch,
    ) -> Result<(AiRun, Entry)> {
        let now = now();
        self.database.with_immediate_tx(|tx| {
            let existing = entry_by_id(tx, entry_id)?
                .ok_or_else(|| QaScribeError::NotFound(entry_id.to_string()))?;
            require_row_in_session(
                tx,
                "ai_runs",
                ai_run_id,
                &existing.session_id,
                "Summary AI Run must belong to the Session",
            )?;
            if existing.body != expected_body {
                return Err(QaScribeError::Validation(
                    "Selected Note changed while generation was running. Review the latest Note and run the summary again."
                        .to_string(),
                ));
            }

            let title = match patch.title {
                Some(title) => validate_optional_text("Entry title", title, TITLE_MAX_LENGTH)?,
                None => existing.title,
            };
            let body = match patch.body {
                Some(body) => validate_body_text("Entry body", &body, TEXT_BODY_MAX_LENGTH)?,
                None => existing.body,
            };
            let body_json = match patch.body_json {
                Some(body_json) => validate_body_json(body_json)?,
                None => existing.body_json,
            };
            let body_format = match patch.body_format {
                Some(body_format) => validate_optional_text(
                    "Entry body format",
                    body_format,
                    BODY_FORMAT_MAX_LENGTH,
                )?,
                None => existing.body_format,
            };
            let metadata_json = match patch.metadata_json {
                Some(metadata_json) => validate_metadata_json(metadata_json)?,
                None => existing.metadata_json,
            };
            let excluded = patch
                .excluded_from_generation
                .unwrap_or(existing.excluded_from_generation);

            tx.execute(
                "UPDATE entries
                 SET title = ?1, body = ?2, body_json = ?3, body_format = COALESCE(?4, 'html'), metadata_json = ?5, excluded_from_generation = ?6, updated_at = ?7
                 WHERE id = ?8",
                params![title, body, body_json, body_format, metadata_json, excluded, now, entry_id],
            )?;

            let ai_run = complete_running_ai_run_tx(tx, ai_run_id, &now)?;
            let entry = entry_by_id(tx, entry_id)?
                .ok_or_else(|| QaScribeError::NotFound(entry_id.to_string()))?;
            Ok((ai_run, entry))
        })
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
        let started = Instant::now();
        let now = now();
        let changed = self.database.connection().execute(
            "UPDATE ai_runs
             SET status = 'failed', error_message = ?1, completed_at = ?2
             WHERE status = 'running'",
            params![ORPHANED_AI_RUN_ERROR_MESSAGE, now],
        )?;
        eprintln!(
            "qa-scribe startup orphan AI Run sweep complete: rows_changed={}, elapsed_ms={}",
            changed,
            started.elapsed().as_millis()
        );
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
        ai_run_transition_error_on(self.database.connection(), id)
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

fn complete_running_ai_run_tx(tx: &Transaction<'_>, id: &str, now: &str) -> Result<AiRun> {
    let changed = tx.execute(
        "UPDATE ai_runs
         SET status = 'completed', error_message = NULL, completed_at = ?1
         WHERE id = ?2 AND status = 'running'",
        params![now, id],
    )?;
    if changed == 0 {
        return Err(ai_run_transition_error_on(tx, id)?);
    }
    ai_run_by_id(tx, id)?.ok_or_else(|| QaScribeError::NotFound(id.to_string()))
}

fn ai_run_transition_error_on(connection: &Connection, id: &str) -> Result<QaScribeError> {
    match ai_run_by_id(connection, id)? {
        Some(_) => Ok(validation("AI Run is not running")),
        None => Ok(QaScribeError::NotFound(id.to_string())),
    }
}

fn ai_run_by_id(connection: &Connection, id: &str) -> Result<Option<AiRun>> {
    connection
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

fn draft_by_id(connection: &Connection, id: &str) -> Result<Option<Draft>> {
    connection
        .query_row(
            "SELECT id, session_id, ai_run_id, kind, title, body, body_json, body_format, metadata_json, created_at, updated_at
             FROM drafts
             WHERE id = ?1",
            [id],
            map_draft,
        )
        .optional()
        .map_err(Into::into)
}

fn finding_by_id(connection: &Connection, id: &str) -> Result<Option<Finding>> {
    connection
        .query_row(
            "SELECT id, session_id, title, body, body_json, body_format, kind, metadata_json, created_at, updated_at
             FROM findings
             WHERE id = ?1",
            [id],
            map_finding,
        )
        .optional()
        .map_err(Into::into)
}

fn entry_by_id(connection: &Connection, id: &str) -> Result<Option<Entry>> {
    connection
        .query_row(
            "SELECT id, session_id, type, title, body, body_json, body_format, metadata_json, excluded_from_generation, created_at, updated_at
             FROM entries
             WHERE id = ?1",
            [id],
            map_entry,
        )
        .optional()
        .map_err(Into::into)
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
