use super::cleanup::{is_exact_attachment_path, remove_queued_file};
use crate::{Result, services::SessionService};
use rusqlite::params;
use std::path::Path;

/// Called at startup or after a failed import while holding the service mutex.
pub fn recover_chat_image_imports(service: &SessionService, root: &Path) -> Result<usize> {
    let database = service.database();
    let paths = database.connection().prepare("SELECT relative_path, temp_path, session_id FROM chat_image_imports ORDER BY attempt_count, relative_path LIMIT 50")?
        .query_map([], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (path, temp, session) in paths {
        database.with_immediate_tx(|tx| {
            tx.execute("UPDATE chat_image_imports SET attempt_count = attempt_count + 1 WHERE relative_path = ?1", [&path])?;
            if !is_exact_attachment_path(&path,&session) || !is_exact_attachment_path(&temp,&session) { return Ok(()); }
            let live: bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM attachments WHERE relative_path IN (?1,?2))",params![path,temp],|row|row.get(0))?;
            if live { return Ok(()); }
            if remove_queued_file(root,&temp).is_err() || remove_queued_file(root,&path).is_err() {return Ok(());}
            tx.execute("DELETE FROM chat_image_imports WHERE relative_path=?1",[&path])?;
            Ok(())
        })?;
    }
    Ok(database
        .connection()
        .query_row("SELECT count(*) FROM chat_image_imports", [], |row| {
            row.get(0)
        })?)
}
