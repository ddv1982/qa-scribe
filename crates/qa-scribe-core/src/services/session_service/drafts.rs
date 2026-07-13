use rusqlite::{Connection, OptionalExtension, params};

use crate::{
    QaScribeError, Result,
    domain::{
        BODY_FORMAT_MAX_LENGTH, DRAFT_BODY_MAX_LENGTH, Draft, DraftCreate, DraftLibraryItem,
        DraftPatch, TITLE_MAX_LENGTH, validate_body_json, validate_body_text,
        validate_metadata_json, validate_optional_text, validate_required_text,
    },
};

use super::super::session_rows::map_draft;
use super::{SessionService, new_id, now, require_row_in_session, require_session};

impl SessionService {
    pub fn create_draft(&self, draft: DraftCreate) -> Result<Draft> {
        require_session(self.database.connection(), &draft.session_id)?;
        if let Some(ai_run_id) = &draft.ai_run_id {
            require_row_in_session(
                self.database.connection(),
                "ai_runs",
                ai_run_id,
                &draft.session_id,
                "Draft AI Run must belong to the Session",
            )?;
        }
        let id = new_id();
        let now = now();
        let title = validate_required_text("Draft title", &draft.title, TITLE_MAX_LENGTH)?;
        let body = validate_body_text("Draft body", &draft.body, DRAFT_BODY_MAX_LENGTH)?;
        let body_json = validate_body_json(draft.body_json)?;
        let body_format = validate_optional_text(
            "Draft body format",
            draft.body_format,
            BODY_FORMAT_MAX_LENGTH,
        )?;
        let metadata_json = validate_metadata_json(draft.metadata_json)?;

        self.database.connection().execute(
            "INSERT INTO drafts (id, session_id, ai_run_id, kind, title, body, body_json, body_format, metadata_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, COALESCE(?8, 'html'), ?9, ?10, ?10)",
            params![id, draft.session_id, draft.ai_run_id, draft.kind.as_str(), title, body, body_json, body_format, metadata_json, now],
        )?;

        draft_by_id(self.database.connection(), &id)?.ok_or(QaScribeError::NotFound(id))
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

    pub fn list_draft_library(&self) -> Result<Vec<DraftLibraryItem>> {
        let mut statement = self.database.connection().prepare(
            "SELECT drafts.id, drafts.session_id, drafts.ai_run_id, drafts.kind, drafts.title,
                    drafts.body, drafts.body_json, drafts.body_format, drafts.metadata_json,
                    drafts.created_at, drafts.updated_at, sessions.title
             FROM drafts
             INNER JOIN sessions ON sessions.id = drafts.session_id
             ORDER BY drafts.updated_at DESC, drafts.created_at DESC",
        )?;
        let items = statement
            .query_map([], |row| {
                Ok(DraftLibraryItem {
                    draft: map_draft(row)?,
                    session_title: row.get(11)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(items)
    }

    pub fn update_draft(&self, id: &str, patch: DraftPatch) -> Result<Draft> {
        let now = now();

        self.database.with_immediate_tx(|tx| {
            let existing =
                draft_by_id(tx, id)?.ok_or_else(|| QaScribeError::NotFound(id.to_string()))?;
            let title = match patch.title {
                Some(title) => validate_required_text("Draft title", &title, TITLE_MAX_LENGTH)?,
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
                Some(body_format) => validate_optional_text(
                    "Draft body format",
                    body_format,
                    BODY_FORMAT_MAX_LENGTH,
                )?,
                None => existing.body_format,
            };
            let metadata_json = match patch.metadata_json {
                Some(metadata_json) => validate_metadata_json(metadata_json)?,
                None => existing.metadata_json,
            };

            tx.execute(
                "UPDATE drafts
                 SET title = ?1, body = ?2, body_json = ?3, body_format = COALESCE(?4, 'html'), metadata_json = ?5, updated_at = ?6
                 WHERE id = ?7",
                params![title, body, body_json, body_format, metadata_json, now, id],
            )?;

            draft_by_id(tx, id)?.ok_or_else(|| QaScribeError::NotFound(id.to_string()))
        })
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
