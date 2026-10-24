use std::path::Path;

use rusqlite::{OptionalExtension, params};

use super::cleanup::{is_exact_attachment_path, remove_queued_file};
use crate::{
    Result,
    domain::{ChatComposerRequest, ChatState},
    services::SessionService,
};

pub fn save_chat_composer_with_cleanup(
    service: &SessionService,
    root: &Path,
    request: ChatComposerRequest,
) -> Result<ChatState> {
    let (chat, released) = service.save_chat_composer_releasing_images(request)?;
    for path in released {
        let _ = cleanup_path(service, root, &path);
    }
    Ok(chat)
}

pub(super) fn retry(service: &SessionService, root: &Path) -> Result<u32> {
    let paths = service.database().connection()
        .prepare("SELECT relative_path FROM chat_image_cleanup ORDER BY attempt_count, relative_path LIMIT 50")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for path in paths {
        cleanup_path(service, root, &path)?;
    }
    Ok(service.database().connection().query_row(
        "SELECT count(*) FROM chat_image_cleanup",
        [],
        |row| row.get(0),
    )?)
}

fn cleanup_path(service: &SessionService, root: &Path, path: &str) -> Result<()> {
    service.database().with_immediate_tx(|tx| {
        let session = tx.query_row(
            "SELECT session_id FROM chat_image_cleanup WHERE relative_path = ?1",
            [path], |row| row.get::<_, String>(0),
        ).optional()?;
        let Some(session) = session else { return Ok(()); };
        tx.execute("UPDATE chat_image_cleanup SET attempt_count = attempt_count + 1 WHERE relative_path = ?1", [path])?;
        if !is_exact_attachment_path(path, &session) {
            return Ok(());
        }
        let owned: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM attachments WHERE relative_path = ?1)
                 OR EXISTS(SELECT 1 FROM chat_image_imports WHERE relative_path = ?1 OR temp_path = ?1)",
            params![path], |row| row.get(0),
        )?;
        if owned || remove_queued_file(root, path).is_err() {
            return Ok(());
        }
        tx.execute("DELETE FROM chat_image_cleanup WHERE relative_path = ?1", [path])?;
        Ok(())
    })
}
