use std::{
    fs, io,
    path::{Path, PathBuf},
};

use rusqlite::{Connection, OptionalExtension, params};

use crate::{Result, error::validation, services::session_service::creation::CreationAttemptImage};

use super::files;

struct Ownership {
    relative_path: String,
    device: String,
    inode: String,
}

fn read(connection: &Connection, slot: &CreationAttemptImage) -> Result<Option<Ownership>> {
    Ok(connection
        .query_row(
            "SELECT relative_path, device, inode FROM creation_staging WHERE attachment_id = ?1",
            [&slot.attachment_id],
            |row| {
                Ok(Ownership {
                    relative_path: row.get(0)?,
                    device: row.get(1)?,
                    inode: row.get(2)?,
                })
            },
        )
        .optional()?)
}

fn owned_directory(
    connection: &Connection,
    root: &Path,
    slot: &CreationAttemptImage,
    owned: &Ownership,
) -> Result<Option<PathBuf>> {
    let parent = Path::new(&slot.relative_path)
        .parent()
        .expect("validated image path");
    let relative = Path::new(&owned.relative_path);
    let name = relative
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let prefix = format!(".{}.", slot.attachment_id);
    let token = name
        .strip_prefix(&prefix)
        .and_then(|name| name.strip_suffix(".staging"));
    if relative.parent() != Some(parent)
        || token.is_none_or(|token| uuid::Uuid::parse_str(token).is_err())
    {
        return Err(validation("Creation staging ownership path is invalid"));
    }
    let borrowed: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM attachments WHERE relative_path = ?1 OR substr(relative_path, 1, length(?2)) = ?2)",
        params![owned.relative_path, format!("{}/", owned.relative_path)], |row| row.get(0),
    )?;
    if borrowed {
        return Err(validation(
            "Creation staging path belongs to another attachment",
        ));
    }
    let Some((final_path, _)) = files::paths(root, slot, false)? else {
        return Ok(None);
    };
    let path = final_path
        .parent()
        .expect("validated image parent")
        .join(name);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if !metadata.file_type().is_dir()
        || identity(&metadata) != Some((owned.device.clone(), owned.inode.clone()))
    {
        return Err(validation("Creation staging directory identity changed"));
    }
    Ok(Some(path))
}

#[cfg(unix)]
fn identity(metadata: &fs::Metadata) -> Option<(String, String)> {
    use std::os::unix::fs::MetadataExt;
    Some((metadata.dev().to_string(), metadata.ino().to_string()))
}

#[cfg(not(unix))]
fn identity(_: &fs::Metadata) -> Option<(String, String)> {
    None
}

// This transaction must commit before stage writes any image bytes. A crash before
// the receipt commits can leave only an empty directory, never an unowned image.
pub(super) fn reserve(
    connection: &Connection,
    root: &Path,
    slot: &CreationAttemptImage,
) -> Result<()> {
    let (final_path, legacy) = files::paths(root, slot, true)?
        .ok_or_else(|| validation("Creation app data directory does not exist"))?;
    if files::verify(&final_path, slot)? {
        return Ok(());
    }
    let legacy_exists = files::verify(&legacy, slot)?;
    if let Some(owned) = read(connection, slot)?
        && owned_directory(connection, root, slot, &owned)?.is_some()
    {
        return Ok(());
    }
    if legacy_exists {
        return Ok(());
    }
    // Stable filesystem identities are available on both shipped platform families.
    // Other platforms retain the existing verified-temp contract.
    if identity(&fs::metadata(
        final_path.parent().expect("validated parent"),
    )?)
    .is_none()
    {
        return Ok(());
    }
    let name = format!(".{}.{}.staging", slot.attachment_id, uuid::Uuid::new_v4());
    let path = final_path.parent().expect("validated parent").join(&name);
    fs::create_dir(&path)?;
    #[cfg(test)]
    super::tests::cut("namespace-created");
    let (device, inode) =
        identity(&fs::symlink_metadata(&path)?).expect("supported filesystem identity");
    #[cfg(unix)]
    fs::File::open(path.parent().expect("validated parent"))?.sync_all()?;
    let parent = Path::new(&slot.relative_path)
        .parent()
        .expect("validated image path");
    let relative_path = parent.join(name).to_string_lossy().replace('\\', "/");
    connection.execute(
        "INSERT INTO creation_staging (attachment_id, relative_path, device, inode) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(attachment_id) DO UPDATE SET relative_path=excluded.relative_path, device=excluded.device, inode=excluded.inode",
        params![slot.attachment_id, relative_path, device, inode],
    )?;
    Ok(())
}

pub(super) fn temporary(
    connection: &Connection,
    root: &Path,
    slot: &CreationAttemptImage,
) -> Result<Option<PathBuf>> {
    read(connection, slot)?
        .map(|owned| {
            let directory = owned_directory(connection, root, slot, &owned)?
                .ok_or_else(|| validation("Owned creation staging directory is missing"))?;
            validate_contents(&directory)?;
            Ok(directory.join("image.tmp"))
        })
        .transpose()
}

fn validate_contents(directory: &Path) -> Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if entry.file_name() != "image.tmp" {
            return Err(validation("Creation staging contains an unexpected file"));
        }
        let metadata = fs::symlink_metadata(entry.path())?;
        if !metadata.file_type().is_file() {
            return Err(validation("Creation staging image must be a regular file"));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.nlink() != 1 {
                return Err(validation(
                    "Creation staging image has another filesystem owner",
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn validate(
    connection: &Connection,
    root: &Path,
    slot: &CreationAttemptImage,
) -> Result<()> {
    if let Some(owned) = read(connection, slot)?
        && let Some(directory) = owned_directory(connection, root, slot, &owned)?
    {
        validate_contents(&directory)?;
    }
    Ok(())
}

pub(super) fn remove(
    connection: &Connection,
    root: &Path,
    slot: &CreationAttemptImage,
) -> Result<()> {
    if let Some(owned) = read(connection, slot)? {
        if let Some(directory) = owned_directory(connection, root, slot, &owned)? {
            validate_contents(&directory)?;
            let temporary = directory.join("image.tmp");
            match fs::remove_file(temporary) {
                Ok(()) => (),
                Err(error) if error.kind() == io::ErrorKind::NotFound => (),
                Err(error) => return Err(error.into()),
            }
            #[cfg(test)]
            super::tests::cut("staging-unlink");
            fs::remove_dir(directory)?;
            #[cfg(test)]
            super::tests::cut("staging-remove-dir");
        }
        connection.execute(
            "DELETE FROM creation_staging WHERE attachment_id = ?1",
            [&slot.attachment_id],
        )?;
    }
    Ok(())
}
