use rusqlite::params;

use crate::{Result, domain::GenerationContext};

use super::super::{SessionService, new_id, now, require_row_in_session, require_session};

impl SessionService {
    pub fn create_generation_context(&self, session_id: &str) -> Result<GenerationContext> {
        require_session(self.database.connection(), session_id)?;
        let context_id = new_id();
        let now = now();

        self.database.with_immediate_tx(|tx| {
            tx.execute(
                "INSERT INTO generation_contexts (id, session_id, created_at) VALUES (?1, ?2, ?3)",
                params![context_id, session_id, now],
            )?;

            let mut statement = tx.prepare(
                "SELECT id FROM entries
                     WHERE session_id = ?1 AND excluded_from_generation = 0
                     ORDER BY created_at ASC",
            )?;
            let entry_ids = statement
                .query_map([session_id], |row| row.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            drop(statement);
            for entry_id in entry_ids {
                tx.execute(
                    "INSERT INTO generation_context_entries (id, generation_context_id, entry_id, included)
                     VALUES (?1, ?2, ?3, 1)",
                    params![new_id(), context_id, entry_id],
                )?;
            }

            let mut statement = tx.prepare(
                "SELECT id FROM attachments WHERE session_id = ?1 ORDER BY created_at ASC",
            )?;
            let attachment_ids = statement
                .query_map([session_id], |row| row.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            drop(statement);
            for attachment_id in attachment_ids {
                tx.execute(
                    "INSERT INTO generation_context_attachments (id, generation_context_id, attachment_id, included)
                     VALUES (?1, ?2, ?3, 1)",
                    params![new_id(), context_id, attachment_id],
                )?;
            }
            Ok(())
        })?;

        Ok(GenerationContext {
            id: context_id,
            session_id: session_id.to_string(),
            created_at: now,
        })
    }

    pub fn create_generation_context_from_material(
        &self,
        session_id: &str,
        entry_ids: &[String],
        attachment_ids: &[String],
    ) -> Result<GenerationContext> {
        require_session(self.database.connection(), session_id)?;
        for entry_id in entry_ids {
            require_row_in_session(
                self.database.connection(),
                "entries",
                entry_id,
                session_id,
                "Generation Context Entry must belong to the Session",
            )?;
        }
        for attachment_id in attachment_ids {
            require_row_in_session(
                self.database.connection(),
                "attachments",
                attachment_id,
                session_id,
                "Generation Context Attachment must belong to the Session",
            )?;
        }

        let context_id = new_id();
        let now = now();
        self.database.with_immediate_tx(|tx| {
            tx.execute(
                "INSERT INTO generation_contexts (id, session_id, created_at) VALUES (?1, ?2, ?3)",
                params![context_id, session_id, now],
            )?;
            for entry_id in entry_ids {
                tx.execute(
                    "INSERT INTO generation_context_entries (id, generation_context_id, entry_id, included)
                     VALUES (?1, ?2, ?3, 1)",
                    params![new_id(), context_id, entry_id],
                )?;
            }
            for attachment_id in attachment_ids {
                tx.execute(
                    "INSERT INTO generation_context_attachments (id, generation_context_id, attachment_id, included)
                     VALUES (?1, ?2, ?3, 1)",
                    params![new_id(), context_id, attachment_id],
                )?;
            }
            Ok(())
        })?;

        Ok(GenerationContext {
            id: context_id,
            session_id: session_id.to_string(),
            created_at: now,
        })
    }
}
