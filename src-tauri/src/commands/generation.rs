use qa_scribe_core::domain::{
    AiRun, AiRunCreate, Draft, DraftCreate, DraftPatch, GenerationContext,
};
use tauri::State;

use crate::settings::AppState;

#[tauri::command]
pub fn create_generation_context(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<GenerationContext, String> {
    state.with_service(|service| service.create_generation_context(&session_id))
}

#[tauri::command]
pub fn create_ai_run(state: State<'_, AppState>, draft: AiRunCreate) -> Result<AiRun, String> {
    state.with_service(|service| service.create_ai_run(draft))
}

#[tauri::command]
pub fn create_draft(state: State<'_, AppState>, draft: DraftCreate) -> Result<Draft, String> {
    state.with_service(|service| service.create_draft(draft))
}

#[tauri::command]
pub fn list_drafts(state: State<'_, AppState>, session_id: String) -> Result<Vec<Draft>, String> {
    state.with_service(|service| service.list_drafts(&session_id))
}

#[tauri::command]
pub fn update_draft(
    state: State<'_, AppState>,
    id: String,
    patch: DraftPatch,
) -> Result<Draft, String> {
    state.with_service(|service| service.update_draft(&id, patch))
}
