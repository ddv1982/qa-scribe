use rusqlite::{Connection, params};

use super::{SessionService, attachments, chat_rows as rows, new_id};
use crate::{
    Result,
    attachments::chat::{MAX_CHAT_IMAGE_BYTES, MAX_CHAT_TURN_IMAGE_BYTES, MAX_CHAT_TURN_IMAGES},
    domain::*,
    error::validation,
};

pub(super) fn read(connection: &Connection, owner: &str, composer: bool) -> Result<Vec<ChatImage>> {
    let sql = if composer {
        "SELECT a.id, a.filename, a.mime_type, a.size_bytes FROM chat_composer_images i JOIN attachments a ON a.id = i.attachment_id WHERE i.draft_id = ?1 ORDER BY i.ordinal"
    } else {
        "SELECT a.id, a.filename, a.mime_type, a.size_bytes FROM chat_message_images i JOIN attachments a ON a.id = i.attachment_id WHERE i.message_id = ?1 ORDER BY i.ordinal"
    };
    Ok(connection
        .prepare(sql)?
        .query_map([owner], |r| {
            Ok(ChatImage {
                attachment_id: r.get(0)?,
                filename: r.get(1)?,
                mime_type: r.get(2)?,
                size_bytes: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

fn capacity(chat: &ChatState, count: usize, bytes: usize) -> Result<()> {
    if count > MAX_CHAT_TURN_IMAGES {
        return Err(validation("Chat accepts at most 4 images per message"));
    }
    if bytes > MAX_CHAT_TURN_IMAGE_BYTES {
        return Err(validation(
            "Chat images must total at most 20 MiB per message",
        ));
    }
    rows::editable(chat)
}

pub(super) fn replace(connection: &Connection, chat: &ChatState, ids: &[String]) -> Result<()> {
    let mut seen = std::collections::HashSet::new();
    let mut bytes = 0usize;
    for id in ids {
        if !seen.insert(id) {
            return Err(validation("Chat image references must be unique"));
        }
        let image = chat
            .composer_images
            .iter()
            .find(|image| image.attachment_id == *id)
            .ok_or_else(|| {
                validation("Chat image must already belong to this composer. Import it first.")
            })?;
        bytes += image.size_bytes as usize;
    }
    capacity(chat, ids.len(), bytes)?;
    connection.execute(
        "DELETE FROM chat_composer_images WHERE draft_id = ?1",
        [&chat.draft_id],
    )?;
    for (ordinal, id) in ids.iter().enumerate() {
        connection.execute("INSERT INTO chat_composer_images (draft_id, attachment_id, ordinal) VALUES (?1, ?2, ?3)", params![chat.draft_id, id, ordinal as i32])?;
    }
    Ok(())
}

impl SessionService {
    pub fn check_chat_image_import(&self, scope: &ChatRevision, size: usize) -> Result<()> {
        let chat = rows::checked(self.database.connection(), scope)?;
        import_capacity(&chat, size)
    }

    pub(crate) fn reserve_chat_image_import(
        &self,
        scope: &ChatRevision,
        draft: &AttachmentDraft,
        temp_path: &str,
    ) -> Result<()> {
        self.database.with_immediate_tx(|tx| {
            let chat = rows::checked(tx, scope)?;
            import_capacity(&chat, draft.size_bytes as usize)?;
            tx.execute("INSERT INTO chat_image_imports (relative_path, temp_path, session_id) VALUES (?1, ?2, ?3)", params![draft.relative_path, temp_path, scope.session_id])?;
            Ok(())
        })
    }

    pub(crate) fn append_imported_chat_image(
        &self,
        scope: &ChatRevision,
        draft: AttachmentDraft,
    ) -> Result<ChatState> {
        self.database.with_immediate_tx(|tx| {
            let chat = rows::checked(tx, scope)?;
            if draft.session_id != chat.session_id || draft.entry_id.is_some() {
                return Err(validation("Chat image must belong to its Session"));
            }
            import_capacity(&chat, draft.size_bytes as usize)?;
            let image = attachments::create_attachment_on(tx, new_id(), draft)?;
            tx.execute("INSERT INTO chat_composer_images (draft_id, attachment_id, ordinal) VALUES (?1, ?2, ?3)", params![chat.draft_id, image.id, chat.composer_images.len() as i32])?;
            tx.execute("DELETE FROM chat_image_imports WHERE relative_path = ?1", [&image.relative_path])?;
            rows::bump(tx, &chat.draft_id)?;
            rows::read(tx, &chat.draft_id)
        })
    }
}

fn import_capacity(chat: &ChatState, size: usize) -> Result<()> {
    if size > MAX_CHAT_IMAGE_BYTES {
        return Err(validation("Chat images must be at most 10 MiB each"));
    }
    capacity(
        chat,
        chat.composer_images.len() + 1,
        chat.composer_images
            .iter()
            .map(|image| image.size_bytes as usize)
            .sum::<usize>()
            + size,
    )
}
