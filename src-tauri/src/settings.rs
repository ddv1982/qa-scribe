use std::{path::PathBuf, sync::Mutex};

use qa_scribe_core::{QaScribeError, services::SessionService};

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
    ) -> Result<T, String> {
        let service = self
            .service
            .lock()
            .map_err(|_| "Session service lock was poisoned".to_string())?;
        action(&service).map_err(command_error)
    }
}

pub fn command_error(error: QaScribeError) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use qa_scribe_core::{domain::SessionDraft, services::SessionService};

    use super::AppState;

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
}
