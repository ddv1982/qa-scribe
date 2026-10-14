use std::panic::{AssertUnwindSafe, catch_unwind};

use tauri::{AppHandle, Manager, ipc::Channel};

use super::{
    StartChatJobRequest,
    lifecycle::{self, PreparedChat},
    transport::ChatTransport,
};
use crate::{
    jobs::{GenerationJobStatus, JobControl, JobStore},
    settings::AppState,
};

pub(super) fn run(
    app: AppHandle,
    job_id: String,
    request: StartChatJobRequest,
    prepared: PreparedChat,
    events: Channel<GenerationJobStatus>,
    control: JobControl,
) {
    let jobs = app.state::<JobStore>();
    let state = app.state::<AppState>();
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        match control.run_if_not_cancelled(|| {
            jobs.mark_running(
                &job_id,
                prepared.ai_run.id.clone(),
                "Provider process starting",
            )
        }) {
            Ok(Some(Ok(status))) => {
                let _ = events.send(status);
            }
            Ok(None) => return Err("Generation cancelled.".into()),
            Ok(Some(Err(error))) => return Err(error.to_string()),
            Err(error) => return Err(error),
        }
        let output = ChatTransport {
            job_id: &job_id,
            jobs: &jobs,
            events: &events,
            control: &control,
            app_data_dir: state.app_data_dir(),
        }
        .execute(&request, &prepared.prompt)?;
        if output.cancelled || control.is_cancelled() {
            return Err("Generation cancelled.".into());
        }
        // The durable finalizer is chat-specific, never a Testware finalizer.
        // Include JobStore completion under the cancellation gate as well.
        match control.run_if_not_cancelled(|| {
            state
                .with_service(|service| lifecycle::finish(service, &prepared, output))
                .map_err(|error| error.message)?;
            jobs.complete(&job_id).map_err(|error| error.to_string())
        }) {
            Ok(Some(Ok(status))) => {
                let _ = events.send(status);
                Ok(())
            }
            Ok(Some(Err(error))) | Err(error) => Err(error),
            Ok(None) => Err("Generation cancelled.".into()),
        }
    }));
    let error = match outcome {
        Ok(Ok(())) => return,
        Ok(Err(error)) => error,
        Err(_) => "Chat worker failed unexpectedly. Retry explicitly.".into(),
    };
    match super::reconcile_chat_failure(&state, &jobs, &job_id, &control, Some(&prepared), &error) {
        Ok(status) => {
            let _ = events.send(status);
        }
        Err(error) => {
            eprintln!(
                "qa-scribe Chat job terminal transition failed: {}",
                error.message
            );
        }
    }
}

#[cfg(test)]
mod deletion_tests {
    use super::super::{StartChatJobRequest, lifecycle::scope};
    use crate::{
        jobs::{GenerationJobState, JobStore},
        settings::AppState,
    };
    use qa_scribe_core::{domain::*, services::SessionService};

    fn setup() -> (SessionService, StartChatJobRequest) {
        let service = SessionService::in_memory().unwrap();
        let session = service
            .create_session(SessionDraft {
                title: "Chat deletion".into(),
                ..Default::default()
            })
            .unwrap();
        let chat = service.load_chat(&session.id).unwrap();
        let chat = service
            .save_chat_composer(ChatComposerRequest {
                scope: scope(&chat),
                composer: "Actual behavior differs".into(),
                mode: ChatMode::Chat,
            })
            .unwrap();
        (
            service,
            StartChatJobRequest {
                scope: scope(&chat),
                retry: false,
                provider: AiProvider::ClaudeCode,
                model: "sonnet".into(),
                reasoning_effort: Some("high".into()),
            },
        )
    }

    #[test]
    fn session_delete_chat_admission_rejection_is_boundary_validation_without_persisted_prepare() {
        let (service, request) = setup();
        let before = service.load_chat(&request.scope.session_id).unwrap();
        let state = AppState::new(service, std::env::temp_dir());
        let jobs = JobStore::default();
        let _guard = jobs
            .begin_session_deletion(&request.scope.session_id)
            .unwrap();
        let error = super::super::prepare_chat_job(&state, &jobs, &request, "rejected")
            .err()
            .unwrap();
        assert_eq!(serde_json::to_value(error).unwrap()["kind"], "validation");
        assert_eq!(
            state
                .with_service(|s| s.load_chat(&request.scope.session_id))
                .unwrap(),
            before
        );
        assert!(jobs.active_jobs().unwrap().is_empty());
    }

    #[test]
    fn session_delete_chat_prepare_failure_releases_reserved_job_as_failed() {
        let (service, mut request) = setup();
        request.scope.expected_revision += 1;
        let state = AppState::new(service, std::env::temp_dir());
        let jobs = JobStore::default();
        assert!(super::super::prepare_chat_job(&state, &jobs, &request, "bad-prepare").is_err());
        assert_eq!(
            jobs.status("bad-prepare").unwrap().state,
            GenerationJobState::Failed
        );
        assert!(jobs.active_jobs().unwrap().is_empty());
        let chat = state
            .with_service(|s| s.load_chat(&request.scope.session_id))
            .unwrap();
        assert!(chat.messages.is_empty());
        assert_eq!(chat.composer, "Actual behavior differs");
    }

