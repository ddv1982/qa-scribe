use std::{path::PathBuf, sync::Mutex};

use qa_scribe_core::services::SessionService;

use crate::commands::CommandError;

pub struct AppState {
    service: Mutex<SessionService>,
    app_data_dir: PathBuf,
}

impl AppState {
    pub fn new(service: SessionService, app_data_dir: PathBuf) -> Self {
        Self {
            service: Mutex::new(service),
            app_data_dir,
        }
    }

    pub fn app_data_dir(&self) -> &PathBuf {
        &self.app_data_dir
    }

    pub fn with_service<T>(
        &self,
        action: impl FnOnce(&SessionService) -> qa_scribe_core::Result<T>,
    ) -> Result<T, CommandError> {
        let service = self
            .service
            .lock()
            .map_err(|_| CommandError::internal("Session service lock was poisoned"))?;
        action(&service).map_err(CommandError::from)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use qa_scribe_core::{domain::SessionDraft, services::SessionService};

    use super::AppState;
    use crate::commands::CommandError;

    #[test]
    fn app_state_runs_core_service_actions() {
        let state = AppState::new(
            SessionService::in_memory().expect("in-memory service should open"),
            PathBuf::from("/tmp/qa-scribe-test"),
        );

        let session = state
            .with_service(|service| {
                service.create_session(SessionDraft {
                    title: "Command smoke".to_string(),
                    ..SessionDraft::default()
                })
            })
            .expect("service action should succeed");

        assert_eq!(session.title, "Command smoke");
    }

    /// End-to-end shape check for a real `#[tauri::command]` error path:
    /// a not-found service error, run through the same `with_service` every
    /// command uses, serializes with a camelCase `kind` over the IPC
    /// boundary exactly like Tauri would serialize a command's `Err`.
    #[test]
    fn not_found_command_error_serializes_with_camel_case_kind_over_the_boundary() {
        let state = AppState::new(
            SessionService::in_memory().expect("in-memory service should open"),
            PathBuf::from("/tmp/qa-scribe-test"),
        );

        let error: CommandError = state
            .with_service(|service| service.reopen_session("missing-session"))
            .expect_err("reopening a missing session should fail");

        let json = serde_json::to_value(&error).expect("CommandError serializes");
        assert_eq!(json["kind"], "notFound");
        assert_eq!(json["message"], "not found: missing-session");
    }
}
