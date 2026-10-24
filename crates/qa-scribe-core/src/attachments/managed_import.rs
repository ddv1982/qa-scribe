use std::{
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

use super::{
    MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_FILENAME_BYTES, hex_sha256, is_exact_attachment_path,
    is_safe_relative_path, safe_filename,
};
use crate::{Result, domain::AttachmentDraft, error::validation};

pub(super) struct PreparedManagedAttachment {
    pub draft: AttachmentDraft,
    pub temp_relative: String,
    bytes: Vec<u8>,
}

impl PreparedManagedAttachment {
    pub fn new(mut draft: AttachmentDraft, bytes: Vec<u8>) -> Result<Self> {
        if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
            return Err(validation(format!(
                "attachment must be at most {MAX_ATTACHMENT_BYTES} bytes"
            )));
        }

        let filename = safe_filename(&draft.filename);
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
            .join(&draft.session_id)
            .join(format!("{attachment_id}_{filename}"));
        if !is_safe_relative_path(&relative_path)
            || !is_exact_attachment_path(&relative_path.to_string_lossy(), &draft.session_id)
        {
            return Err(validation("attachment destination path is invalid"));
        }
        let temp_relative = relative_path.with_file_name(format!(".{attachment_id}.tmp"));
        draft.filename = filename;
        draft.size_bytes = bytes.len() as i64;
        draft.sha256 = sha256;
        draft.relative_path = relative_path.to_string_lossy().replace('\\', "/");
        Ok(Self {
            draft,
            temp_relative: temp_relative.to_string_lossy().into_owned(),
            bytes,
        })
    }

    pub fn write(&self, app_data_dir: &Path) -> Result<()> {
        let destination_path = app_data_dir.join(&self.draft.relative_path);
        let temp_path = app_data_dir.join(&self.temp_relative);
        let bytes = &self.bytes;
        let mut staged = false;
        let mut published = false;
        let result = (|| {
            fs::create_dir_all(app_data_dir)?;
            for directory in [
                app_data_dir.join("attachments"),
                destination_path.parent().unwrap().to_path_buf(),
            ] {
                match fs::create_dir(&directory) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(error) => return Err(error.into()),
                }
                if !fs::symlink_metadata(&directory)?.file_type().is_dir() {
                    return Err(validation(
                        "Attachment import directory must be a real directory",
                    ));
                }
            }
            use std::io::Write;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp_path)?;
            staged = true;
            file.write_all(bytes)?;
            file.sync_all()?;
            fs::rename(&temp_path, &destination_path)?;
            staged = false;
            published = true;
            #[cfg(unix)]
            fs::File::open(destination_path.parent().unwrap())?.sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            if staged {
                let _ = fs::remove_file(&temp_path);
            }
            if published {
                let _ = fs::remove_file(&destination_path);
            }
        }
        result
    }
}