    #[test]
    fn session_delete_chat_reservation_is_visible_before_persisted_preparation_takes_service_lock()
    {
        use std::{
            sync::Arc,
            thread,
            time::{Duration, Instant},
        };
        let (service, request) = setup();
        let state = Arc::new(AppState::new(service, std::env::temp_dir()));
        let jobs = Arc::new(JobStore::default());
        let (worker, visible) = state
            .with_service(|_| {
                let worker_state = Arc::clone(&state);
                let worker_jobs = Arc::clone(&jobs);
                let worker = thread::spawn(move || {
                    super::super::prepare_chat_job(
                        &worker_state,
                        &worker_jobs,
                        &request,
                        "preparing",
                    )
                });
                let deadline = Instant::now() + Duration::from_secs(2);
                while jobs.status("preparing").is_err()
                    && !worker.is_finished()
                    && Instant::now() < deadline
                {
                    thread::sleep(Duration::from_millis(5));
                }
                Ok((worker, jobs.status("preparing").is_ok()))
            })
            .unwrap();
        let result = worker.join();
        assert!(
            visible,
            "delete must see the reserved Chat job before persisted preparation starts"
        );
        assert!(result.unwrap().is_ok());
    }

    #[test]
    fn session_delete_chat_prepare_failure_after_accepted_cancel_is_cancelled_not_stranded() {
        let (service, request) = setup();
        let state = AppState::new(service, std::env::temp_dir());
        let jobs = JobStore::default();
        let (_, control) = jobs
            .insert_generation_job(
                "preparing".into(),
                request.scope.session_id.clone(),
                "chat".into(),
            )
            .unwrap();
        jobs.cancel("preparing").unwrap();
        let terminal = super::super::reconcile_chat_failure(
            &state,
            &jobs,
            "preparing",
            &control,
            None,
            "Injected preparation failure",
        )
        .unwrap();
        assert_eq!(terminal.state, GenerationJobState::Cancelled);
        assert!(jobs.active_jobs().unwrap().is_empty());
        let chat = state
            .with_service(|s| s.load_chat(&request.scope.session_id))
            .unwrap();
        assert!(chat.messages.is_empty());
        assert_eq!(chat.composer, "Actual behavior differs");
    }

    #[test]
    fn session_delete_chat_spawn_failure_honors_cancellation_instead_of_blind_fail() {
        for cancel in [false, true] {
            let (service, request) = setup();
            let state = AppState::new(service, std::env::temp_dir());
            let jobs = JobStore::default();
            let (prepared, _, control) =
                super::super::prepare_chat_job(&state, &jobs, &request, "spawn").unwrap();
            if cancel {
                jobs.cancel("spawn").unwrap();
            }
            let terminal = super::super::reconcile_chat_failure(
                &state,
                &jobs,
                "spawn",
                &control,
                Some(&prepared),
                "Injected spawn failure",
            )
            .unwrap();
            assert_eq!(
                terminal.state,
                if cancel {
                    GenerationJobState::Cancelled
                } else {
                    GenerationJobState::Failed
                }
            );
            assert!(jobs.active_jobs().unwrap().is_empty());
            let chat = state
                .with_service(|s| s.load_chat(&request.scope.session_id))
                .unwrap();
            assert_eq!(
                chat.messages[0].status,
                if cancel {
                    ChatTurnStatus::Cancelled
                } else {
                    ChatTurnStatus::Failed
                }
            );
            assert_eq!(
                state
                    .with_service(|s| s.get_ai_run(&prepared.ai_run.id))
                    .unwrap()
                    .unwrap()
                    .status,
                AiRunStatus::Failed
            );
        }
    }

    #[test]
    fn session_delete_cancelled_chat_worker_with_missing_rows_still_reaches_cancelled() {
        let (service, request) = setup();
        let state = AppState::new(service, std::env::temp_dir());
        let jobs = JobStore::default();
        let (prepared, _, control) =
            super::super::prepare_chat_job(&state, &jobs, &request, "deleted").unwrap();
        crate::commands::sessions::delete_session_with_jobs(
            &state,
            &jobs,
            &request.scope.session_id,
        )
        .unwrap();
        let terminal = super::super::reconcile_chat_failure(
            &state,
            &jobs,
            "deleted",
            &control,
            Some(&prepared),
            "Generation cancelled.",
        )
        .unwrap();
        assert_eq!(terminal.state, GenerationJobState::Cancelled);
        assert!(jobs.active_jobs().unwrap().is_empty());
        assert!(
            state
                .with_service(|s| s.get_ai_run(&prepared.ai_run.id))
                .unwrap()
                .is_none()
        );
    }
}
