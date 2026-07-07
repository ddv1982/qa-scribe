use rusqlite::{Connection, OptionalExtension, params};

use crate::{
    QaScribeError, Result,
    domain::{
        SESSION_BUILD_VERSION_MAX_LENGTH, SESSION_ENVIRONMENT_MAX_LENGTH, SESSION_NOTES_MAX_LENGTH,
        SESSION_RELATED_REFERENCE_MAX_LENGTH, Session, SessionDraft, SessionNoteState,
        SessionPatch, TITLE_MAX_LENGTH, validate_optional_text, validate_required_text,
    },
};

use super::super::session_rows::map_session;
use super::{SessionService, new_id, now};

impl SessionService {
    pub fn create_session(&self, draft: SessionDraft) -> Result<Session> {
        let id = new_id();
        let now = now();
        let title = validate_required_text("Session title", &draft.title, TITLE_MAX_LENGTH)?;
        let session_context = validate_optional_text(
            "Session Context",
            draft.session_context,
            SESSION_NOTES_MAX_LENGTH,
        )?;
        let objective_notes = validate_optional_text(
            "Objective Notes",
            draft.objective_notes,
            SESSION_NOTES_MAX_LENGTH,
        )?;
        let environment = validate_optional_text(
            "environment",
            draft.environment,
            SESSION_ENVIRONMENT_MAX_LENGTH,
        )?;
        let build_version = validate_optional_text(
            "build/version",
            draft.build_version,
            SESSION_BUILD_VERSION_MAX_LENGTH,
        )?;
        let related_reference = validate_optional_text(
            "related reference",
            draft.related_reference,
            SESSION_RELATED_REFERENCE_MAX_LENGTH,
        )?;

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

    pub fn list_recent_sessions(&self, limit: u32) -> Result<Vec<Session>> {
        if limit == 0 {
            return Ok(Vec::new());
        }

        let mut statement = self.database.connection().prepare(
            "SELECT id, title, session_context, objective_notes, environment, build_version,
                related_reference, created_at, updated_at, last_opened_at
             FROM sessions
             ORDER BY last_opened_at DESC, updated_at DESC, id ASC
             LIMIT ?1",
        )?;
        let sessions = statement
            .query_map([i64::from(limit)], map_session)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(sessions)
    }

    pub fn get_session(&self, id: &str) -> Result<Option<Session>> {
        session(self.database.connection(), id)
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

    pub fn open_session_note_state(&self, id: &str) -> Result<SessionNoteState> {
        let session = self.reopen_session(id)?;
        let note_entry = self.get_or_create_note_entry(&session.id)?;
        Ok(SessionNoteState {
            testware_draft_count: count_testware_drafts(self.database.connection(), &session.id)?,
            finding_count: count_findings(self.database.connection(), &session.id)?,
            session,
            note_entry,
        })
    }

    pub fn update_session(&self, id: &str, patch: SessionPatch) -> Result<Session> {
        let now = now();

        self.database.with_immediate_tx(|tx| {
            let previous =
                session(tx, id)?.ok_or_else(|| QaScribeError::NotFound(id.to_string()))?;
            let title = match patch.title {
                Some(title) => validate_required_text("Session title", &title, TITLE_MAX_LENGTH)?,
                None => previous.title,
            };
            let session_context = validate_optional_text(
                "Session Context",
                patch.session_context.unwrap_or(previous.session_context),
                SESSION_NOTES_MAX_LENGTH,
            )?;
            let objective_notes = validate_optional_text(
                "Objective Notes",
                patch.objective_notes.unwrap_or(previous.objective_notes),
                SESSION_NOTES_MAX_LENGTH,
            )?;
            let environment = validate_optional_text(
                "environment",
                patch.environment.unwrap_or(previous.environment),
                SESSION_ENVIRONMENT_MAX_LENGTH,
            )?;
            let build_version = validate_optional_text(
                "build/version",
                patch.build_version.unwrap_or(previous.build_version),
                SESSION_BUILD_VERSION_MAX_LENGTH,
            )?;
            let related_reference = validate_optional_text(
                "related reference",
                patch
                    .related_reference
                    .unwrap_or(previous.related_reference),
                SESSION_RELATED_REFERENCE_MAX_LENGTH,
            )?;

            tx.execute(
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
                    session_context,
                    objective_notes,
                    environment,
                    build_version,
                    related_reference,
                    now,
                    id
                ],
            )?;

            session(tx, id)?.ok_or_else(|| QaScribeError::NotFound(id.to_string()))
        })
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

fn session(connection: &Connection, id: &str) -> Result<Option<Session>> {
    connection
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

fn count_testware_drafts(connection: &Connection, session_id: &str) -> Result<i64> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM drafts WHERE session_id = ?1 AND kind = 'testware'",
            [session_id],
            |row| row.get(0),
        )
        .map_err(Into::into)
}

fn count_findings(connection: &Connection, session_id: &str) -> Result<i64> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM findings WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .map_err(Into::into)
}
