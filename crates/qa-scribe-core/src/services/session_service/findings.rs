use rusqlite::{OptionalExtension, params};

use crate::{
    QaScribeError, Result,
    domain::{
        EvidenceLink, EvidenceLinkDraft, Finding, FindingDraft, FindingPatch, TEXT_BODY_MAX_LENGTH,
        validate_body_json, validate_body_text, validate_metadata_json, validate_optional_text,
        validate_required_text,
    },
    error::validation,
};

use super::super::session_rows::{map_evidence_link, map_finding};
use super::{SessionService, new_id, now, require_session};

impl SessionService {
    pub fn create_finding(&self, draft: FindingDraft) -> Result<Finding> {
        let id = new_id();
        let now = now();
        let title = validate_required_text("Finding title", &draft.title, 160)?;
        let body = validate_body_text("Finding body", &draft.body, TEXT_BODY_MAX_LENGTH)?;
        let body_json = validate_body_json(draft.body_json)?;
        let body_format = validate_optional_text("Finding body format", draft.body_format, 40)?;
        let metadata_json = validate_metadata_json(draft.metadata_json)?;

        self.database.connection().execute(
            "INSERT INTO findings (id, session_id, title, body, body_json, body_format, kind, metadata_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, COALESCE(?6, 'html'), ?7, ?8, ?9, ?9)",
            params![id, draft.session_id, title, body, body_json, body_format, draft.kind.as_str(), metadata_json, now],
        )?;

        self.finding(&id)?.ok_or(QaScribeError::NotFound(id))
    }

    pub fn list_findings(&self, session_id: &str) -> Result<Vec<Finding>> {
        require_session(self.database.connection(), session_id)?;
        let mut statement = self.database.connection().prepare(
            "SELECT id, session_id, title, body, body_json, body_format, kind, metadata_json, created_at, updated_at
             FROM findings
             WHERE session_id = ?1
             ORDER BY created_at DESC",
        )?;
        let findings = statement
            .query_map([session_id], map_finding)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(findings)
    }

    pub fn update_finding(&self, id: &str, patch: FindingPatch) -> Result<Finding> {
        let existing = self
            .finding(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))?;
        let title = match patch.title {
            Some(title) => validate_required_text("Finding title", &title, 160)?,
            None => existing.title,
        };
        let body = match patch.body {
            Some(body) => validate_body_text("Finding body", &body, TEXT_BODY_MAX_LENGTH)?,
            None => existing.body,
        };
        let body_json = match patch.body_json {
            Some(body_json) => validate_body_json(body_json)?,
            None => existing.body_json,
        };
        let body_format = match patch.body_format {
            Some(body_format) => validate_optional_text("Finding body format", body_format, 40)?,
            None => existing.body_format,
        };
        let now = now();

        self.database.connection().execute(
            "UPDATE findings
             SET title = ?1, body = ?2, body_json = ?3, body_format = COALESCE(?4, 'html'), updated_at = ?5
             WHERE id = ?6",
            params![title, body, body_json, body_format, now, id],
        )?;

        self.finding(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))
    }

    pub fn delete_finding(&self, id: &str) -> Result<()> {
        let changed = self
            .database
            .connection()
            .execute("DELETE FROM findings WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(QaScribeError::NotFound(id.to_string()));
        }
        Ok(())
    }

    pub fn create_evidence_link(&self, draft: EvidenceLinkDraft) -> Result<EvidenceLink> {
        if draft.entry_id.is_none() && draft.attachment_id.is_none() {
            return Err(validation(
                "Evidence link requires an Entry or managed attachment reference",
            ));
        }

        let finding_session_id: String = self.database.connection().query_row(
            "SELECT session_id FROM findings WHERE id = ?1",
            [&draft.finding_id],
            |row| row.get(0),
        )?;

        if let Some(entry_id) = &draft.entry_id {
            let entry_session_id: String = self.database.connection().query_row(
                "SELECT session_id FROM entries WHERE id = ?1",
                [entry_id],
                |row| row.get(0),
            )?;
            if entry_session_id != finding_session_id {
                return Err(validation(
                    "Evidence link Entry must belong to the Finding Session",
                ));
            }
        }

        if let Some(attachment_id) = &draft.attachment_id {
            let attachment_session_id: String = self.database.connection().query_row(
                "SELECT session_id FROM attachments WHERE id = ?1",
                [attachment_id],
                |row| row.get(0),
            )?;
            if attachment_session_id != finding_session_id {
                return Err(validation(
                    "Evidence link attachment reference must belong to the Finding Session",
                ));
            }
        }

        let id = new_id();
        let now = now();
        self.database.connection().execute(
            "INSERT INTO evidence_links (id, finding_id, entry_id, attachment_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id,
                draft.finding_id,
                draft.entry_id,
                draft.attachment_id,
                now
            ],
        )?;

        self.evidence_link(&id)?.ok_or(QaScribeError::NotFound(id))
    }

    pub fn list_evidence_links(&self, session_id: &str) -> Result<Vec<EvidenceLink>> {
        require_session(self.database.connection(), session_id)?;
        let mut statement = self.database.connection().prepare(
            "SELECT evidence_links.id, evidence_links.finding_id, evidence_links.entry_id,
                    evidence_links.attachment_id, evidence_links.created_at
             FROM evidence_links
             INNER JOIN findings ON findings.id = evidence_links.finding_id
             WHERE findings.session_id = ?1
             ORDER BY evidence_links.created_at ASC",
        )?;
        let links = statement
            .query_map([session_id], map_evidence_link)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(links)
    }

    fn finding(&self, id: &str) -> Result<Option<Finding>> {
        self.database
            .connection()
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

    fn evidence_link(&self, id: &str) -> Result<Option<EvidenceLink>> {
        self.database
            .connection()
            .query_row(
                "SELECT id, finding_id, entry_id, attachment_id, created_at
                 FROM evidence_links
                 WHERE id = ?1",
                [id],
                map_evidence_link,
            )
            .optional()
            .map_err(Into::into)
    }
}
