use rusqlite::{Connection, OptionalExtension, params};

use crate::{
    QaScribeError, Result,
    attachments::{MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_FILENAME_BYTES, safe_filename},
    domain::*,
    error::validation,
};

use super::{SessionService, new_id, now, require_session};

pub(crate) mod payload;

#[derive(Clone, Debug)]
pub(crate) struct CreationAttempt {
    pub session_id: String,
    pub kind: CreationKind,
    pub state: CreationAttemptState,
    pub payload_hash: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) enum CreationAttemptState {
    Preparing,
    Committed { record_id: String },
    Aborted,
}

impl CreationAttempt {
    pub fn preparing(&self) -> bool {
        matches!(self.state, CreationAttemptState::Preparing)
    }
}

#[derive(Clone, Debug)]
pub(crate) struct CreationAttemptImage {
    pub descriptor: CreationImageDescriptor,
    pub attachment_id: String,
    pub relative_path: String,
}

impl SessionService {
    pub fn prepare_creation_save(
        &self,
        mut request: PrepareCreationSave,
    ) -> Result<PreparedCreation> {
        request.attempt_id = validate_required_text("Creation attempt", &request.attempt_id, 160)?;
        request.images.sort_by(|a, b| a.local_id.cmp(&b.local_id));
        let mut previous = None;
        for image in &mut request.images {
            image.filename = safe_filename(&image.filename);
            validate_required_text("Local image ID", &image.local_id, 160)?;
            if previous == Some(&image.local_id) {
                return Err(validation("Duplicate local image ID"));
            }
            previous = Some(&image.local_id);
            if image.filename.is_empty() || image.filename.len() > MAX_ATTACHMENT_FILENAME_BYTES {
                return Err(validation(
                    "Creation image filename must be sanitized and at most 200 bytes",
                ));
            }
            image.sha256 = validate_sha256_hex("Creation image digest", &image.sha256)?;
            if !(0..=MAX_ATTACHMENT_BYTES as u32).contains(&image.size_bytes) {
                return Err(validation(
                    "Creation image exceeds the attachment byte limit",
                ));
            }
            if image.mime_type.len() > 120
                || image
                    .mime_type
                    .strip_prefix("image/")
                    .is_none_or(|subtype| {
                        subtype.is_empty()
                            || !subtype.bytes().all(|byte| {
                                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+')
                            })
                    })
            {
                return Err(validation("Creation image MIME type is invalid"));
            }
        }
        self.database.with_immediate_tx(|tx| {
            if let Some(existing) = read_attempt(tx, &request.attempt_id)? {
                let images = read_images(tx, &request.attempt_id)?;
                if existing.session_id != request.session_id || existing.kind != request.kind || images.iter().map(|image| &image.descriptor).ne(request.images.iter()) {
                    return Err(validation("Creation attempt already owns a different preparation"));
                }
                return prepared(tx, &request.attempt_id, &existing, &images);
            }
            require_session(tx, &request.session_id)?;
            tx.execute("INSERT INTO creation_attempts (attempt_id, session_id, kind, state, created_at) VALUES (?1, ?2, ?3, 'preparing', ?4)", params![request.attempt_id, request.session_id, request.kind.as_str(), now()])?;
            for image in &request.images {
                let attachment_id = new_id();
                let path = format!("attachments/{}/{}_{}", request.session_id, attachment_id, image.filename);
                if !crate::attachments::is_exact_attachment_path(&path, &request.session_id) { return Err(validation("Creation Session attachment path is invalid")); }
                tx.execute("INSERT INTO creation_attempt_images (attempt_id, local_id, attachment_id, relative_path, filename, mime_type, size_bytes, sha256) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)", params![request.attempt_id, image.local_id, attachment_id, path, image.filename, image.mime_type, image.size_bytes, image.sha256])?;
            }
            let attempt = require_attempt(tx, &request.attempt_id)?;
            prepared(tx, &request.attempt_id, &attempt, &read_images(tx, &request.attempt_id)?)
        })
    }

    pub fn note_source(&self, session_id: &str, note_id: &str) -> Result<Option<NoteSource>> {
        self.database.connection().query_row(
            "SELECT id, session_id, type, title, body, body_json, body_format, metadata_json, excluded_from_generation, created_at, updated_at, revision FROM entries WHERE id = ?1 AND session_id = ?2 AND type = 'note'",
            params![note_id, session_id], |row| Ok(NoteSource { entry: super::super::session_rows::map_entry(row)?, revision: row.get(11)? }),
        ).optional().map_err(Into::into)
    }
}

