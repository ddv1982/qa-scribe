use std::{fs, io, path::Path};

use rusqlite::params;

use crate::{Result, domain::AttachmentCleanupStatus, error::validation, services::SessionService};

const CLEANUP_BATCH_SIZE: usize = 50;

pub fn delete_session_with_attachment_files(
    service: &SessionService,
    app_data_dir: impl AsRef<Path>,
    session_id: &str,
) -> Result<AttachmentCleanupStatus> {
    // Only failure before commit is an ordinary deletion error.
    service.delete_session(session_id)?;
    retry_attachment_cleanup(service, app_data_dir)
}

/// Attempts at most 50 queued paths, rotating failures behind unattempted work.
/// Database failures mean status is unavailable, not that deletion rolled back.
pub fn retry_attachment_cleanup(
    service: &SessionService,
    app_data_dir: impl AsRef<Path>,
) -> Result<AttachmentCleanupStatus> {
    let pending_files = cleanup_batch(service, app_data_dir.as_ref()).ok();
    Ok(AttachmentCleanupStatus { pending_files })
}

fn cleanup_batch(service: &SessionService, app_data_dir: &Path) -> Result<u32> {
    let database = service.database();
    let paths = {
        let mut statement = database.connection().prepare(
            "SELECT relative_path, session_id FROM attachment_cleanup
             ORDER BY attempt_count, relative_path LIMIT ?1",
        )?;
        statement
            .query_map([CLEANUP_BATCH_SIZE as i64], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
    };
    for (relative_path, session_id) in paths {
        // Serialize ownership checks and unlink against all database writers.
        // A crash after unlink but before commit leaves retryable missing intent.
        database.with_immediate_tx(|tx| {
            let queued: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM attachment_cleanup
                 WHERE relative_path = ?1 AND session_id = ?2)",
                params![relative_path, session_id],
                |row| row.get(0),
            )?;
            if !queued {
                return Ok(());
            }
            tx.execute(
                "UPDATE attachment_cleanup SET attempt_count = attempt_count + 1
                 WHERE relative_path = ?1",
                [&relative_path],
            )?;
            if !is_exact_attachment_path(&relative_path, &session_id) {
                return Ok(());
            }
            let live: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ?1)
                     OR EXISTS(SELECT 1 FROM attachments WHERE relative_path = ?2)",
                params![session_id, relative_path],
                |row| row.get(0),
            )?;
            if live || remove_queued_file(app_data_dir, &relative_path).is_err() {
                return Ok(());
            }
            tx.execute(
                "DELETE FROM attachment_cleanup WHERE relative_path = ?1",
                [&relative_path],
            )?;
            Ok(())
        })?;
    }
    let count: i64 =
        database
            .connection()
            .query_row("SELECT COUNT(*) FROM attachment_cleanup", [], |row| {
                row.get(0)
            })?;
    u32::try_from(count).map_err(|_| validation("attachment cleanup count exceeds supported range"))
}

pub(crate) fn is_exact_attachment_path(relative_path: &str, session_id: &str) -> bool {
    let parts: Vec<_> = relative_path.split('/').collect();
    parts.len() == 3
        && parts[0] == "attachments"
        && parts[1] == session_id
        && parts.iter().all(|part| safe_component(part))
}

fn safe_component(value: &str) -> bool {
    !value.is_empty() && value != "." && value != ".." && !value.contains(['/', '\\', ':', '\0'])
}

// symlink_metadata never follows stationary symlinks, including broken ones.
fn directory_present(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => Ok(true),
        Ok(_) => Err(validation(
            "attachment cleanup parent must be a real directory",
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

fn remove_queued_file(app_data_dir: &Path, relative_path: &str) -> Result<()> {
    let path = app_data_dir.join(relative_path);
    let parent = path
        .parent()
        .expect("validated three-component attachment path");
    if !directory_present(&app_data_dir.join("attachments"))? || !directory_present(parent)? {
        return Ok(());
    }
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_file() => fs::remove_file(&path)?,
        Ok(_) => {
            return Err(validation(
                "attachment cleanup target must be a regular file",
            ));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    // Never traverse unknown siblings or recursively remove a directory.
    let _ = fs::remove_dir(parent);
    Ok(())
}

/// Compatibility helper without database ownership: removes only an empty
/// real Session directory. Use the outbox APIs to remove managed files.
pub fn delete_session_attachment_files(
    app_data_dir: impl AsRef<Path>,
    session_id: &str,
) -> Result<()> {
    if !safe_component(session_id) {
        return Err(validation("session attachment directory is invalid"));
    }
    let root = app_data_dir.as_ref().join("attachments");
    let parent = root.join(session_id);
    if directory_present(&root)? && directory_present(&parent)? {
        fs::remove_dir(parent)?;
    }
    Ok(())
}
