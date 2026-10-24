use crate::{
    Result,
    domain::{RecordWriteGuard, RecordWriteOrigin},
    error::validation,
};
use rusqlite::Connection;
use sha2::{Digest, Sha256};

pub(super) fn stored(
    connection: &Connection,
    table: &str,
    session: &str,
    id: &str,
) -> Result<String> {
    super::require_row_in_session(
        connection,
        table,
        id,
        session,
        "Record must belong to this Session",
    )?;
    let row: (
        String,
        String,
        Option<String>,
        String,
        String,
        Option<String>,
    ) = connection.query_row(
        &format!(
            "SELECT title,body,body_json,body_format,kind,metadata_json FROM {table} WHERE id=?1"
        ),
        [id],
        |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
            ))
        },
    )?;
    let bytes =
        serde_json::to_vec(&(table, session, id, row)).map_err(|e| validation(e.to_string()))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

pub(super) fn matches(
    connection: &Connection,
    table: &str,
    id: &str,
    guard: &RecordWriteGuard,
) -> Result<bool> {
    let current = stored(connection, table, &guard.session_id, id)?;
    let same = current == guard.expected_stored_base;
    if same {
        super::chat_refinements::guard_stage(connection, table, id, guard)?;
    }
    Ok(same)
}

pub(super) fn restored(
    connection: &Connection,
    table: &str,
    id: &str,
    guard: &RecordWriteGuard,
) -> Result<bool> {
    let current = stored(connection, table, &guard.session_id, id)?;
    Ok(
        matches!(&guard.origin, RecordWriteOrigin::Compensation { restored_base, .. } if restored_base == &current),
    )
}
