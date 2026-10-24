use std::{
    io::Cursor,
    path::{Path, PathBuf},
    sync::Arc,
};

use image::{ImageFormat, ImageReader};

use super::{decode_image_data_url, managed_attachment_bytes};
use crate::{
    Result,
    domain::{Attachment, ChatRevision, ChatState},
    error::validation,
    services::SessionService,
};

pub const MAX_CHAT_IMAGE_PIXELS: u64 = 40_000_000;
pub const MAX_CHAT_IMAGE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_CHAT_TURN_IMAGE_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_CHAT_TURN_IMAGES: usize = 4;
pub const MAX_CHAT_REPLAY_IMAGES: usize = 16;
pub const MAX_CHAT_REPLAY_IMAGE_BYTES: usize = 40 * 1024 * 1024;

#[derive(Clone)]
pub struct ChatInputImage {
    pub(crate) path: PathBuf,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) mime_type: String,
    pub(crate) bytes: Arc<[u8]>,
}

impl std::fmt::Debug for ChatInputImage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChatInputImage")
            .field("mime_type", &self.mime_type)
            .field("size_bytes", &self.bytes.len())
            .finish_non_exhaustive()
    }
}

pub fn validate_chat_image(mime_type: &str, bytes: &[u8]) -> Result<(u32, u32)> {
    if bytes.len() > MAX_CHAT_IMAGE_BYTES {
        return Err(validation("Chat images must be at most 10 MiB each"));
    }
    let expected = match mime_type {
        "image/png" => ImageFormat::Png,
        "image/jpeg" => ImageFormat::Jpeg,
        "image/webp" => ImageFormat::WebP,
        "image/gif" => ImageFormat::Gif,
        _ => return Err(validation("Chat images must be PNG, JPEG, WebP or GIF")),
    };
    let format =
        image::guess_format(bytes).map_err(|_| validation("Chat image could not be decoded"))?;
    if format != expected {
        return Err(validation("Chat image MIME type does not match its pixels"));
    }
    let (width, height) = ImageReader::with_format(Cursor::new(bytes), format)
        .into_dimensions()
        .map_err(|_| validation("Chat image dimensions could not be decoded"))?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_CHAT_IMAGE_PIXELS {
        return Err(validation(
            "Chat images must contain 1 to 40 million pixels",
        ));
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(MAX_CHAT_IMAGE_PIXELS * 8);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|_| validation("Chat image pixels could not be decoded"))?;
    Ok((width, height))
}

pub fn import_chat_image_data_url(
    service: &SessionService,
    app_data_dir: impl AsRef<Path>,
    scope: ChatRevision,
    filename: String,
    data_url: &str,
) -> Result<ChatState> {
    let prepared = PreparedChatImageImport::decode(scope, filename, data_url)?;
    let result = (|| {
        prepared.reserve(service)?;
        prepared.write(app_data_dir.as_ref())?;
        prepared.commit(service)
    })();
    if result.is_err() {
        let _ = prepared.recover(service, app_data_dir.as_ref());
    }
    result
}

pub struct PreparedChatImageImport {
    scope: ChatRevision,
    file: super::managed_import::PreparedManagedAttachment,
}

impl PreparedChatImageImport {
    pub fn decode(scope: ChatRevision, filename: String, data_url: &str) -> Result<Self> {
        if data_url.len() > MAX_CHAT_IMAGE_BYTES.div_ceil(3) * 4 + 64 {
            return Err(validation("Chat images must be at most 10 MiB each"));
        }
        let (mime_type, bytes) = decode_image_data_url(data_url)?;
        validate_chat_image(&mime_type, &bytes)?;
        let file = super::managed_import::PreparedManagedAttachment::new(
            crate::domain::AttachmentDraft {
                session_id: scope.session_id.clone(),
                entry_id: None,
                filename,
                mime_type: Some(mime_type),
                size_bytes: 0,
                sha256: String::new(),
                relative_path: String::new(),
            },
            bytes,
        )?;
        Ok(Self { scope, file })
    }

    pub fn reserve(&self, service: &SessionService) -> Result<()> {
        service.reserve_chat_image_import(&self.scope, &self.file.draft, &self.file.temp_relative)
    }

    pub fn write(&self, app_data_dir: &Path) -> Result<()> {
        self.file.write(app_data_dir)
    }

    pub fn commit(&self, service: &SessionService) -> Result<ChatState> {
        service.append_imported_chat_image(&self.scope, self.file.draft.clone())
    }

    pub fn recover(&self, service: &SessionService, app_data_dir: &Path) -> Result<()> {
        super::chat_imports::recover_chat_image_import(
            service,
            app_data_dir,
            &self.file.draft.relative_path,
        )
    }
}

pub fn resolve_chat_image(
    service: &SessionService,
    app_data_dir: &Path,
    session_id: &str,
    attachment_id: &str,
) -> Result<ChatInputImage> {
    let attachment = chat_image_source(service, session_id, attachment_id)?;
    resolve_chat_image_source(app_data_dir, attachment)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChatImageSource(Attachment);

pub fn chat_image_source(
    service: &SessionService,
    session_id: &str,
    attachment_id: &str,
) -> Result<ChatImageSource> {
    let attachment = service
        .get_attachment(attachment_id)?
        .ok_or_else(|| validation("Chat image is missing"))?;
    if attachment.session_id != session_id
        || !super::is_exact_attachment_path(&attachment.relative_path, session_id)
    {
        return Err(validation(
            "Chat image must be a managed file in this Session",
        ));
    }
    if attachment.size_bytes < 0 || attachment.size_bytes as u64 > MAX_CHAT_IMAGE_BYTES as u64 {
        return Err(validation("Chat images must be at most 10 MiB each"));
    }
    Ok(ChatImageSource(attachment))
}

pub fn resolve_chat_image_source(
    app_data_dir: &Path,
    source: ChatImageSource,
) -> Result<ChatInputImage> {
    let attachment = source.0;
    let root = app_data_dir.canonicalize()?;
    let path = app_data_dir
        .join(&attachment.relative_path)
        .canonicalize()?;
    if path != root.join(&attachment.relative_path) {
        return Err(validation(
            "Chat image path escapes its managed Session directory",
        ));
    }
    let bytes = managed_attachment_bytes(app_data_dir, &attachment)?;
    let mime_type = attachment
        .mime_type
        .ok_or_else(|| validation("Chat image MIME type is missing"))?;
    let (width, height) = validate_chat_image(&mime_type, &bytes)?;
    Ok(ChatInputImage {
        path,
        width,
        height,
        mime_type,
        bytes: bytes.into(),
    })
}
