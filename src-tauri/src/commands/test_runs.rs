use qa_scribe_core::domain::{
    TestCaseResult, TestRun, TestRunCase, TestRunCaseDraft, TestRunSummary,
};
use tauri::State;

use crate::{commands::CommandError, settings::AppState};

#[tauri::command]
#[specta::specta]
pub fn start_test_run(
    state: State<'_, AppState>,
    draft_id: String,
    cases: Vec<TestRunCaseDraft>,
) -> Result<TestRun, CommandError> {
    state.with_service(|service| service.start_test_run(&draft_id, cases))
}

#[tauri::command]
#[specta::specta]
pub fn get_test_run(state: State<'_, AppState>, run_id: String) -> Result<TestRun, CommandError> {
    state.with_service(|service| service.get_test_run(&run_id))
}

#[tauri::command]
#[specta::specta]
pub fn list_test_runs(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<TestRunSummary>, CommandError> {
    state.with_service(|service| service.list_test_runs(&session_id))
}

#[tauri::command]
#[specta::specta]
pub fn set_test_case_result(
    state: State<'_, AppState>,
    case_id: String,
    result: TestCaseResult,
    remark: Option<String>,
) -> Result<TestRunCase, CommandError> {
    state.with_service(|service| service.set_test_case_result(&case_id, result, remark))
}

#[tauri::command]
#[specta::specta]
pub fn link_test_case_finding(
    state: State<'_, AppState>,
    case_id: String,
    finding_id: Option<String>,
) -> Result<TestRunCase, CommandError> {
    state.with_service(|service| service.link_test_case_finding(&case_id, finding_id))
}

#[tauri::command]
#[specta::specta]
pub fn delete_test_run(state: State<'_, AppState>, run_id: String) -> Result<(), CommandError> {
    state.with_service(|service| service.delete_test_run(&run_id))
}
