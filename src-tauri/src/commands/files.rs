use std::io::Cursor;

use base64::{Engine, engine::general_purpose::STANDARD};
use qa_scribe_core::{
    attachments::{
        attachment_file_bytes, attachment_preview_data_url, import_clipboard_screenshot_data_url,
    },
    domain::Attachment,
    export::{ExportFormat, SessionExport, export_session as render_session_export},
};
use tauri::{AppHandle, State, image::Image};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::{commands::CommandError, settings::AppState};

#[tauri::command]
#[specta::specta]
pub fn export_session(
    state: State<'_, AppState>,
    session_id: String,
    format: ExportFormat,
) -> Result<SessionExport, CommandError> {
    state.with_service(|service| render_session_export(service, &session_id, format))
}

#[tauri::command]
#[specta::specta]
pub fn import_clipboard_screenshot(
    state: State<'_, AppState>,
    session_id: String,
    entry_id: Option<String>,
    filename: String,
    data_url: String,
) -> Result<Attachment, CommandError> {
    let app_data_dir = state.app_data_dir().clone();
    state.with_service(|service| {
        import_clipboard_screenshot_data_url(
            service,
            &app_data_dir,
            &session_id,
            entry_id,
            filename,
            &data_url,
        )
    })
}

#[tauri::command]
#[specta::specta]
pub async fn read_clipboard_image_data_url(app: AppHandle) -> Result<Option<String>, CommandError> {
    let read_result = tauri::async_runtime::spawn_blocking(move || {
        app.clipboard().read_image().map(|image| image.to_owned())
    })
    .await
    .map_err(|error| {
        CommandError::internal(format!("Clipboard image read task failed: {error}"))
    })?;

    match read_result {
        Ok(image) => clipboard_image_to_png_data_url(&image).map(Some),
        Err(error) if clipboard_image_is_unavailable(&error) => Ok(None),
        Err(error) => Err(CommandError::internal(format!(
            "Clipboard image could not be read: {error}"
        ))),
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_attachment_preview_data_url(
    state: State<'_, AppState>,
    attachment_id: String,
) -> Result<Option<String>, CommandError> {
    let app_data_dir = state.app_data_dir().clone();
    state
        .with_service(|service| attachment_preview_data_url(service, &app_data_dir, &attachment_id))
}

#[tauri::command]
#[specta::specta]
pub fn copy_attachment_image_to_clipboard(
    app: AppHandle,
    state: State<'_, AppState>,
    attachment_id: String,
) -> Result<(), CommandError> {
    let app_data_dir = state.app_data_dir().clone();
    let (attachment, bytes) = state
        .with_service(|service| attachment_file_bytes(service, &app_data_dir, &attachment_id))?
        .ok_or_else(|| CommandError::not_found("Attachment was not found"))?;

    if let Some(mime_type) = &attachment.mime_type
        && !mime_type.starts_with("image/")
    {
        return Err(CommandError::validation(
            "Only image attachments can be copied as screenshots",
        ));
    }

    let decoded = image::load_from_memory(&bytes)
        .map_err(|_| {
            CommandError::internal("Attachment image could not be decoded for the clipboard")
        })?
        .to_rgba8();
    let width = decoded.width();
    let height = decoded.height();
    let image = Image::new_owned(decoded.into_raw(), width, height);
    app.clipboard().write_image(&image).map_err(|error| {
        CommandError::internal(format!("Attachment image could not be copied: {error}"))
    })
}

fn clipboard_image_to_png_data_url(image: &Image<'_>) -> Result<String, CommandError> {
    let rgba = image::ImageBuffer::<image::Rgba<u8>, Vec<u8>>::from_raw(
        image.width(),
        image.height(),
        image.rgba().to_vec(),
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
}
