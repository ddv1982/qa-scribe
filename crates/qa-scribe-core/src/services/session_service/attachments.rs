use std::path::{Component, Path};

use rusqlite::{Connection, OptionalExtension, params};

use crate::{
    QaScribeError, Result,
    domain::{
        Attachment, AttachmentDraft, validate_optional_text, validate_required_text,
        validate_sha256_hex,
    },
    error::validation,
};

use super::super::session_rows::map_attachment;
use super::{SessionService, new_id, now, require_session};

impl SessionService {
    pub fn create_attachment(&self, draft: AttachmentDraft) -> Result<Attachment> {
        create_attachment_on(self.database.connection(), new_id(), draft)
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

    pub fn delete_attachment(&self, id: &str) -> Result<()> {
        let deleted = self
            .database
            .connection()
            .execute("DELETE FROM attachments WHERE id = ?1", [id])?;
        if deleted == 0 {
            return Err(QaScribeError::NotFound(id.to_string()));
        }
        Ok(())
    }

    pub fn attachment_is_referenced(&self, id: &str) -> Result<bool> {
        attachment_is_referenced_on(self.database.connection(), id)
    }
}

fn is_safe_relative_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && !path.is_absolute()
        && path.components().all(|component| {
            matches!(
                component,
                Component::Normal(value) if !value.to_string_lossy().is_empty()
            )
        })
}

fn is_managed_attachment_path(path: &Path, session_id: &str) -> bool {
    let expected_parent = Path::new("attachments").join(session_id);
    path.parent()
        .is_some_and(|parent| parent == expected_parent.as_path())
}

pub(crate) fn create_attachment_on(
    connection: &Connection,
    id: String,
    draft: AttachmentDraft,
) -> Result<Attachment> {
    require_session(connection, &draft.session_id)?;
    if let Some(entry_id) = &draft.entry_id {
        super::require_row_in_session(
            connection,
            "entries",
            entry_id,
            &draft.session_id,
            "Attachment Entry must belong to the Session",
        )?;
    }

    let now = now();
    let filename = validate_required_text("attachment filename", &draft.filename, 240)?;
    let mime_type = validate_optional_text("attachment MIME type", draft.mime_type, 120)?;
    let sha256 = validate_sha256_hex("attachment SHA-256", &draft.sha256)?;
    let relative_path =
        validate_required_text("attachment relative path", &draft.relative_path, 600)?;
    let relative_path_value = Path::new(&relative_path);
    if !is_safe_relative_path(relative_path_value) {
        return Err(validation("attachment relative path is invalid"));
    }
    if !is_managed_attachment_path(relative_path_value, &draft.session_id) {
        return Err(validation(
            "attachment relative path must be under the Session attachment directory",
        ));
    }
    if draft.size_bytes < 0 {
        return Err(validation("attachment size must not be negative"));
    }

    connection.execute(
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

    attachment_on(connection, &id)?.ok_or(QaScribeError::NotFound(id))
}

pub(crate) fn attachment_is_referenced_on(connection: &Connection, id: &str) -> Result<bool> {
    connection
        .query_row(
            "SELECT EXISTS(
                    SELECT 1 FROM entries
                     WHERE instr(body, ?1) > 0 OR instr(COALESCE(body_json, ''), ?1) > 0
                    UNION ALL
                    SELECT 1 FROM drafts
                     WHERE instr(body, ?1) > 0 OR instr(COALESCE(body_json, ''), ?1) > 0
                    UNION ALL
                    SELECT 1 FROM findings
                     WHERE instr(body, ?1) > 0 OR instr(COALESCE(body_json, ''), ?1) > 0
                    UNION ALL
                    SELECT 1 FROM chat_composer_images WHERE attachment_id = ?1
                    UNION ALL
                    SELECT 1 FROM chat_message_images WHERE attachment_id = ?1
                    UNION ALL
                    SELECT 1 FROM evidence_links WHERE attachment_id = ?1
                    UNION ALL
                    SELECT 1 FROM generation_context_attachments WHERE attachment_id = ?1
                )",
            [id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(Into::into)
}

pub(crate) fn attachment_on(connection: &Connection, id: &str) -> Result<Option<Attachment>> {
    connection.query_row("SELECT id, session_id, entry_id, filename, mime_type, size_bytes, sha256, relative_path, created_at FROM attachments WHERE id = ?1", [id], map_attachment).optional().map_err(Into::into)
}
