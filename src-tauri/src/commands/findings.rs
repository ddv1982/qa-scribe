use qa_scribe_core::domain::{EvidenceLink, EvidenceLinkDraft, Finding, FindingDraft};
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
pub fn create_evidence_link(
    state: State<'_, AppState>,
    draft: EvidenceLinkDraft,
) -> Result<EvidenceLink, String> {
    state.with_service(|service| service.create_evidence_link(draft))
}
