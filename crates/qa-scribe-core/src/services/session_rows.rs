use rusqlite::Row;

use crate::{
    QaScribeError,
    domain::{
        AiProvider, AiRun, AiRunStatus, Attachment, Draft, DraftKind, Entry, EntryType,
        EvidenceLink, Finding, FindingKind, Session,
    },
};

pub(super) fn map_session(row: &Row<'_>) -> rusqlite::Result<Session> {
    Ok(Session {
        id: row.get(0)?,
        title: row.get(1)?,
        session_context: row.get(2)?,
        objective_notes: row.get(3)?,
        environment: row.get(4)?,
        build_version: row.get(5)?,
        related_reference: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        last_opened_at: row.get(9)?,
    })
}

pub(super) fn map_entry(row: &Row<'_>) -> rusqlite::Result<Entry> {
    let entry_type: String = row.get(2)?;
    Ok(Entry {
        id: row.get(0)?,
        session_id: row.get(1)?,
        entry_type: EntryType::from_stored(&entry_type).map_err(to_sql_error)?,
        title: row.get(3)?,
        body: row.get(4)?,
        body_json: row.get(5)?,
        body_format: row.get(6)?,
        metadata_json: row.get(7)?,
        excluded_from_generation: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

pub(super) fn map_attachment(row: &Row<'_>) -> rusqlite::Result<Attachment> {
    Ok(Attachment {
        id: row.get(0)?,
        session_id: row.get(1)?,
        entry_id: row.get(2)?,
        filename: row.get(3)?,
        mime_type: row.get(4)?,
        size_bytes: row.get(5)?,
        sha256: row.get(6)?,
        relative_path: row.get(7)?,
        created_at: row.get(8)?,
    })
}

pub(super) fn map_finding(row: &Row<'_>) -> rusqlite::Result<Finding> {
    let kind: String = row.get(6)?;
    Ok(Finding {
        id: row.get(0)?,
        session_id: row.get(1)?,
        title: row.get(2)?,
        body: row.get(3)?,
        body_json: row.get(4)?,
        body_format: row.get(5)?,
        kind: FindingKind::from_stored(&kind).map_err(to_sql_error)?,
        metadata_json: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

pub(super) fn map_evidence_link(row: &Row<'_>) -> rusqlite::Result<EvidenceLink> {
    Ok(EvidenceLink {
        id: row.get(0)?,
        finding_id: row.get(1)?,
        entry_id: row.get(2)?,
        attachment_id: row.get(3)?,
        created_at: row.get(4)?,
    })
}

pub(super) fn map_ai_run(row: &Row<'_>) -> rusqlite::Result<AiRun> {
    let provider: String = row.get(3)?;
    let status: String = row.get(7)?;
    Ok(AiRun {
        id: row.get(0)?,
        session_id: row.get(1)?,
        generation_context_id: row.get(2)?,
        provider: AiProvider::from_stored(&provider).map_err(to_sql_error)?,
        model: row.get(4)?,
        reasoning_effort: row.get(5)?,
        prompt_version: row.get(6)?,
        status: AiRunStatus::from_stored(&status).map_err(to_sql_error)?,
        error_message: row.get(8)?,
        created_at: row.get(9)?,
        completed_at: row.get(10)?,
    })
}

pub(super) fn map_draft(row: &Row<'_>) -> rusqlite::Result<Draft> {
    let kind: String = row.get(3)?;
    Ok(Draft {
        id: row.get(0)?,
        session_id: row.get(1)?,
        ai_run_id: row.get(2)?,
        kind: DraftKind::from_stored(&kind).map_err(to_sql_error)?,
        title: row.get(4)?,
        body: row.get(5)?,
        body_json: row.get(6)?,
        body_format: row.get(7)?,
        metadata_json: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn to_sql_error(error: QaScribeError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}
