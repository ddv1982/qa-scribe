use qa_scribe_core::domain::{Entry, EntryDraft, EntryPatch};
use tauri::State;

use crate::{commands::CommandError, settings::AppState};

#[tauri::command]
pub fn create_entry(state: State<'_, AppState>, draft: EntryDraft) -> Result<Entry, CommandError> {
    state.with_service(|service| service.create_entry(draft))
}

#[tauri::command]
pub fn list_entries(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<Entry>, CommandError> {
    state.with_service(|service| service.list_entries(&session_id))
}

#[tauri::command]
pub fn update_entry(
    state: State<'_, AppState>,
    id: String,
    patch: EntryPatch,
) -> Result<Entry, CommandError> {
    state.with_service(|service| service.update_entry(&id, patch))
}
