use super::cleanup::{is_exact_attachment_path, remove_queued_file};
use crate::{Result, services::SessionService};
use rusqlite::{OptionalExtension, params};
use std::{
    fs::{File, OpenOptions, TryLockError},
    path::Path,
};

pub(crate) fn image_import_recovery_lock(root: &Path) -> Result<File> {
    std::fs::create_dir_all(root)?;
    Ok(OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join(".image-import-recovery.lock"))?)
}

/// Startup-only recovery. An active Result notes import may be in another app instance.
pub fn recover_chat_image_imports(service: &SessionService, root: &Path) -> Result<usize> {
    let lock = image_import_recovery_lock(root)?;
    match lock.try_lock() {
        Ok(()) => {}
        Err(TryLockError::WouldBlock) => return pending_count(service),
        Err(TryLockError::Error(error)) => return Err(error.into()),
    }
    let database = service.database();
    let paths = database.connection().prepare("SELECT relative_path, temp_path, session_id FROM chat_image_imports ORDER BY attempt_count, relative_path LIMIT 50")?
        .query_map([], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (path, temp, session) in paths {
        recover_import(service, root, &path, &temp, &session)?;
    }
    pending_count(service)
}

fn pending_count(service: &SessionService) -> Result<usize> {
    let remaining: i64 = service.database().connection().query_row(
        "SELECT count(*) FROM chat_image_imports",
        [],
        |row| row.get(0),
    )?;
    Ok(usize::try_from(remaining).unwrap_or_default())
}

pub(crate) fn recover_chat_image_import(
    service: &SessionService,
    root: &Path,
    path: &str,
) -> Result<()> {
    let receipt = service
        .database()
        .connection()
        .query_row(
            "SELECT temp_path, session_id FROM chat_image_imports WHERE relative_path = ?1",
            [path],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    if let Some((temp, session)) = receipt {
        recover_import(service, root, path, &temp, &session)?;
    }
    Ok(())
}

fn recover_import(
    service: &SessionService,
    root: &Path,
    path: &str,
    temp: &str,
    session: &str,
) -> Result<()> {
    let database = service.database();
    database.with_immediate_tx(|tx| {
        if tx.execute(
            "UPDATE chat_image_imports SET attempt_count = attempt_count + 1 WHERE relative_path = ?1",
            [path],
        )? == 0 {
            return Ok(());
        }
        if !is_exact_attachment_path(path, session) || !is_exact_attachment_path(temp, session) {
            return Ok(());
        }
        let live: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM attachments WHERE relative_path IN (?1,?2))",
            params![path, temp],
            |row| row.get(0),
        )?;
        if live {
            return Ok(());
        }
        if remove_queued_file(root, temp).is_err() || remove_queued_file(root, path).is_err() {
            return Ok(());
        }
        tx.execute("DELETE FROM chat_image_imports WHERE relative_path = ?1", [path])?;
        Ok(())
    })
}

#[cfg(test)]
mod tests;
