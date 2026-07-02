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

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
