use rusqlite::{OptionalExtension, params};

use crate::{
    QaScribeError, Result,
    domain::{
        Entry, EntryDraft, EntryPatch, TEXT_BODY_MAX_LENGTH, validate_body_json,
        validate_body_text, validate_metadata_json, validate_optional_text,
    },
};

use super::super::session_rows::map_entry;
use super::{SessionService, new_id, now, require_session};

impl SessionService {
    pub fn create_entry(&self, draft: EntryDraft) -> Result<Entry> {
        let id = new_id();
        let now = now();
        let body = validate_body_text("Entry body", &draft.body, TEXT_BODY_MAX_LENGTH)?;
        let body_json = validate_body_json(draft.body_json)?;
        let body_format = validate_optional_text("Entry body format", draft.body_format, 40)?;
        let title = validate_optional_text("Entry title", draft.title, 160)?;
        let metadata_json = validate_metadata_json(draft.metadata_json)?;

        self.database.connection().execute(
            "INSERT INTO entries (
                id, session_id, type, title, body, body_json, body_format, metadata_json, excluded_from_generation, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE(?7, 'html'), ?8, ?9, ?10, ?10)",
            params![
                id,
                draft.session_id,
                draft.entry_type.as_str(),
                title,
                body,
                body_json,
                body_format,
                metadata_json,
                draft.excluded_from_generation,
                now
            ],
        )?;

        self.entry(&id)?.ok_or(QaScribeError::NotFound(id))
    }

    pub fn list_entries(&self, session_id: &str) -> Result<Vec<Entry>> {
        require_session(self.database.connection(), session_id)?;
        let mut statement = self.database.connection().prepare(
            "SELECT id, session_id, type, title, body, body_json, body_format, metadata_json, excluded_from_generation, created_at, updated_at
             FROM entries
             WHERE session_id = ?1
             ORDER BY created_at ASC",
        )?;
        let entries = statement
            .query_map([session_id], map_entry)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    pub fn update_entry(&self, id: &str, patch: EntryPatch) -> Result<Entry> {
        let existing = self
            .entry(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))?;
        let title = match patch.title {
            Some(title) => validate_optional_text("Entry title", title, 160)?,
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
            Some(body_format) => validate_optional_text("Entry body format", body_format, 40)?,
            None => existing.body_format,
        };
        let metadata_json = match patch.metadata_json {
            Some(metadata_json) => validate_metadata_json(metadata_json)?,
            None => existing.metadata_json,
        };
        let excluded = patch
            .excluded_from_generation
            .unwrap_or(existing.excluded_from_generation);
        let now = now();
        self.database.connection().execute(
            "UPDATE entries
             SET title = ?1, body = ?2, body_json = ?3, body_format = COALESCE(?4, 'html'), metadata_json = ?5, excluded_from_generation = ?6, updated_at = ?7
             WHERE id = ?8",
            params![title, body, body_json, body_format, metadata_json, excluded, now, id],
        )?;
        self.entry(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))
    }

    fn entry(&self, id: &str) -> Result<Option<Entry>> {
        self.database
            .connection()
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
}
