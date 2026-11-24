use std::{
    collections::{HashMap, VecDeque},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use chrono::{TimeDelta, Utc};
use qa_scribe_core::domain::{
    ApplicationLogQuery, ApplicationLogSource, LogEvidenceDetails, LogEvidenceSummary,
};
use tauri::{AppHandle, Manager, State};

use crate::{
    application_logs::{
        self, ApplicationLogAccess,
        discovery::{self, ApplicationInsightsComponent, AzureSubscription},
    },
    commands::CommandError,
    settings::AppState,
};

#[derive(Default)]
struct Jobs {
    active: HashMap<uuid::Uuid, Arc<AtomicBool>>,
    cancelled_before_start: VecDeque<uuid::Uuid>,
    shutting_down: bool,
}

#[derive(Default)]
struct JobRegistry {
    jobs: Mutex<Jobs>,
    finished: Condvar,
}

#[derive(Clone, Default)]
pub(crate) struct ApplicationLogJobs(Arc<JobRegistry>);

pub(crate) struct LogJob {
    jobs: ApplicationLogJobs,
    id: uuid::Uuid,
    cancelled: Arc<AtomicBool>,
}

impl ApplicationLogJobs {
    pub(crate) fn register(&self, id: uuid::Uuid) -> Result<LogJob, CommandError> {
        let mut jobs = self.0.jobs.lock().map_err(lock_error)?;
        if jobs.shutting_down || jobs.active.contains_key(&id) || jobs.active.len() >= 4 {
            return Err(CommandError::validation(
                "Wait for an active application log query to finish.",
            ));
        }
        if let Some(index) = jobs
            .cancelled_before_start
            .iter()
            .position(|pending| *pending == id)
        {
            jobs.cancelled_before_start.remove(index);
            return Err(cancelled_error());
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        jobs.active.insert(id, Arc::clone(&cancelled));
        Ok(LogJob {
            jobs: self.clone(),
            id,
            cancelled,
        })
    }

    fn cancel(&self, id: uuid::Uuid) -> Result<(), CommandError> {
        let mut jobs = self.0.jobs.lock().map_err(lock_error)?;
        if let Some(cancelled) = jobs.active.get(&id) {
            cancelled.store(true, Ordering::Release);
        } else if !jobs.cancelled_before_start.contains(&id) {
            // The cancel IPC may reach Rust before the async capture handler runs.
            if jobs.cancelled_before_start.len() == 32 {
                jobs.cancelled_before_start.pop_front();
            }
            jobs.cancelled_before_start.push_back(id);
        }
        Ok(())
    }

    pub(crate) fn shutdown(&self) {
        let mut jobs = self
            .0
            .jobs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        jobs.shutting_down = true;
        for cancelled in jobs.active.values() {
            cancelled.store(true, Ordering::Release);
        }
        // Tauri can exit immediately after this handler. Wait until the workers
        // have killed and reaped their CLI process groups.
        drop(
            self.0
                .finished
                .wait_while(jobs, |jobs| !jobs.active.is_empty()),
        );
    }
}

impl LogJob {
    #[cfg(unix)]
    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub(crate) fn commit<T>(
        &self,
        commit: impl FnOnce() -> Result<T, CommandError>,
    ) -> Result<T, CommandError> {
        let _jobs = self.jobs.0.jobs.lock().map_err(lock_error)?;
        if self.cancelled.load(Ordering::Acquire) {
            return Err(cancelled_error());
        }
        commit()
    }
}

impl Drop for LogJob {
    fn drop(&mut self) {
        let mut jobs = self
            .jobs
            .0
            .jobs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        jobs.active.remove(&self.id);
        self.jobs.0.finished.notify_all();
    }
}

fn cancelled_error() -> CommandError {
    CommandError::validation("The application log query was cancelled.")
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> CommandError {
    CommandError::internal("The application log job lock was poisoned.")
}

fn job_id(raw: &str) -> Result<uuid::Uuid, CommandError> {
    uuid::Uuid::try_parse(raw)
        .map_err(|_| CommandError::validation("Invalid application log query ID."))
}

#[tauri::command]
#[specta::specta]
pub async fn list_azure_log_subscriptions(
    jobs: State<'_, ApplicationLogJobs>,
    query_id: String,
) -> Result<Vec<AzureSubscription>, CommandError> {
    let job = jobs.register(job_id(&query_id)?)?;
    tauri::async_runtime::spawn_blocking(move || discovery::subscriptions(&job.cancelled))
        .await
        .map_err(|_| CommandError::internal("Azure subscription discovery did not finish."))?
        .map_err(|error| CommandError::validation(discovery::error_message(error)))
}

#[tauri::command]
#[specta::specta]
pub async fn list_application_insights_components(
    jobs: State<'_, ApplicationLogJobs>,
    query_id: String,
    subscription: String,
) -> Result<Vec<ApplicationInsightsComponent>, CommandError> {
    let subscription = discovery::subscription_id(&subscription)
        .ok_or_else(|| CommandError::validation("Select a valid Azure subscription."))?;
    let job = jobs.register(job_id(&query_id)?)?;
    tauri::async_runtime::spawn_blocking(move || {
        discovery::components(subscription, &job.cancelled)
    })
    .await
    .map_err(|_| CommandError::internal("Application Insights discovery did not finish."))?
    .map_err(|error| CommandError::validation(discovery::error_message(error)))
}

#[tauri::command]
#[specta::specta]
pub async fn check_application_log_access(
    jobs: State<'_, ApplicationLogJobs>,
    source: ApplicationLogSource,
) -> Result<ApplicationLogAccess, CommandError> {
    let source = source.validated()?;
    let end = Utc::now();
    let query = ApplicationLogQuery {
        target_id: source.resource_id.clone(),
        kql: "print access = 1".into(),
        start: (end - TimeDelta::minutes(15)).to_rfc3339(),
        end: end.to_rfc3339(),
    }
    .validate(&[source])?;
    let job = jobs.register(uuid::Uuid::new_v4())?;
    tauri::async_runtime::spawn_blocking(move || application_logs::check(&query, &job.cancelled))
        .await
        .map_err(|_| CommandError::internal("The Azure access check did not finish."))
}

#[tauri::command]
#[specta::specta]
pub async fn capture_application_logs(
    app: AppHandle,
    case_id: String,
    query_id: String,
    query: ApplicationLogQuery,
) -> Result<LogEvidenceSummary, CommandError> {
    let id = job_id(&query_id)?;
    let jobs = app.state::<ApplicationLogJobs>();
    // Register before yielding to the worker so a queued job is also cancellable.
    let job = jobs.register(id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let query = state.with_service(|service| {
            service.require_log_evidence_capacity(&case_id)?;
            query.validate(&service.get_settings()?.application_log_sources)
        })?;
        let output = application_logs::run(&query, &job.cancelled)
            .map_err(|error| CommandError::validation(error.message()))?;
        job.commit(|| {
            state.with_service(|service| {
                if !service
                    .get_settings()?
                    .application_log_sources
                    .contains(&query.target)
                {
                    return Err(qa_scribe_core::QaScribeError::Validation(
                        "The Application Insights query target changed. Run the query again."
                            .into(),
                    ));
                }
                service.attach_application_logs(&case_id, query, output)
            })
        })
    })
    .await
    .map_err(|_| CommandError::internal("The application log query did not finish."))?
}

#[tauri::command]
#[specta::specta]
pub fn cancel_application_log_query(
    jobs: State<'_, ApplicationLogJobs>,
    query_id: String,
) -> Result<(), CommandError> {
    jobs.cancel(job_id(&query_id)?)
}

#[tauri::command]
#[specta::specta]
pub fn get_application_log_details(
    state: State<'_, AppState>,
    case_id: String,
    id: String,
) -> Result<LogEvidenceDetails, CommandError> {
    state.with_service(|service| service.application_log_details(&case_id, &id))
}

#[tauri::command]
#[specta::specta]
pub fn detach_application_logs(
    state: State<'_, AppState>,
    case_id: String,
    id: String,
) -> Result<(), CommandError> {
    state.with_service(|service| service.detach_application_logs(&case_id, &id))
}

#[tauri::command]
#[specta::specta]
pub fn recent_application_log_queries(
    state: State<'_, AppState>,
    case_id: String,
    source_id: String,
) -> Result<Vec<String>, CommandError> {
    state.with_service(|service| service.recent_application_log_queries(&case_id, &source_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_can_arrive_before_capture_registration() {
        let jobs = ApplicationLogJobs::default();
        let id = uuid::Uuid::new_v4();
        jobs.cancel(id).unwrap();
        assert!(jobs.register(id).is_err());
        assert!(jobs.register(uuid::Uuid::new_v4()).is_ok());
    }

    #[test]
    fn shutdown_cancels_active_jobs_and_waits_for_their_worker_cleanup() {
        let jobs = ApplicationLogJobs::default();
        let id = uuid::Uuid::new_v4();
        let job = jobs.register(id).unwrap();
        std::thread::scope(|scope| {
            let shutdown = scope.spawn(|| jobs.shutdown());
            assert!(jobs.register(id).is_err());
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
            while !job.cancelled.load(Ordering::Acquire) && std::time::Instant::now() < deadline {
                std::thread::yield_now();
            }
            let cancelled = job.cancelled.load(Ordering::Acquire);
            let blocked = !shutdown.is_finished();
            let rejected = jobs.register(uuid::Uuid::new_v4()).is_err();
            let write_rejected = job.commit(|| Ok(())).is_err();
            drop(job);
            shutdown.join().unwrap();
            assert!(cancelled && blocked && rejected && write_rejected);
        });
    }
}
