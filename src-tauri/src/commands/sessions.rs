use qa_scribe_core::{
    attachments::delete_session_with_attachment_files,
    domain::{AttachmentCleanupStatus, Session, SessionDraft, SessionNoteState, SessionPatch},
};
use tauri::{AppHandle, Manager, State};

use crate::{commands::CommandError, settings::AppState};

#[tauri::command]
#[specta::specta]
pub fn list_sessions(state: State<'_, AppState>) -> Result<Vec<Session>, CommandError> {
    state.with_service(|service| service.list_sessions())
}

#[tauri::command]
#[specta::specta]
pub fn list_recent_sessions(
    state: State<'_, AppState>,
    limit: u32,
) -> Result<Vec<Session>, CommandError> {
    state.with_service(|service| service.list_recent_sessions(limit))
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
pub fn open_session_note_state(
    state: State<'_, AppState>,
    id: String,
) -> Result<SessionNoteState, CommandError> {
    state.with_service(|service| service.open_session_note_state(&id))
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
pub async fn delete_session(
    app: AppHandle,
    id: String,
) -> Result<AttachmentCleanupStatus, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.with_service(|service| {
            delete_session_with_attachment_files(service, state.app_data_dir(), &id)
        })
    })
    .await
    .map_err(|error| CommandError::internal(format!("Session deletion task failed: {error}")))?
}

#[tauri::command]
#[specta::specta]
pub async fn retry_attachment_cleanup(
    app: AppHandle,
) -> Result<AttachmentCleanupStatus, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.with_service(|service| {
            qa_scribe_core::attachments::retry_attachment_cleanup(service, state.app_data_dir())
        })
    })
    .await
    .map_err(|error| CommandError::internal(format!("Attachment cleanup task failed: {error}")))?
}
