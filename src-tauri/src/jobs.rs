use std::{
    collections::HashMap,
    process::Child,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use serde::Serialize;

const PARTIAL_TEXT_LIMIT: usize = 32_000;
const TERMINAL_JOB_LIMIT: usize = 32;
const MAX_ACTIVE_GENERATION_JOBS: usize = 3;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum JobStoreError {
    Capacity { limit: usize },
    NotFound { job_id: String },
    Internal(String),
}

impl JobStoreError {
    fn internal(message: impl Into<String>) -> Self {
        Self::Internal(message.into())
    }
}

impl std::fmt::Display for JobStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JobStoreError::Capacity { limit } => write!(
                formatter,
                "At most {limit} AI generation jobs can run at once. Wait for a generation to finish or cancel one before starting another."
            ),
            JobStoreError::NotFound { job_id } => {
                write!(formatter, "Generation job {job_id} was not found.")
            }
            JobStoreError::Internal(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for JobStoreError {}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GenerationJobStatus {
    pub job_id: String,
    pub session_id: String,
    pub action: String,
    pub state: GenerationJobState,
    pub progress_message: String,
    pub ai_run_id: Option<String>,
    pub error_message: Option<String>,
    pub partial_text: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GenerationJobState {
    Starting,
    Running,
    Cancelling,
    Completed,
    Failed,
    Cancelled,
}

impl GenerationJobState {
    fn is_active(self) -> bool {
        matches!(
            self,
            GenerationJobState::Starting
                | GenerationJobState::Running
                | GenerationJobState::Cancelling
        )
    }

    fn is_terminal(self) -> bool {
        matches!(
            self,
            GenerationJobState::Completed
                | GenerationJobState::Failed
                | GenerationJobState::Cancelled
        )
    }
}

#[derive(Clone, Default)]
pub struct JobControl {
    cancel_requested: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
}

impl JobControl {
    pub fn is_cancelled(&self) -> bool {
        self.cancel_requested.load(Ordering::SeqCst)
    }

    pub fn set_child(&self, mut child: Child) -> Result<(), String> {
        let mut slot = self
            .child
            .lock()
            .map_err(|_| "Generation process lock was poisoned".to_string())?;
        if self.is_cancelled() {
            crate::process_io::kill_child_group(&mut child);
        }
        *slot = Some(child);
        Ok(())
    }

    pub fn take_child(&self) -> Result<Option<Child>, String> {
        self.child
            .lock()
            .map(|mut child| child.take())
            .map_err(|_| "Generation process lock was poisoned".to_string())
    }

    /// Kill the registered child (and its process group on unix) in place,
    /// without removing or reaping it. Used by the cancellation and watchdog
    /// paths so the owning worker thread can still `wait()` on it afterwards.
    pub fn kill_registered_child(&self) -> Result<(), String> {
        if let Some(child) = self
            .child
            .lock()
            .map_err(|_| "Generation process lock was poisoned".to_string())?
            .as_mut()
        {
            crate::process_io::kill_child_group(child);
        }
        Ok(())
    }

    pub(crate) fn request_cancel(&self) -> Result<(), String> {
        self.cancel_requested.store(true, Ordering::SeqCst);
        if let Some(child) = self
            .child
            .lock()
            .map_err(|_| "Generation process lock was poisoned".to_string())?
            .as_mut()
        {
            crate::process_io::kill_child_group(child);
        }
        Ok(())
    }

    /// Kill the registered child (and its process group on unix) without
    /// reaping it. Used on app exit to make sure spawned CLIs and their
    /// grandchildren do not outlive the app. The owning worker thread is
    /// still responsible for `wait()`ing on its own child.
    fn kill_child_for_exit(&self) {
        if let Ok(mut slot) = self.child.lock()
            && let Some(child) = slot.as_mut()
        {
            crate::process_io::kill_child_group(child);
        }
    }
}

struct JobRecord {
    status: GenerationJobStatus,
    control: JobControl,
    terminal_sequence: Option<u64>,
}

#[derive(Default)]
pub struct JobStore {
    inner: Mutex<JobStoreInner>,
}

#[derive(Default)]
struct JobStoreInner {
    jobs: HashMap<String, JobRecord>,
    next_terminal_sequence: u64,
}

impl JobStore {
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.inner
            .lock()
            .map(|inner| {
                inner
                    .jobs
                    .values()
                    .filter(|record| record.status.state.is_active())
                    .count()
            })
            .unwrap_or_default()
    }

    pub fn insert_generation_job(
        &self,
        job_id: String,
        session_id: String,
        action: String,
    ) -> Result<(GenerationJobStatus, JobControl), JobStoreError> {
        let status = GenerationJobStatus {
            job_id: job_id.clone(),
            session_id,
            action,
            state: GenerationJobState::Starting,
            progress_message: "Preparing generation".to_string(),
            ai_run_id: None,
            error_message: None,
            partial_text: None,
        };
        let control = JobControl::default();
        let record = JobRecord {
            status: status.clone(),
            control: control.clone(),
            terminal_sequence: None,
        };
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| JobStoreError::internal("Job store lock was poisoned"))?;
        let active_count = inner
            .jobs
            .values()
            .filter(|record| record.status.state.is_active())
            .count();
        if active_count >= MAX_ACTIVE_GENERATION_JOBS {
            return Err(JobStoreError::Capacity {
                limit: MAX_ACTIVE_GENERATION_JOBS,
            });
        }
        inner.jobs.insert(job_id, record);
        Ok((status, control))
    }

    /// Kill every live child process (and its process group on unix).
    /// Called on app exit so provider CLIs and their grandchildren
    /// (node, MCP servers) are not orphaned.
    pub fn kill_all_children(&self) {
        let Ok(inner) = self.inner.lock() else {
            return;
        };
        for record in inner.jobs.values() {
            record.control.kill_child_for_exit();
        }
    }

    /// Snapshot every job that is still active (starting/running/cancelling).
    ///
    /// Used on webview reload to reconcile: the backend worker threads keep
    /// running across a reload, but the frontend loses its in-memory job map
    /// and the original invoke `Channel`, so on boot it enumerates the survivors
    /// here and re-subscribes to them by polling [`Self::status`].
    pub fn active_jobs(&self) -> Result<Vec<GenerationJobStatus>, JobStoreError> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| JobStoreError::internal("Job store lock was poisoned"))?
            .jobs
            .values()
            .filter(|record| !record.status.state.is_terminal())
            .map(|record| record.status.clone())
            .collect())
    }

    pub fn status(&self, job_id: &str) -> Result<GenerationJobStatus, JobStoreError> {
        self.inner
            .lock()
            .map_err(|_| JobStoreError::internal("Job store lock was poisoned"))?
            .jobs
            .get(job_id)
            .map(|record| record.status.clone())
            .ok_or_else(|| JobStoreError::NotFound {
                job_id: job_id.to_string(),
            })
    }

    pub fn mark_running(
        &self,
        job_id: &str,
        ai_run_id: String,
        progress_message: &str,
    ) -> Result<GenerationJobStatus, JobStoreError> {
        self.update(job_id, |status| {
            status.state = GenerationJobState::Running;
            status.ai_run_id = Some(ai_run_id);
            status.progress_message = progress_message.to_string();
            status.error_message = None;
        })
    }

    pub fn update_progress(
        &self,
        job_id: &str,
        progress_message: &str,
    ) -> Result<GenerationJobStatus, JobStoreError> {
        self.update(job_id, |status| {
            if status.state != GenerationJobState::Cancelling {
                status.progress_message = progress_message.to_string();
            }
        })
    }

    pub fn update_partial(
        &self,
        job_id: &str,
        partial_text: &str,
    ) -> Result<GenerationJobStatus, JobStoreError> {
        self.update(job_id, |status| {
            status.partial_text = Some(tail(partial_text, PARTIAL_TEXT_LIMIT));
        })
    }

    pub fn complete(&self, job_id: &str) -> Result<GenerationJobStatus, JobStoreError> {
        self.finish(job_id, |status| {
            status.state = GenerationJobState::Completed;
            status.progress_message = "Generation completed".to_string();
            status.error_message = None;
        })
    }

    pub fn fail(
        &self,
        job_id: &str,
        error_message: &str,
    ) -> Result<GenerationJobStatus, JobStoreError> {
        self.finish(job_id, |status| {
            status.state = GenerationJobState::Failed;
            status.progress_message = "Generation failed".to_string();
            status.error_message = Some(error_message.to_string());
        })
    }

    pub fn cancel(&self, job_id: &str) -> Result<GenerationJobStatus, JobStoreError> {
        let record_control = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| JobStoreError::internal("Job store lock was poisoned"))?;
            let record = inner
                .jobs
                .get_mut(job_id)
                .ok_or_else(|| JobStoreError::NotFound {
                    job_id: job_id.to_string(),
                })?;
            if matches!(
                record.status.state,
                GenerationJobState::Completed
                    | GenerationJobState::Failed
                    | GenerationJobState::Cancelled
            ) {
                return Ok(record.status.clone());
            }
            record.status.state = GenerationJobState::Cancelling;
            record.status.progress_message = "Cancelling generation".to_string();
            record.control.clone()
        };
        record_control
            .request_cancel()
            .map_err(JobStoreError::internal)?;
        self.status(job_id)
    }

    pub fn mark_cancelled(&self, job_id: &str) -> Result<GenerationJobStatus, JobStoreError> {
        self.finish(job_id, |status| {
            status.state = GenerationJobState::Cancelled;
            status.progress_message = "Generation cancelled".to_string();
            status.error_message = Some("Generation cancelled.".to_string());
        })
    }

    fn update(
        &self,
        job_id: &str,
        apply: impl FnOnce(&mut GenerationJobStatus),
    ) -> Result<GenerationJobStatus, JobStoreError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| JobStoreError::internal("Job store lock was poisoned"))?;
        let record = inner
            .jobs
            .get_mut(job_id)
            .ok_or_else(|| JobStoreError::NotFound {
                job_id: job_id.to_string(),
            })?;
        apply(&mut record.status);
        Ok(record.status.clone())
    }

    fn finish(
        &self,
        job_id: &str,
        apply: impl FnOnce(&mut GenerationJobStatus),
    ) -> Result<GenerationJobStatus, JobStoreError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| JobStoreError::internal("Job store lock was poisoned"))?;
        let next_terminal_sequence = inner.next_terminal_sequence;
        let (status, assigned_terminal_sequence) = {
            let record = inner
                .jobs
                .get_mut(job_id)
                .ok_or_else(|| JobStoreError::NotFound {
                    job_id: job_id.to_string(),
                })?;
            apply(&mut record.status);
            let needs_terminal_sequence =
                record.status.state.is_terminal() && record.terminal_sequence.is_none();
            if needs_terminal_sequence {
                record.terminal_sequence = Some(next_terminal_sequence);
            }
            (record.status.clone(), needs_terminal_sequence)
        };
        if assigned_terminal_sequence {
            inner.next_terminal_sequence = inner.next_terminal_sequence.saturating_add(1);
        }
        prune_terminal_jobs(&mut inner.jobs);
        Ok(status)
    }
}

fn prune_terminal_jobs(jobs: &mut HashMap<String, JobRecord>) {
    let terminal_count = jobs
        .values()
        .filter(|record| record.status.state.is_terminal())
        .count();
    if terminal_count <= TERMINAL_JOB_LIMIT {
        return;
    }

    let mut terminal_jobs: Vec<(String, u64)> = jobs
        .iter()
        .filter_map(|(id, record)| {
            record
                .terminal_sequence
                .map(|sequence| (id.clone(), sequence))
        })
        .collect();
    terminal_jobs.sort_by_key(|(_, sequence)| *sequence);
    for (job_id, _) in terminal_jobs
        .into_iter()
        .take(terminal_count.saturating_sub(TERMINAL_JOB_LIMIT))
    {
        jobs.remove(&job_id);
    }
}

fn tail(value: &str, limit: usize) -> String {
    let mut output = value.to_string();
    while output.len() > limit {
        if output.is_char_boundary(output.len() - limit) {
            output = output[output.len() - limit..].to_string();
            break;
        }
        output.remove(0);
    }
    output
}

#[cfg(test)]
mod tests;
