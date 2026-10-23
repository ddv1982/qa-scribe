use std::path::Path;

use rusqlite::{Connection, params};

use crate::{
    Result,
    domain::*,
    error::validation,
    services::{
        SessionService,
        session_service::{
            attachments::{attachment_is_referenced_on, attachment_on, create_attachment_on},
            creation::{self, CreationAttemptImage, payload},
        },
    },
};

mod files;
mod staging;

pub fn commit_creation_save(
    service: &SessionService,
    root: impl AsRef<Path>,
    request: CommitCreationSave,
) -> Result<CreationOutcome> {
    let root = root.as_ref();
    let record = payload::normalize_record(request.record)?;
    let mut shared = request.shared_attachment_ids;
    shared.sort();
    shared.dedup();
    let database = service.database();
    let (slots, bytes, fingerprint, initial) = database.with_immediate_tx(|tx| {
        let attempt = creation::require_attempt(tx, &request.attempt_id)?;
        if attempt.kind != payload::kind(&record) {
            return Err(validation("Creation record kind differs from its attempt"));
        }
        let slots = creation::read_images(tx, &request.attempt_id)?;
        for slot in &slots {
            files::validate_slot(&attempt.session_id, slot)?;
        }
        payload::validate_references(&record, &slots, &shared)?;
        let bytes = payload::image_bytes(request.images, &slots)?;
        let fingerprint = payload::fingerprint(&attempt.session_id, &record, &slots, &shared);
        if attempt
            .payload_hash
            .as_ref()
            .is_some_and(|stored| stored != &fingerprint)
        {
            return Err(validation(
                "Creation attempt already owns a different payload",
            ));
        }
        if attempt.preparing() {
            validate_shared(tx, &attempt.session_id, &shared)?;
            tx.execute(
                "UPDATE creation_attempts SET payload_hash = ?1 WHERE attempt_id = ?2",
                params![fingerprint, request.attempt_id],
            )?;
        }
        Ok((slots, bytes, fingerprint, creation::outcome(tx, &attempt)?))
    })?;
    #[cfg(test)]
    tests::cut("bound");
    if initial != CreationOutcome::Preparing {
        return Ok(initial);
    }
    for slot in &slots {
        database.with_immediate_tx(|tx| {
            let attempt = creation::require_attempt(tx, &request.attempt_id)?;
            if attempt.preparing() {
                if attempt.payload_hash.as_deref() != Some(&fingerprint) {
                    return Err(validation("Creation payload binding changed"));
                }
                validate_shared(tx, &attempt.session_id, &shared)?;
                validate_owned_row(tx, &attempt.session_id, slot)?;
                staging::reserve(tx, root, slot)?;
            }
            Ok(())
        })?;
        #[cfg(test)]
        tests::cut("namespace-reserved");
        let state = database.with_immediate_tx(|tx| {
            let attempt = creation::require_attempt(tx, &request.attempt_id)?;
            if !attempt.preparing() {
                return creation::outcome(tx, &attempt);
            }
            if attempt.payload_hash.as_deref() != Some(&fingerprint) {
                return Err(validation("Creation payload binding changed"));
            }
            validate_shared(tx, &attempt.session_id, &shared)?;
            validate_owned_row(tx, &attempt.session_id, slot)?;
            files::stage(tx, root, slot, &bytes[&slot.descriptor.local_id])?;
            Ok(CreationOutcome::Preparing)
        })?;
        if state != CreationOutcome::Preparing {
            return Ok(state);
        }
        #[cfg(test)]
        tests::cut("image-staged");
    }
    let result = database.with_immediate_tx(|tx| {
        let attempt = creation::require_attempt(tx, &request.attempt_id)?;
        if !attempt.preparing() { return creation::outcome(tx, &attempt); }
        if attempt.payload_hash.as_deref() != Some(&fingerprint) { return Err(validation("Creation payload binding changed")); }
        validate_shared(tx, &attempt.session_id, &shared)?;
        for slot in &slots {
            validate_owned_row(tx, &attempt.session_id, slot)?;
            files::verify_final(root, slot)?;
            if attachment_on(tx, &slot.attachment_id)?.is_some() { return Err(validation("Creation attachment was inserted outside its commit")); }
            create_attachment_on(tx, slot.attachment_id.clone(), AttachmentDraft { session_id: attempt.session_id.clone(), entry_id: None, filename: slot.descriptor.filename.clone(), mime_type: Some(slot.descriptor.mime_type.clone()), size_bytes: i64::from(slot.descriptor.size_bytes), sha256: slot.descriptor.sha256.clone(), relative_path: slot.relative_path.clone() })?;
            #[cfg(test)] tests::cut("attachment-insert");
        }
        let (id, record) = creation::insert_result(tx, &attempt.session_id, record)?;
        #[cfg(test)] tests::cut("record-insert");
        tx.execute("UPDATE creation_attempts SET state = 'committed', record_id = ?1 WHERE attempt_id = ?2 AND state = 'preparing'", params![id, request.attempt_id])?;
        #[cfg(test)] tests::cut("receipt-update");
        Ok(CreationOutcome::Committed { record: Box::new(record) })
    })?;
    #[cfg(test)]
    tests::cut("committed");
    Ok(result)
}

