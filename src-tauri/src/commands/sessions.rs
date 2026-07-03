use qa_scribe_core::{
    attachments::delete_session_with_attachment_files,
    domain::{Session, SessionDraft, SessionPatch},
};
use tauri::State;

use crate::{commands::CommandError, settings::AppState};

#[tauri::command]
#[specta::specta]
pub fn list_sessions(state: State<'_, AppState>) -> Result<Vec<Session>, CommandError> {
    state.with_service(|service| service.list_sessions())
}

#[tauri::command]
#[specta::specta]
pub fn create_session(
    state: State<'_, AppState>,
    draft: SessionDraft,
) -> Result<Session, CommandError> {
    state.with_service(|service| service.create_session(draft))
}

#[tauri::command]
#[specta::specta]
pub fn reopen_session(state: State<'_, AppState>, id: String) -> Result<Session, CommandError> {
    state.with_service(|service| service.reopen_session(&id))
}

#[tauri::command]
#[specta::specta]
pub fn update_session(
    state: State<'_, AppState>,
    id: String,
    patch: SessionPatch,
) -> Result<Session, CommandError> {
    state.with_service(|service| service.update_session(&id, patch))
}

#[tauri::command]
#[specta::specta]
pub fn delete_session(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    let app_data_dir = state.app_data_dir().clone();
    state.with_service(|service| delete_session_with_attachment_files(service, app_data_dir, &id))
}
