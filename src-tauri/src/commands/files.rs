use std::io::Cursor;

use base64::{Engine, engine::general_purpose::STANDARD};
use qa_scribe_core::{
    attachments::{
        attachment_file_bytes, attachment_preview_data_url, delete_attachment_with_file,
        import_clipboard_screenshot_data_url,
    },
    domain::Attachment,
};
use tauri::{AppHandle, Manager, State, image::Image};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::{commands::CommandError, settings::AppState};

const MAX_CLIPBOARD_IMAGE_RGBA_BYTES: u64 = 25 * 1024 * 1024;

#[tauri::command]
#[specta::specta]
pub async fn import_clipboard_screenshot(
    app: AppHandle,
    session_id: String,
    entry_id: Option<String>,
    filename: String,
    data_url: String,
) -> Result<Attachment, CommandError> {
    attachment_task("Attachment import", move || {
        let state = app.state::<AppState>();
        state.with_service(|service| {
            import_clipboard_screenshot_data_url(
                service,
                state.app_data_dir(),
                &session_id,
                entry_id,
                filename,
                &data_url,
            )
        })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub fn delete_attachment(
    state: State<'_, AppState>,
    attachment_id: String,
) -> Result<bool, CommandError> {
    let app_data_dir = state.app_data_dir().clone();
    state
        .with_service(|service| delete_attachment_with_file(service, &app_data_dir, &attachment_id))
}

#[tauri::command]
#[specta::specta]
pub async fn read_clipboard_image_data_url(app: AppHandle) -> Result<Option<String>, CommandError> {
    attachment_task("Clipboard image read", move || {
        match app.clipboard().read_image() {
            Ok(image) => clipboard_image_to_png_data_url(&image).map(Some),
            Err(error) if clipboard_image_is_unavailable(&error) => Ok(None),
            Err(error) => Err(CommandError::internal(format!(
                "Clipboard image could not be read: {error}"
            ))),
        }
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_attachment_preview_data_url(
    app: AppHandle,
    attachment_id: String,
) -> Result<Option<String>, CommandError> {
    attachment_task("Attachment preview", move || {
        let state = app.state::<AppState>();
        state.with_service(|service| {
            attachment_preview_data_url(service, state.app_data_dir(), &attachment_id)
        })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn copy_attachment_image_to_clipboard(
    app: AppHandle,
    attachment_id: String,
) -> Result<(), CommandError> {
    attachment_task("Attachment clipboard copy", move || {
        let state = app.state::<AppState>();
        let (attachment, bytes) = state
            .with_service(|service| {
                attachment_file_bytes(service, state.app_data_dir(), &attachment_id)
            })?
            .ok_or_else(|| CommandError::not_found("Attachment was not found"))?;

        if let Some(mime_type) = &attachment.mime_type
            && !mime_type.starts_with("image/")
        {
            return Err(CommandError::validation(
                "Only image attachments can be copied as screenshots",
            ));
        }

        let decoded = decode_attachment_image(&bytes)?;
        let decoded = decoded.to_rgba8();
        let width = decoded.width();
        let height = decoded.height();
        let image = Image::new_owned(decoded.into_raw(), width, height);
        app.clipboard().write_image(&image).map_err(|error| {
            CommandError::internal(format!("Attachment image could not be copied: {error}"))
        })
    })
    .await
}

async fn attachment_task<T: Send + 'static>(
    operation: &'static str,
    action: impl FnOnce() -> Result<T, CommandError> + Send + 'static,
) -> Result<T, CommandError> {
    tauri::async_runtime::spawn_blocking(action)
        .await
        .map_err(|error| CommandError::internal(format!("{operation} task failed: {error}")))?
}

fn decode_attachment_image(bytes: &[u8]) -> Result<image::DynamicImage, CommandError> {
    let dimension_reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| {
            CommandError::internal("Attachment image could not be decoded for the clipboard")
        })?;
    let dimensions = dimension_reader.into_dimensions().map_err(|_| {
        CommandError::internal("Attachment image could not be decoded for the clipboard")
    })?;
    validate_image_bounds(dimensions.0, dimensions.1)?;

    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| {
            CommandError::internal("Attachment image could not be decoded for the clipboard")
        })?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(MAX_CLIPBOARD_IMAGE_RGBA_BYTES * 2);
    reader.limits(limits);
    reader.decode().map_err(|_| {
        CommandError::internal("Attachment image could not be decoded for the clipboard")
    })
}

// The WKWebView used on macOS does not expose `ClipboardItem`, so the
// frontend cannot write a text/html clipboard flavor through the web API.
// This command writes both flavors natively; `alt_text` is the plain-text
// fallback pasted into targets that do not accept HTML.
#[tauri::command]
#[specta::specta]
pub fn copy_html_to_clipboard(
    app: AppHandle,
    html: String,
    alt_text: String,
) -> Result<(), CommandError> {
    app.clipboard()
        .write_html(html, Some(alt_text))
        .map_err(|error| {
            CommandError::internal(format!("Rich content could not be copied: {error}"))
        })
}

fn clipboard_image_to_png_data_url(image: &Image<'_>) -> Result<String, CommandError> {
    validate_image_bounds(image.width(), image.height())?;
    let rgba_bytes = image.rgba();
    validate_rgba_byte_len(rgba_bytes.len() as u64)?;
    let rgba = image::ImageBuffer::<image::Rgba<u8>, Vec<u8>>::from_raw(
        image.width(),
        image.height(),
        rgba_bytes.to_vec(),
    )
    .ok_or_else(|| CommandError::internal("Clipboard image data was invalid"))?;
    let mut png = Vec::new();
    image::DynamicImage::ImageRgba8(rgba)
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|error| {
            CommandError::internal(format!("Clipboard image could not be encoded: {error}"))
        })?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(png)))
}

fn validate_image_bounds(width: u32, height: u32) -> Result<(), CommandError> {
    let rgba_bytes = u64::from(width)
        .checked_mul(u64::from(height))
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| CommandError::validation("Clipboard image dimensions are too large"))?;
    if rgba_bytes > MAX_CLIPBOARD_IMAGE_RGBA_BYTES {
        return Err(CommandError::validation(format!(
            "Clipboard image must be at most {MAX_CLIPBOARD_IMAGE_RGBA_BYTES} RGBA bytes"
        )));
    }
    Ok(())
}

fn validate_rgba_byte_len(rgba_bytes: u64) -> Result<(), CommandError> {
    if rgba_bytes > MAX_CLIPBOARD_IMAGE_RGBA_BYTES {
        return Err(CommandError::validation(format!(
            "Clipboard image must be at most {MAX_CLIPBOARD_IMAGE_RGBA_BYTES} RGBA bytes"
        )));
    }
    Ok(())
}

fn clipboard_image_is_unavailable(error: &tauri_plugin_clipboard_manager::Error) -> bool {
    matches!(
        error,
        tauri_plugin_clipboard_manager::Error::Clipboard(message)
            if message.contains("not available in the requested format")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::error::CommandErrorKind;

    #[test]
    fn attachment_worker_runs_import_preview_and_image_encoding_off_caller_thread() {
        let caller = std::thread::current().id();
        let directory =
            std::env::temp_dir().join(format!("attachment-worker-{}", uuid::Uuid::new_v4()));
        let worker_directory = directory.clone();
        let result =
            tauri::async_runtime::block_on(attachment_task("Attachment workflow", move || {
                assert_ne!(std::thread::current().id(), caller);
                let service = qa_scribe_core::services::SessionService::in_memory()?;
                let session = service.create_session(qa_scribe_core::domain::SessionDraft {
                    title: "Worker image".into(),
                    ..Default::default()
                })?;
                let source = clipboard_image_to_png_data_url(&Image::new(&[255, 0, 0, 255], 1, 1))?;
                let attachment = import_clipboard_screenshot_data_url(
                    &service,
                    &worker_directory,
                    &session.id,
                    None,
                    "pixel.png".into(),
                    &source,
                )?;
                let preview =
                    attachment_preview_data_url(&service, &worker_directory, &attachment.id)?
                        .expect("preview is present");
                assert_eq!(preview, source);
                let (_, bytes) =
                    attachment_file_bytes(&service, &worker_directory, &attachment.id)?
                        .expect("managed bytes are present");
                let image = decode_attachment_image(&bytes)?.to_rgba8();
                assert_eq!(image.as_raw(), &[255, 0, 0, 255]);
                Ok(())
            }));
        let _ = std::fs::remove_dir_all(directory);
        result.expect("real attachment workflow succeeds on the blocking worker");
    }

    #[test]
    fn attachment_worker_propagates_action_and_join_errors() {
        let action_error = tauri::async_runtime::block_on(attachment_task("Import", || {
            Err::<(), _>(CommandError::validation("invalid screenshot"))
        }))
        .expect_err("action error is preserved");
        assert_eq!(action_error.kind, CommandErrorKind::Validation);
        let join_error = tauri::async_runtime::block_on(attachment_task(
            "Preview",
            || -> Result<(), CommandError> {
                panic!("injected worker failure");
            },
        ))
        .expect_err("join error becomes an internal command error");
        assert_eq!(join_error.kind, CommandErrorKind::Internal);
        assert!(join_error.message.contains("Preview task failed"));
    }

    #[test]
    fn converts_clipboard_image_to_png_data_url() {
        let image = Image::new(&[255, 0, 0, 255], 1, 1);

        let data_url = clipboard_image_to_png_data_url(&image).expect("data URL");

        assert!(data_url.starts_with("data:image/png;base64,"));
        let encoded = data_url
            .strip_prefix("data:image/png;base64,")
            .expect("PNG data URL prefix");
        let bytes = STANDARD.decode(encoded).expect("PNG base64");
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn rejects_clipboard_image_with_invalid_rgba_length() {
        let image = Image::new(&[255, 0, 0, 255], 2, 1);

        let error = clipboard_image_to_png_data_url(&image).expect_err("invalid image");

        assert_eq!(error.kind, CommandErrorKind::Internal);
        assert_eq!(error.message, "Clipboard image data was invalid");
    }

    #[test]
    fn rejects_clipboard_image_over_rgba_bound_before_copying_pixels() {
        let image = Image::new(&[255, 0, 0, 255], 4096, 4096);

        let error = clipboard_image_to_png_data_url(&image).expect_err("oversized image");

        assert_eq!(error.kind, CommandErrorKind::Validation);
        assert!(error.message.contains("Clipboard image must be at most"));
    }

    #[test]
    fn rejects_clipboard_image_over_rgba_byte_bound_before_copying_pixels() {
        let error = validate_rgba_byte_len(MAX_CLIPBOARD_IMAGE_RGBA_BYTES + 1)
            .expect_err("oversized buffer");

        assert_eq!(error.kind, CommandErrorKind::Validation);
        assert!(error.message.contains("Clipboard image must be at most"));
    }

    #[test]
    fn rejects_oversized_attachment_dimensions_from_header_before_full_decode() {
        let mut oversized_gif = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x01\x4c\x00\x3b".to_vec();
        oversized_gif[6..10].fill(0xff);
        oversized_gif[24..28].fill(0xff);

        let error = decode_attachment_image(&oversized_gif)
            .expect_err("oversized image header should be rejected");

        assert_eq!(error.kind, CommandErrorKind::Validation);
        assert!(error.message.contains("Clipboard image must be at most"));
    }
}
