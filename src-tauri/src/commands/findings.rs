use qa_scribe_core::domain::{Finding, FindingDraft, FindingPatch};
use tauri::State;

use crate::{commands::CommandError, settings::AppState};

#[tauri::command]
#[specta::specta]
pub fn create_finding(
    state: State<'_, AppState>,
    draft: FindingDraft,
) -> Result<Finding, CommandError> {
    state.with_service(|service| service.create_finding(draft))
}

#[tauri::command]
#[specta::specta]
pub fn list_findings(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<Finding>, CommandError> {
    state.with_service(|service| service.list_findings(&session_id))
}

#[tauri::command]
#[specta::specta]
pub fn update_finding(
    state: State<'_, AppState>,
    id: String,
    patch: FindingPatch,
) -> Result<Finding, CommandError> {
    state.with_service(|service| service.update_finding(&id, patch))
}

#[tauri::command]
#[specta::specta]
pub fn delete_finding(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    state.with_service(|service| service.delete_finding(&id))
}
