use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    Result,
    domain::{Attachment, AttachmentDraft},
    error::validation,
    services::SessionService,
};

const MAX_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;

/// A UUIDv4 string is 36 characters; the on-disk basename is
/// `{attachment_id}_{filename}`, so this plus the `_` separator is the fixed
/// overhead every stored filename must leave room for.
const ATTACHMENT_ID_PREFIX_LENGTH: usize = 36 + 1;

/// Most filesystems (ext4, APFS, NTFS) cap a single path component at 255
/// bytes. `MAX_ATTACHMENT_FILENAME_BYTES` keeps the *stored* filename well
/// under `255 - ATTACHMENT_ID_PREFIX_LENGTH` so the UUID-prefixed on-disk
/// name (`{attachment_id}_{filename}`) never approaches that limit, turning
/// what would otherwise be a raw OS `ENAMETOOLONG` I/O error into a clean
/// validation error raised before any file is written.
const MAX_ATTACHMENT_FILENAME_BYTES: usize = 200;

const _: () = assert!(MAX_ATTACHMENT_FILENAME_BYTES + ATTACHMENT_ID_PREFIX_LENGTH <= 255);

#[derive(Debug, Default, Eq, PartialEq)]
pub struct AttachmentReconciliationReport {
    pub missing_files: Vec<String>,
    pub stray_files: Vec<String>,
}

pub fn import_managed_attachment(
    service: &SessionService,
    app_data_dir: impl AsRef<Path>,
    session_id: &str,
    entry_id: Option<String>,
    source_path: impl AsRef<Path>,
) -> Result<Attachment> {
    // Session/Entry ownership is validated by `import_managed_attachment_bytes`
    // below, which every caller of this function ultimately goes through; no
    // need to duplicate that check here before we even touch the filesystem.
    let source_path = source_path.as_ref();
    if !source_path.is_file() {
        return Err(validation("attachment source must be a file"));
    }

    let metadata = fs::metadata(source_path)?;
    if metadata.len() > MAX_ATTACHMENT_BYTES {
        return Err(validation(format!(
            "attachment must be at most {MAX_ATTACHMENT_BYTES} bytes"
        )));
    }

    let filename = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(safe_filename)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| validation("attachment filename is required"))?;
    let bytes = fs::read(source_path)?;
    import_managed_attachment_bytes(
        service,
        app_data_dir,
        session_id,
        entry_id,
        filename,
        guess_mime_type(source_path).map(str::to_string),
        bytes,
    )
}

pub fn import_clipboard_screenshot_data_url(
    service: &SessionService,
    app_data_dir: impl AsRef<Path>,
    session_id: &str,
    entry_id: Option<String>,
    filename: String,
    data_url: &str,
) -> Result<Attachment> {
    let (mime_type, encoded) = data_url
        .split_once(",")
        .ok_or_else(|| validation("clipboard screenshot data URL is invalid"))?;
    if !mime_type.starts_with("data:image/") || !mime_type.ends_with(";base64") {
        return Err(validation(
            "clipboard screenshot must be a base64 image data URL",
        ));
    }
    if base64_encoded_len_exceeds_decoded_limit(encoded.len(), MAX_ATTACHMENT_BYTES) {
        return Err(validation(format!(
            "attachment must be at most {MAX_ATTACHMENT_BYTES} bytes"
        )));
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| validation("clipboard screenshot data URL could not decode"))?;
    import_managed_attachment_bytes(
        service,
        app_data_dir,
        session_id,
        entry_id,
        filename,
        Some(
            mime_type
                .trim_start_matches("data:")
                .trim_end_matches(";base64")
                .to_string(),
        ),
        bytes,
    )
}

