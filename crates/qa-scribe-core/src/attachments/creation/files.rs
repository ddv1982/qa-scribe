use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

use rusqlite::Connection;

use crate::{
    Result,
    attachments::{
        MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_FILENAME_BYTES, hex_sha256, is_exact_attachment_path,
        safe_filename,
    },
    domain::validate_sha256_hex,
    error::validation,
    services::session_service::creation::CreationAttemptImage,
};

pub(super) fn validate_slot(session: &str, slot: &CreationAttemptImage) -> Result<()> {
    if uuid::Uuid::parse_str(&slot.attachment_id).is_err()
        || slot.descriptor.filename.is_empty()
        || slot.descriptor.filename != safe_filename(&slot.descriptor.filename)
        || slot.descriptor.filename.len() > MAX_ATTACHMENT_FILENAME_BYTES
        || !(0..=MAX_ATTACHMENT_BYTES as u32).contains(&slot.descriptor.size_bytes)
        || !is_exact_attachment_path(&slot.relative_path, session)
        || slot.relative_path
            != format!(
                "attachments/{session}/{}_{}",
                slot.attachment_id, slot.descriptor.filename
            )
    {
        return Err(validation(
            "Creation reservation path or identity is invalid",
        ));
    }
    validate_sha256_hex("Creation reservation digest", &slot.descriptor.sha256)?;
    Ok(())
}

fn directory(path: &Path, create: bool) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => Ok(true),
        Ok(_) => Err(validation("Creation image parent must be a real directory")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            if !create {
                return Ok(false);
            }
            fs::create_dir(path)?;
            Ok(true)
        }
        Err(error) => Err(error.into()),
    }
}

pub(super) fn paths(
    root: &Path,
    slot: &CreationAttemptImage,
    create: bool,
) -> Result<Option<(PathBuf, PathBuf)>> {
    if !directory(root, false)? || !directory(&root.join("attachments"), create)? {
        return Ok(None);
    }
    let final_path = root.join(&slot.relative_path);
    let parent = final_path
        .parent()
        .ok_or_else(|| validation("Creation image parent is missing"))?;
    if !directory(parent, create)? {
        return Ok(None);
    }
    let temp = parent.join(format!(".{}.tmp", slot.attachment_id));
    Ok(Some((final_path, temp)))
}

pub(super) fn verify(path: &Path, slot: &CreationAttemptImage) -> Result<bool> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => metadata,
        Ok(_) => return Err(validation("Creation image target must be a regular file")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    if metadata.len() != slot.descriptor.size_bytes as u64 {
        return Err(validation(
            "Creation image size does not match its reservation",
        ));
    }
    if !contents_match(File::open(path)?, slot)? {
        return Err(validation(
            "Creation image digest does not match its reservation",
        ));
    }
    Ok(true)
}

fn contents_match(file: File, slot: &CreationAttemptImage) -> Result<bool> {
    if !file.metadata()?.file_type().is_file() {
        return Err(validation("Creation image target must be a regular file"));
    }
    let mut bytes = Vec::new();
    file.take(MAX_ATTACHMENT_BYTES + 1)
        .read_to_end(&mut bytes)?;
    Ok(bytes.len() as u64 == u64::from(slot.descriptor.size_bytes)
        && hex_sha256(&bytes) == slot.descriptor.sha256)
}

pub(super) fn stage(
    connection: &Connection,
    root: &Path,
    slot: &CreationAttemptImage,
    bytes: &[u8],
) -> Result<()> {
    let (final_path, temp) = paths(root, slot, true)?
        .ok_or_else(|| validation("Creation app data directory does not exist"))?;
    if verify(&final_path, slot)? {
        super::staging::remove(connection, root, slot)?;
        return Ok(());
    }
    let legacy_exists = verify(&temp, slot)?;
    let (temp, complete) = if legacy_exists {
        (temp, true)
    } else {
        match super::staging::temporary(connection, root, slot)? {
            Some(owned) => {
                // The committed directory receipt grants ownership of this private
                // image, including partial bytes left by a terminated writer.
                let complete = match File::open(&owned) {
                    Ok(file) => contents_match(file, slot)?,
                    Err(error) if error.kind() == io::ErrorKind::NotFound => false,
                    Err(error) => return Err(error.into()),
                };
                if !complete && owned.try_exists()? {
                    fs::remove_file(&owned)?;
                }
                (owned, complete)
            }
            None => (temp, false),
        }
    };
    if !complete {
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        #[cfg(test)]
        super::tests::cut("temp-created");
        if let Err(original) = write_temp(file, bytes) {
            return Err(match remove_temp(&temp) {
                Ok(()) => original,
                Err(cleanup) => {
                    io::Error::new(original.kind(), TempCleanupError { original, cleanup })
                }
            }
            .into());
        }
        #[cfg(test)]
        super::tests::cut("temp");
    }
    fs::rename(&temp, &final_path)?;
    #[cfg(unix)]
    File::open(final_path.parent().expect("validated image parent"))?.sync_all()?;
    #[cfg(test)]
    super::tests::cut("rename");
    super::staging::remove(connection, root, slot)?;
    Ok(())
}

fn write_temp(mut file: File, bytes: &[u8]) -> io::Result<()> {
    #[cfg(test)]
    if std::env::var("UC1_CUT").as_deref() == Ok("partial-write") {
        file.write_all(&bytes[..2])?;
        file.sync_all()?;
        super::tests::cut("partial-write");
    }
    #[cfg(test)]
    if let Some(write) = super::tests::io_failure::take_write() {
        return write(file, bytes);
    }
    file.write_all(bytes)?;
    file.sync_all()
}

#[derive(Debug, thiserror::Error)]
#[error("{original}; failed to remove newly created creation temp file: {cleanup}")]
struct TempCleanupError {
    #[source]
    original: io::Error,
    cleanup: io::Error,
}

fn remove_temp(path: &Path) -> io::Result<()> {
    #[cfg(test)]
    if let Some(remove) = super::tests::io_failure::take_remove() {
        return remove(path);
    }
    fs::remove_file(path)
}

pub(super) fn verify_final(root: &Path, slot: &CreationAttemptImage) -> Result<()> {
    let (path, _) = paths(root, slot, false)?
        .ok_or_else(|| validation("Prepared creation image is missing"))?;
    if !verify(&path, slot)? {
        return Err(validation("Prepared creation image is missing"));
    }
    Ok(())
}

pub(super) fn remove(root: &Path, slot: &CreationAttemptImage) -> Result<()> {
    let Some((final_path, temp)) = paths(root, slot, false)? else {
        return Ok(());
    };
    let final_exists = verify(&final_path, slot)?;
    let temp_exists = verify(&temp, slot)?;
    if final_exists {
        fs::remove_file(final_path)?;
    }
    if temp_exists {
        fs::remove_file(temp)?;
    }
    #[cfg(test)]
    super::tests::cut("unlink");
    Ok(())
}
