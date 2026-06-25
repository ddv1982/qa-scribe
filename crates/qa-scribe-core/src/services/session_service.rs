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
    pub fn new(database: Database) -> Self {
        Self { database }
    }

    pub fn in_memory() -> Result<Self> {
        Ok(Self::new(Database::in_memory()?))
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