fn prepared(
    connection: &Connection,
    id: &str,
    attempt: &CreationAttempt,
    images: &[CreationAttemptImage],
) -> Result<PreparedCreation> {
    Ok(PreparedCreation {
        attempt_id: id.into(),
        images: images
            .iter()
            .map(|image| PreparedCreationImage {
                local_id: image.descriptor.local_id.clone(),
                attachment_id: image.attachment_id.clone(),
                filename: image.descriptor.filename.clone(),
            })
            .collect(),
        outcome: outcome(connection, attempt)?,
    })
}

pub(crate) fn require_attempt(connection: &Connection, id: &str) -> Result<CreationAttempt> {
    read_attempt(connection, id)?.ok_or_else(|| QaScribeError::NotFound(id.into()))
}

type StoredAttemptRow = (String, String, String, Option<String>, Option<String>);

fn read_attempt(connection: &Connection, id: &str) -> Result<Option<CreationAttempt>> {
    let row: Option<StoredAttemptRow> = connection.query_row("SELECT session_id, kind, state, payload_hash, record_id FROM creation_attempts WHERE attempt_id = ?1", [id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?))).optional()?;
    row.map(|(session_id, kind, state, payload_hash, record_id)| {
        Ok(CreationAttempt {
            session_id,
            kind: match kind.as_str() {
                "finding" => CreationKind::Finding,
                "testware" => CreationKind::Testware,
                _ => return Err(validation("Invalid stored creation kind")),
            },
            state: match (state.as_str(), record_id) {
                ("preparing", None) => CreationAttemptState::Preparing,
                ("committed", Some(record_id)) if payload_hash.is_some() => {
                    CreationAttemptState::Committed { record_id }
                }
                ("aborted", None) => CreationAttemptState::Aborted,
                _ => return Err(validation("Invalid stored creation state or receipt")),
            },
            payload_hash,
        })
    })
    .transpose()
}

pub(crate) fn read_images(connection: &Connection, id: &str) -> Result<Vec<CreationAttemptImage>> {
    Ok(connection.prepare("SELECT local_id, attachment_id, relative_path, filename, mime_type, size_bytes, sha256 FROM creation_attempt_images WHERE attempt_id = ?1 ORDER BY local_id")?.query_map([id], |row| Ok(CreationAttemptImage { attachment_id: row.get(1)?, relative_path: row.get(2)?, descriptor: CreationImageDescriptor { local_id: row.get(0)?, filename: row.get(3)?, mime_type: row.get(4)?, size_bytes: row.get(5)?, sha256: row.get(6)? } }))?.collect::<std::result::Result<Vec<_>,_>>()?)
}

pub(crate) fn outcome(
    connection: &Connection,
    attempt: &CreationAttempt,
) -> Result<CreationOutcome> {
    match &attempt.state {
        CreationAttemptState::Preparing => Ok(CreationOutcome::Preparing),
        CreationAttemptState::Aborted => Ok(CreationOutcome::Aborted),
        CreationAttemptState::Committed { record_id: id } => {
            let record = match attempt.kind {
                CreationKind::Finding => {
                    super::findings::finding(connection, id)?.map(CreatedRecord::Finding)
                }
                CreationKind::Testware => {
                    super::drafts::draft_by_id(connection, id)?.map(CreatedRecord::Testware)
                }
            };
            Ok(match record {
                Some(record) => CreationOutcome::Committed {
                    record: Box::new(record),
                },
                None => CreationOutcome::CommittedDeleted {
                    record_id: id.clone(),
                },
            })
        }
    }
}

pub(crate) fn insert_result(
    connection: &Connection,
    session_id: &str,
    record: CreationRecordInput,
) -> Result<(String, CreatedRecord)> {
    match record {
        CreationRecordInput::Finding {
            title,
            body,
            body_json,
            body_format,
            metadata_json,
            finding_kind,
        } => {
            let record = super::findings::create_finding_on(
                connection,
                FindingDraft {
                    session_id: session_id.into(),
                    title,
                    body,
                    body_json,
                    body_format,
                    metadata_json,
                    kind: finding_kind,
                },
            )?;
            Ok((record.id.clone(), CreatedRecord::Finding(record)))
        }
        CreationRecordInput::Testware {
            title,
            body,
            body_json,
            body_format,
            metadata_json,
        } => {
            let record = super::drafts::create_draft_on(
                connection,
                DraftCreate {
                    session_id: session_id.into(),
                    ai_run_id: None,
                    kind: DraftKind::Testware,
                    title,
                    body,
                    body_json,
                    body_format,
                    metadata_json,
                },
            )?;
            Ok((record.id.clone(), CreatedRecord::Testware(record)))
        }
    }
}
