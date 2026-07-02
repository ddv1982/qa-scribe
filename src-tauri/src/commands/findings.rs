use qa_scribe_core::domain::{Finding, FindingDraft, FindingPatch};
use tauri::State;

use crate::settings::AppState;

#[tauri::command]
pub fn create_finding(state: State<'_, AppState>, draft: FindingDraft) -> Result<Finding, String> {
    state.with_service(|service| service.create_finding(draft))
}

#[tauri::command]
pub fn list_findings(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<Finding>, String> {
    state.with_service(|service| service.list_findings(&session_id))
}

#[tauri::command]
pub fn update_finding(
    state: State<'_, AppState>,
    id: String,
    patch: FindingPatch,
) -> Result<Finding, String> {
    state.with_service(|service| service.update_finding(&id, patch))
}

#[tauri::command]
pub fn delete_finding(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.with_service(|service| service.delete_finding(&id))
}
