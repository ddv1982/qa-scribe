use rusqlite::{OptionalExtension, params};

use crate::{
    QaScribeError, Result,
    domain::{
        DRAFT_BODY_MAX_LENGTH, Draft, DraftCreate, DraftPatch, validate_body_json,
        validate_body_text, validate_metadata_json, validate_optional_text, validate_required_text,
    },
    error::validation,
};

use super::super::session_rows::map_draft;
use super::{SessionService, new_id, now, require_session};

impl SessionService {
    pub fn create_draft(&self, draft: DraftCreate) -> Result<Draft> {
        require_session(self.database.connection(), &draft.session_id)?;
        if let Some(ai_run_id) = &draft.ai_run_id {
            let ai_run_session_id: String = self.database.connection().query_row(
                "SELECT session_id FROM ai_runs WHERE id = ?1",
                [ai_run_id],
                |row| row.get(0),
            )?;
            if ai_run_session_id != draft.session_id {
                return Err(validation("Draft AI Run must belong to the Session"));
            }
        }
        let id = new_id();
        let now = now();
        let title = validate_required_text("Draft title", &draft.title, 160)?;
        let body = validate_body_text("Draft body", &draft.body, DRAFT_BODY_MAX_LENGTH)?;
        let body_json = validate_body_json(draft.body_json)?;
        let body_format = validate_optional_text("Draft body format", draft.body_format, 40)?;
        let metadata_json = validate_metadata_json(draft.metadata_json)?;

        self.database.connection().execute(
            "INSERT INTO drafts (id, session_id, ai_run_id, kind, title, body, body_json, body_format, metadata_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, COALESCE(?8, 'html'), ?9, ?10, ?10)",
            params![id, draft.session_id, draft.ai_run_id, draft.kind.as_str(), title, body, body_json, body_format, metadata_json, now],
        )?;

        self.draft(&id)?.ok_or(QaScribeError::NotFound(id))
    }

    pub fn list_drafts(&self, session_id: &str) -> Result<Vec<Draft>> {
        require_session(self.database.connection(), session_id)?;
        let mut statement = self.database.connection().prepare(
            "SELECT id, session_id, ai_run_id, kind, title, body, body_json, body_format, metadata_json, created_at, updated_at
             FROM drafts
             WHERE session_id = ?1
             ORDER BY updated_at DESC, created_at DESC",
        )?;
        let drafts = statement
            .query_map([session_id], map_draft)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(drafts)
    }

    pub fn update_draft(&self, id: &str, patch: DraftPatch) -> Result<Draft> {
        let existing = self
            .draft(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))?;
        let title = match patch.title {
            Some(title) => validate_required_text("Draft title", &title, 160)?,
            None => existing.title,
        };
        let body = match patch.body {
            Some(body) => validate_body_text("Draft body", &body, DRAFT_BODY_MAX_LENGTH)?,
            None => existing.body,
        };
        let body_json = match patch.body_json {
            Some(body_json) => validate_body_json(body_json)?,
            None => existing.body_json,
        };
        let body_format = match patch.body_format {
            Some(body_format) => validate_optional_text("Draft body format", body_format, 40)?,
            None => existing.body_format,
        };
        let metadata_json = match patch.metadata_json {
            Some(metadata_json) => validate_metadata_json(metadata_json)?,
            None => existing.metadata_json,
        };
        let now = now();

        self.database.connection().execute(
            "UPDATE drafts
             SET title = ?1, body = ?2, body_json = ?3, body_format = COALESCE(?4, 'html'), metadata_json = ?5, updated_at = ?6
             WHERE id = ?7",
            params![title, body, body_json, body_format, metadata_json, now, id],
        )?;

        self.draft(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))
    }

    pub fn delete_draft(&self, id: &str) -> Result<()> {
        let changed = self
            .database
            .connection()
            .execute("DELETE FROM drafts WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(QaScribeError::NotFound(id.to_string()));
        }
        Ok(())
    }

    fn draft(&self, id: &str) -> Result<Option<Draft>> {
        self.database
            .connection()
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
}
