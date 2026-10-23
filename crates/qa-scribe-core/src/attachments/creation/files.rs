use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

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

fn paths(
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

fn verify(path: &Path, slot: &CreationAttemptImage) -> Result<bool> {
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
    let file = File::open(path)?;
    if !file.metadata()?.file_type().is_file() {
        return Err(validation("Creation image target must be a regular file"));
    }
    let mut bytes = Vec::new();
    file.take(MAX_ATTACHMENT_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 != u64::from(slot.descriptor.size_bytes)
        || hex_sha256(&bytes) != slot.descriptor.sha256
    {
        return Err(validation(
            "Creation image digest does not match its reservation",
        ));
    }
    Ok(true)
}

pub(super) fn stage(root: &Path, slot: &CreationAttemptImage, bytes: &[u8]) -> Result<()> {
    let (final_path, temp) = paths(root, slot, true)?
        .ok_or_else(|| validation("Creation app data directory does not exist"))?;
    if verify(&final_path, slot)? {
        return Ok(());
    }
    if !verify(&temp, slot)? {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        #[cfg(test)]
        super::tests::cut("temp");
    }
    fs::rename(&temp, &final_path)?;
    #[cfg(unix)]
    File::open(final_path.parent().expect("validated image parent"))?.sync_all()?;
    #[cfg(test)]
    super::tests::cut("rename");
    Ok(())
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