pub fn import_managed_attachment_bytes(
    service: &SessionService,
    app_data_dir: impl AsRef<Path>,
    session_id: &str,
    entry_id: Option<String>,
    filename: String,
    mime_type: Option<String>,
    bytes: Vec<u8>,
) -> Result<Attachment> {
    service
        .get_session(session_id)?
        .ok_or_else(|| crate::QaScribeError::NotFound(session_id.to_string()))?;
    if let Some(entry_id) = &entry_id {
        service.require_entry_in_session(entry_id, session_id)?;
    }
    if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err(validation(format!(
            "attachment must be at most {MAX_ATTACHMENT_BYTES} bytes"
        )));
    }

    let filename = safe_filename(&filename);
    if filename.is_empty() {
        return Err(validation("attachment filename is required"));
    }
    if filename.len() > MAX_ATTACHMENT_FILENAME_BYTES {
        return Err(validation(format!(
            "attachment filename must be at most {MAX_ATTACHMENT_FILENAME_BYTES} bytes"
        )));
    }
    let sha256 = hex_sha256(&bytes);
    let attachment_id = Uuid::new_v4().to_string();
    let relative_path = PathBuf::from("attachments")
        .join(session_id)
        .join(format!("{attachment_id}_{filename}"));
    let destination_path = app_data_dir.as_ref().join(&relative_path);
    if !is_safe_relative_path(&relative_path) {
        return Err(validation("attachment destination path is invalid"));
    }
    if let Some(parent) = destination_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp_path = destination_path.with_file_name(format!(".{attachment_id}.tmp"));
    fs::write(&temp_path, &bytes)?;
    if let Err(error) = fs::rename(&temp_path, &destination_path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error.into());
    }

    let result = service.create_attachment(AttachmentDraft {
        session_id: session_id.to_string(),
        entry_id,
        filename,
        mime_type,
        size_bytes: bytes.len() as i64,
        sha256,
        relative_path: relative_path.to_string_lossy().replace('\\', "/"),
    });
    if result.is_err() {
        let _ = fs::remove_file(destination_path);
    }
    result
}

pub fn delete_session_with_attachment_files(
    service: &SessionService,
    app_data_dir: impl AsRef<Path>,
    session_id: &str,
) -> Result<()> {
    // Delete the DB row first. If it fails (SQLITE_BUSY, I/O error, etc.),
    // nothing has been touched on disk yet, so the evidence files survive.
    // Only after the row is gone do we remove its files; if that cleanup
    // fails, the session is already gone from the DB, so it just leaves
    // stray files behind, which reconcile_attachment_files already detects
    // and reports without treating them as data loss.
    service.delete_session(session_id)?;
    let _ = delete_session_attachment_files(app_data_dir, session_id);
    Ok(())
}

pub fn delete_attachment_with_file(
    service: &SessionService,
    app_data_dir: impl AsRef<Path>,
    attachment_id: &str,
) -> Result<bool> {
    let Some(attachment) = service.get_attachment(attachment_id)? else {
        return Ok(true);
    };
    let relative_path = Path::new(&attachment.relative_path);
    if !is_safe_relative_path(relative_path) {
        return Err(validation("attachment path is invalid"));
    }
    if service.attachment_is_referenced(attachment_id)? {
        return Ok(false);
    }
    let path = app_data_dir.as_ref().join(relative_path);
    if path.exists() {
        // Remove the file first so a filesystem failure leaves the row intact
        // and the cleanup can be retried. If the later row delete fails, the
        // same retry can finish deleting the now-fileless, unreferenced row.
        fs::remove_file(path)?;
    }
    service.delete_attachment(attachment_id)?;
    Ok(true)
}

pub fn delete_session_attachment_files(
    app_data_dir: impl AsRef<Path>,
    session_id: &str,
) -> Result<()> {
    if !is_safe_path_component(session_id) {
        return Err(validation("session attachment directory is invalid"));
    }
    let path = app_data_dir.as_ref().join("attachments").join(session_id);
    if path.exists() {
        fs::remove_dir_all(path)?;
    }
    Ok(())
}

