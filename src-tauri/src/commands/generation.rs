use qa_scribe_core::domain::{Draft, DraftCreate, DraftPatch};
use tauri::State;

use crate::{commands::CommandError, settings::AppState};

#[tauri::command]
pub fn create_draft(state: State<'_, AppState>, draft: DraftCreate) -> Result<Draft, CommandError> {
    state.with_service(|service| service.create_draft(draft))
}

#[tauri::command]
pub fn list_drafts(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<Draft>, CommandError> {
    state.with_service(|service| service.list_drafts(&session_id))
}

#[tauri::command]
pub fn update_draft(
    state: State<'_, AppState>,
    id: String,
    patch: DraftPatch,
) -> Result<Draft, CommandError> {
    state.with_service(|service| service.update_draft(&id, patch))
}

#[tauri::command]
pub fn delete_draft(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    state.with_service(|service| service.delete_draft(&id))
}
