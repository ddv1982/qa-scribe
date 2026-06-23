use serde::Serialize;
use tauri::State;

use crate::jobs::JobStore;
use crate::path_access::PathAccess;
use crate::settings::AppState;

#[tauri::command]
pub fn get_app_status() -> qa_scribe_core::AppStatus {
    qa_scribe_core::app_status()
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandShellStatus {
    pub app_data_dir: String,
    pub database_filename: String,
    pub native_permissions: Vec<String>,
    pub active_job_count: usize,
    pub granted_path_count: usize,
    pub implemented_commands: Vec<&'static str>,
    pub deferred_commands: Vec<&'static str>,
}

#[tauri::command]
pub fn get_command_shell_status(
    state: State<'_, AppState>,
    jobs: State<'_, JobStore>,
    path_access: State<'_, PathAccess>,
) -> CommandShellStatus {
    CommandShellStatus {
        app_data_dir: state.app_data_dir().display().to_string(),
        database_filename: "qa-scribe.sqlite".to_string(),
        native_permissions: Vec::new(),
        active_job_count: jobs.len(),
        granted_path_count: path_access.len(),
        implemented_commands: vec![
            "settings",
            "sessions",
            "entries",
            "entry_generation_selection",
            "findings",
            "evidence_links",
            "generation_contexts",
            "ai_runs",
            "drafts",
            "attachments",
            "clipboard_screenshots",
            "exports",
            "provider_status",
            "local_ai_generation",
        ],
        deferred_commands: vec!["long_running_jobs"],
    }
}

#[cfg(test)]
mod tests {
    use super::CommandShellStatus;

    #[test]
    fn shell_status_serializes_camel_case() {
        let status = CommandShellStatus {
            app_data_dir: "/tmp/qa-scribe".to_string(),
            database_filename: "qa-scribe.sqlite".to_string(),
            native_permissions: Vec::new(),
            active_job_count: 0,
            granted_path_count: 0,
            implemented_commands: vec!["sessions"],
            deferred_commands: vec!["attachments"],
        };
        let json = serde_json::to_value(status).expect("status should serialize");

        assert_eq!(json["appDataDir"], "/tmp/qa-scribe");
        assert_eq!(json["activeJobCount"], 0);
        assert_eq!(json["nativePermissions"].as_array().unwrap().len(), 0);
    }
}