pub fn reconcile_attachment_files(
    service: &SessionService,
    app_data_dir: impl AsRef<Path>,
) -> Result<AttachmentReconciliationReport> {
    let app_data_dir = app_data_dir.as_ref();
    let mut expected_paths = HashSet::new();
    let mut missing_files = Vec::new();

    for session in service.list_sessions()? {
        for attachment in service.list_attachments(&session.id)? {
            let relative_path = PathBuf::from(&attachment.relative_path);
            if !is_safe_relative_path(&relative_path) {
                missing_files.push(attachment.relative_path);
                continue;
            }
            let normalized = relative_path.to_string_lossy().replace('\\', "/");
            expected_paths.insert(normalized.clone());
            if !app_data_dir.join(relative_path).is_file() {
                missing_files.push(normalized);
            }
        }
    }

    let mut stray_files = Vec::new();
    let attachments_root = app_data_dir.join("attachments");
    collect_stray_attachment_files(
        app_data_dir,
        &attachments_root,
        &expected_paths,
        &mut stray_files,
    )?;
    missing_files.sort();
    stray_files.sort();
    Ok(AttachmentReconciliationReport {
        missing_files,
        stray_files,
    })
}

pub fn attachment_preview_data_url(
    service: &SessionService,
    app_data_dir: impl AsRef<Path>,
    attachment_id: &str,
) -> Result<Option<String>> {
    let Some((attachment, bytes)) = attachment_file_bytes(service, app_data_dir, attachment_id)?
    else {
        return Ok(None);
    };
    let mime_type = attachment
        .mime_type
        .as_deref()
        .unwrap_or("application/octet-stream");
    Ok(Some(format!(
        "data:{mime_type};base64,{}",
        STANDARD.encode(bytes)
    )))
}

pub fn attachment_file_bytes(
    service: &SessionService,
    app_data_dir: impl AsRef<Path>,
    attachment_id: &str,
) -> Result<Option<(Attachment, Vec<u8>)>> {
    let Some(attachment) = service.get_attachment(attachment_id)? else {
        return Ok(None);
    };
    let relative_path = PathBuf::from(&attachment.relative_path);
    if !is_safe_relative_path(&relative_path) {
        return Err(validation("stored attachment path is invalid"));
    }
    let bytes = fs::read(app_data_dir.as_ref().join(relative_path))?;
    // Files are small (screenshots and text logs), so re-hashing on every read
    // is cheap; this catches on-disk corruption or tampering that a bare file
    // read would silently hand back as if nothing were wrong.
    if hex_sha256(&bytes) != attachment.sha256 {
        return Err(crate::QaScribeError::InvalidStoredValue {
            field: "attachment file bytes",
            value: format!(
                "Attachment file failed integrity check (sha256 mismatch for attachment {attachment_id})"
            ),
        });
    }
    Ok(Some((attachment, bytes)))
}

fn hex_sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn safe_filename(filename: &str) -> String {
    filename
        .chars()
        .map(|character| match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' => character,
            _ => '_',
        })
        .collect::<String>()
        .trim_matches('.')
        .to_string()
}

fn base64_encoded_len_exceeds_decoded_limit(encoded_len: usize, decoded_limit: u64) -> bool {
    encoded_len > max_base64_encoded_len(decoded_limit)
}

fn max_base64_encoded_len(decoded_limit: u64) -> usize {
    ((decoded_limit as usize).saturating_add(2) / 3) * 4
}

fn is_safe_relative_path(path: &Path) -> bool {
    path.components()
        .all(|component| matches!(component, Component::Normal(_)))
}

fn is_safe_path_component(value: &str) -> bool {
    !value.is_empty()
        && Path::new(value)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn collect_stray_attachment_files(
    app_data_dir: &Path,
    directory: &Path,
    expected_paths: &HashSet<String>,
    stray_files: &mut Vec<String>,
) -> Result<()> {
    if !directory.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_stray_attachment_files(app_data_dir, &path, expected_paths, stray_files)?;
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let Ok(relative_path) = path.strip_prefix(app_data_dir) else {
            continue;
        };
        let normalized = relative_path.to_string_lossy().replace('\\', "/");
        if !expected_paths.contains(&normalized) {
            stray_files.push(normalized);
        }
    }
    Ok(())
}

fn guess_mime_type(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
    {
        Some(extension) if extension == "png" => Some("image/png"),
        Some(extension) if extension == "jpg" || extension == "jpeg" => Some("image/jpeg"),
        Some(extension) if extension == "gif" => Some("image/gif"),
        Some(extension) if extension == "webp" => Some("image/webp"),
        Some(extension) if extension == "txt" || extension == "log" => Some("text/plain"),
        Some(extension) if extension == "json" => Some("application/json"),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