fn validate_shared(connection: &Connection, session_id: &str, shared: &[String]) -> Result<()> {
    super::super::services::session_service::require_session(connection, session_id)?;
    for id in shared {
        if attachment_on(connection, id)?
            .is_none_or(|attachment| attachment.session_id != session_id)
        {
            return Err(validation(
                "Shared creation image must belong to its Session",
            ));
        }
    }
    Ok(())
}

fn validate_owned_row(
    connection: &Connection,
    session: &str,
    slot: &CreationAttemptImage,
) -> Result<()> {
    files::validate_slot(session, slot)?;
    let temporary_path = format!("attachments/{session}/.{}.tmp", slot.attachment_id);
    let other: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM attachments WHERE (relative_path = ?1 AND id != ?2) OR relative_path = ?3)",
        params![slot.relative_path, slot.attachment_id, temporary_path],
        |row| row.get(0),
    )?;
    if other {
        return Err(validation("Creation path belongs to another attachment"));
    }
    if let Some(row) = attachment_on(connection, &slot.attachment_id)?
        && (row.session_id != session
            || row.entry_id.is_some()
            || row.relative_path != slot.relative_path
            || row.filename != slot.descriptor.filename
            || row.mime_type.as_deref() != Some(&slot.descriptor.mime_type)
            || row.size_bytes != i64::from(slot.descriptor.size_bytes)
            || row.sha256 != slot.descriptor.sha256)
    {
        return Err(validation(
            "Creation attachment row does not match its reservation",
        ));
    }
    Ok(())
}

pub fn abort_creation_save(
    service: &SessionService,
    root: impl AsRef<Path>,
    attempt_id: &str,
) -> Result<CreationOutcome> {
    service.database().with_immediate_tx(|tx| {
        let attempt = creation::require_attempt(tx, attempt_id)?;
        if !attempt.preparing() {
            return creation::outcome(tx, &attempt);
        }
        for slot in creation::read_images(tx, attempt_id)? {
            validate_owned_row(tx, &attempt.session_id, &slot)?;
            if attachment_is_referenced_on(tx, &slot.attachment_id)? {
                return Err(validation(
                    "Creation image still has a live reference owner",
                ));
            }
            staging::validate(tx, root.as_ref(), &slot)?;
            files::remove(root.as_ref(), &slot)?;
            staging::remove(tx, root.as_ref(), &slot)?;
            tx.execute(
                "DELETE FROM attachments WHERE id = ?1",
                [&slot.attachment_id],
            )?;
        }
        tx.execute(
            "UPDATE creation_attempts SET state = 'aborted' WHERE attempt_id = ?1",
            [attempt_id],
        )?;
        Ok(CreationOutcome::Aborted)
    })
}

pub fn reconcile_creation_saves(
    service: &SessionService,
    root: impl AsRef<Path>,
) -> Result<CreationRecoveryStatus> {
    let attempts = service.database().connection().prepare("SELECT attempt_id FROM creation_attempts WHERE state = 'preparing' ORDER BY created_at, attempt_id LIMIT 50")?.query_map([], |row| row.get::<_, String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
    for attempt in attempts {
        if let Err(error) = abort_creation_save(service, root.as_ref(), &attempt) {
            eprintln!("qa-scribe creation recovery retained attempt {attempt}: {error}");
        }
    }
    let count: i64 = service.database().connection().query_row(
        "SELECT COUNT(*) FROM creation_attempts WHERE state = 'preparing'",
        [],
        |row| row.get(0),
    )?;
    Ok(CreationRecoveryStatus {
        pending_attempts: u32::try_from(count)
            .map_err(|_| validation("Creation recovery count exceeds supported range"))?,
    })
}

#[cfg(test)]
mod tests;
