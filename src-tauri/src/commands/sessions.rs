use qa_scribe_core::{
    attachments::delete_session_attachment_files,
    domain::{Session, SessionDraft, SessionPatch},
};
use tauri::State;

use crate::settings::AppState;

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>) -> Result<Vec<Session>, String> {
    state.with_service(|service| service.list_sessions())
}

#[tauri::command]
pub fn create_session(state: State<'_, AppState>, draft: SessionDraft) -> Result<Session, String> {
    state.with_service(|service| service.create_session(draft))
}

#[tauri::command]
pub fn get_session(state: State<'_, AppState>, id: String) -> Result<Option<Session>, String> {
    state.with_service(|service| service.get_session(&id))
}

#[tauri::command]
pub fn reopen_session(state: State<'_, AppState>, id: String) -> Result<Session, String> {
    state.with_service(|service| service.reopen_session(&id))
}

#[tauri::command]
pub fn update_session(
    state: State<'_, AppState>,
    id: String,
    patch: SessionPatch,
) -> Result<Session, String> {
    state.with_service(|service| service.update_session(&id, patch))
}

#[tauri::command]
pub fn delete_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let app_data_dir = state.app_data_dir().clone();
    state.with_service(|service| service.delete_session(&id))?;
    delete_session_attachment_files(app_data_dir, &id).map_err(crate::settings::command_error)
}
