use rusqlite::{OptionalExtension, params};

use crate::{
    QaScribeError, Result,
    domain::{Attachment, AttachmentDraft, validate_optional_text, validate_required_text},
    error::validation,
};

use super::super::session_rows::map_attachment;
use super::{SessionService, new_id, now, require_session};

impl SessionService {
    pub fn create_attachment(&self, draft: AttachmentDraft) -> Result<Attachment> {
        require_session(self.database.connection(), &draft.session_id)?;
        if let Some(entry_id) = &draft.entry_id {
            let entry_session_id: String = self.database.connection().query_row(
                "SELECT session_id FROM entries WHERE id = ?1",
                [entry_id],
                |row| row.get(0),
            )?;
            if entry_session_id != draft.session_id {
                return Err(validation("Attachment Entry must belong to the Session"));
            }
        }

        let id = new_id();
        let now = now();
        let filename = validate_required_text("attachment filename", &draft.filename, 240)?;
        let mime_type = validate_optional_text("attachment MIME type", draft.mime_type, 120)?;
        let sha256 = validate_required_text("attachment SHA-256", &draft.sha256, 64)?;
        let relative_path =
            validate_required_text("attachment relative path", &draft.relative_path, 600)?;
        if draft.size_bytes < 0 {
            return Err(validation("attachment size must not be negative"));
        }

        self.database.connection().execute(
            "INSERT INTO attachments (
                id, session_id, entry_id, filename, mime_type, size_bytes, sha256, relative_path, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                draft.session_id,
                draft.entry_id,
                filename,
                mime_type,
                draft.size_bytes,
                sha256,
                relative_path,
                now
            ],
        )?;

        self.get_attachment(&id)?.ok_or(QaScribeError::NotFound(id))
    }

    pub fn list_attachments(&self, session_id: &str) -> Result<Vec<Attachment>> {
        require_session(self.database.connection(), session_id)?;
        let mut statement = self.database.connection().prepare(
            "SELECT id, session_id, entry_id, filename, mime_type, size_bytes, sha256, relative_path, created_at
             FROM attachments
             WHERE session_id = ?1
             ORDER BY created_at DESC",
        )?;
        let attachments = statement
            .query_map([session_id], map_attachment)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(attachments)
    }

    pub fn get_attachment(&self, id: &str) -> Result<Option<Attachment>> {
        self.database
            .connection()
            .query_row(
                "SELECT id, session_id, entry_id, filename, mime_type, size_bytes, sha256, relative_path, created_at
                 FROM attachments
                 WHERE id = ?1",
                [id],
                map_attachment,
            )
            .optional()
            .map_err(Into::into)
    }
}
