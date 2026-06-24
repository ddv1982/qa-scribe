use qa_scribe_core::{
    attachments::{
        attachment_file_bytes, attachment_preview_data_url, import_clipboard_screenshot_data_url,
        import_managed_attachment,
    },
    domain::Attachment,
    export::{ExportFormat, SessionExport, export_session as render_session_export},
};
use tauri::{AppHandle, State, image::Image};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::settings::AppState;

#[tauri::command]
pub fn export_session(
    state: State<'_, AppState>,
    session_id: String,
    format: ExportFormat,
) -> Result<SessionExport, String> {
    state.with_service(|service| render_session_export(service, &session_id, format))
}

#[tauri::command]
pub fn import_attachment(
    state: State<'_, AppState>,
    session_id: String,
    entry_id: Option<String>,
    source_path: String,
) -> Result<Attachment, String> {
    let app_data_dir = state.app_data_dir().clone();
    state.with_service(|service| {
        import_managed_attachment(service, &app_data_dir, &session_id, entry_id, source_path)
    })
}

#[tauri::command]
pub fn import_clipboard_screenshot(
    state: State<'_, AppState>,
    session_id: String,
    entry_id: Option<String>,
    filename: String,
    data_url: String,
) -> Result<Attachment, String> {
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
pub fn list_attachments(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<Attachment>, String> {
    state.with_service(|service| service.list_attachments(&session_id))
}

#[tauri::command]
pub fn get_attachment_preview_data_url(
    state: State<'_, AppState>,
    attachment_id: String,
) -> Result<Option<String>, String> {
    let app_data_dir = state.app_data_dir().clone();
    state
        .with_service(|service| attachment_preview_data_url(service, &app_data_dir, &attachment_id))
}

#[tauri::command]
pub fn copy_attachment_image_to_clipboard(
    app: AppHandle,
    state: State<'_, AppState>,
    attachment_id: String,
) -> Result<(), String> {
    let app_data_dir = state.app_data_dir().clone();
    let (attachment, bytes) = state
        .with_service(|service| attachment_file_bytes(service, &app_data_dir, &attachment_id))?
        .ok_or_else(|| "Attachment was not found".to_string())?;

    if let Some(mime_type) = &attachment.mime_type
        && !mime_type.starts_with("image/")
    {
        return Err("Only image attachments can be copied as screenshots".to_string());
    }

    let decoded = image::load_from_memory(&bytes)
        .map_err(|_| "Attachment image could not be decoded for the clipboard".to_string())?
        .to_rgba8();
    let width = decoded.width();
    let height = decoded.height();
    let image = Image::new_owned(decoded.into_raw(), width, height);
    app.clipboard()
        .write_image(&image)
        .map_err(|error| format!("Attachment image could not be copied: {error}"))
}
