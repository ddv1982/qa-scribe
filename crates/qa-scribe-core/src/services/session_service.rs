use chrono::{SecondsFormat, Utc};
use rusqlite::OptionalExtension;
use uuid::Uuid;

use crate::{QaScribeError, Result, storage::Database};

mod attachments;
mod drafts;
mod entries;
mod findings;
mod generation;
mod sessions;
mod settings;

pub struct SessionService {
    database: Database,
}

impl SessionService {
    /// Builds a service around an already-open database. Sweeps any AI Runs
    /// left `running` from a previous process (e.g. the app was killed mid
    /// generation), so every consumer that constructs a `SessionService` gets
    /// crash recovery for free without having to remember to call it.
    pub fn new(database: Database) -> Result<Self> {
        let service = Self { database };
        service.fail_orphaned_running_ai_runs()?;
        Ok(service)
    }

    pub fn in_memory() -> Result<Self> {
        Self::new(Database::in_memory()?)
    }

    pub fn database(&self) -> &Database {
        &self.database
    }
}

fn require_session(connection: &rusqlite::Connection, session_id: &str) -> Result<()> {
    let exists: Option<String> = connection
        .query_row(
            "SELECT id FROM sessions WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .optional()?;
    exists
        .map(|_| ())
        .ok_or_else(|| QaScribeError::NotFound(session_id.to_string()))
}

/// Confirms that `table.id = row_id` exists and belongs to `session_id`.
///
/// Returns `QaScribeError::NotFound(row_id)` when the row does not exist at
/// all, and `QaScribeError::Validation(cross_session_message)` when the row
/// exists but belongs to a different Session — matching how each call site
/// already described that specific business rule to its caller (e.g. "Draft
/// AI Run must belong to the Session").
///
/// This backs every "referenced row must belong to the same Session" check
/// (Entries referenced by Attachments/Evidence Links, AI Runs/Generation
/// Contexts referenced by Drafts/AI Runs, etc.) with one query shape instead
/// of the ad-hoc `query_row` calls each call site used to hand-roll — those
/// raised a raw `QueryReturnedNoRows` for a missing row instead of a
/// `NotFound`, and `create_entry` had no such check at all, relying on the
/// database's foreign key constraint to surface a raw Sqlite error instead.
fn require_row_in_session(
    connection: &rusqlite::Connection,
    table: &str,
    row_id: &str,
    session_id: &str,
    cross_session_message: &str,
) -> Result<()> {
    let sql = format!("SELECT session_id FROM {table} WHERE id = ?1");
    let row_session_id: Option<String> = connection
        .query_row(&sql, [row_id], |row| row.get(0))
        .optional()?;
    match row_session_id {
        Some(actual_session_id) if actual_session_id == session_id => Ok(()),
        Some(_) => Err(crate::error::validation(cross_session_message)),
        None => Err(QaScribeError::NotFound(row_id.to_string())),
    }
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
