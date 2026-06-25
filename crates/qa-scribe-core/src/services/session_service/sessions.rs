use rusqlite::{OptionalExtension, params};

use crate::{
    QaScribeError, Result,
    domain::{Session, SessionDraft, SessionPatch, validate_optional_text, validate_required_text},
};

use super::super::session_rows::map_session;
use super::{SessionService, new_id, now};

impl SessionService {
    pub fn create_session(&self, draft: SessionDraft) -> Result<Session> {
        let id = new_id();
        let now = now();
        let title = validate_required_text("Session title", &draft.title, 160)?;
        let session_context =
            validate_optional_text("Session Context", draft.session_context, 2_000)?;
        let objective_notes =
            validate_optional_text("Objective Notes", draft.objective_notes, 2_000)?;
        let environment = validate_optional_text("environment", draft.environment, 240)?;
        let build_version = validate_optional_text("build/version", draft.build_version, 120)?;
        let related_reference =
            validate_optional_text("related reference", draft.related_reference, 500)?;

        self.database.connection().execute(
            "INSERT INTO sessions (
                id, title, session_context, objective_notes, environment, build_version,
                related_reference, created_at, updated_at, last_opened_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?8)",
            params![
                id,
                title,
                session_context,
                objective_notes,
                environment,
                build_version,
                related_reference,
                now
            ],
        )?;

        self.get_session(&id)?.ok_or(QaScribeError::NotFound(id))
    }

    pub fn list_sessions(&self) -> Result<Vec<Session>> {
        let mut statement = self.database.connection().prepare(
            "SELECT id, title, session_context, objective_notes, environment, build_version,
                related_reference, created_at, updated_at, last_opened_at
             FROM sessions
             ORDER BY last_opened_at DESC",
        )?;
        let sessions = statement
            .query_map([], map_session)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(sessions)
    }

    pub fn get_session(&self, id: &str) -> Result<Option<Session>> {
        self.database
            .connection()
            .query_row(
                "SELECT id, title, session_context, objective_notes, environment, build_version,
                    related_reference, created_at, updated_at, last_opened_at
                 FROM sessions
                 WHERE id = ?1",
                [id],
                map_session,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn reopen_session(&self, id: &str) -> Result<Session> {
        let now = now();
        let changed = self.database.connection().execute(
            "UPDATE sessions SET last_opened_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        if changed == 0 {
            return Err(QaScribeError::NotFound(id.to_string()));
        }
        self.get_session(id)?
            .ok_or(QaScribeError::NotFound(id.to_string()))
    }

    pub fn update_session(&self, id: &str, patch: SessionPatch) -> Result<Session> {
        let previous = self
            .get_session(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))?;
        let now = now();
        let title = match patch.title {
            Some(title) => validate_required_text("Session title", &title, 160)?,
            None => previous.title,
        };
        let session_context = patch.session_context.unwrap_or(previous.session_context);
        let objective_notes = patch.objective_notes.unwrap_or(previous.objective_notes);
        let environment = patch.environment.unwrap_or(previous.environment);
        let build_version = patch.build_version.unwrap_or(previous.build_version);
        let related_reference = patch
            .related_reference
            .unwrap_or(previous.related_reference);

        self.database.connection().execute(
            "UPDATE sessions SET
                title = ?1,
                session_context = ?2,
                objective_notes = ?3,
                environment = ?4,
                build_version = ?5,
                related_reference = ?6,
                updated_at = ?7
             WHERE id = ?8",
            params![
                title,
                validate_optional_text("Session Context", session_context, 2_000)?,
                validate_optional_text("Objective Notes", objective_notes, 2_000)?,
                validate_optional_text("environment", environment, 240)?,
                validate_optional_text("build/version", build_version, 120)?,
                validate_optional_text("related reference", related_reference, 500)?,
                now,
                id
            ],
        )?;

        self.get_session(id)?
            .ok_or(QaScribeError::NotFound(id.to_string()))
    }

    pub fn delete_session(&self, id: &str) -> Result<()> {
        let changed = self
            .database
            .connection()
            .execute("DELETE FROM sessions WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(QaScribeError::NotFound(id.to_string()));
        }
        Ok(())
    }
}
