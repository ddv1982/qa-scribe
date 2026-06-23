use qa_scribe_core::{
    attachments::{
        attachment_preview_data_url, import_clipboard_screenshot_data_url,
        import_managed_attachment,
    },
    domain::Attachment,
    export::{ExportFormat, SessionExport, export_session as render_session_export},
};
use tauri::State;

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
