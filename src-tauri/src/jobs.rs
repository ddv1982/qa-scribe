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

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
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

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
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

    pub fn set_child(&self, child: Child) -> Result<(), String> {
        let mut slot = self
            .child
            .lock()
            .map_err(|_| "Generation process lock was poisoned".to_string())?;
        *slot = Some(child);
        Ok(())
    }

    pub fn take_child(&self) -> Result<Option<Child>, String> {
        self.child
            .lock()
            .map(|mut child| child.take())
            .map_err(|_| "Generation process lock was poisoned".to_string())
    }

    fn request_cancel(&self) -> Result<(), String> {
        self.cancel_requested.store(true, Ordering::SeqCst);
        if let Some(child) = self
            .child
            .lock()
            .map_err(|_| "Generation process lock was poisoned".to_string())?
            .as_mut()
        {
            let _ = child.kill();
        }
        Ok(())
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
    ) -> Result<(GenerationJobStatus, JobControl), String> {
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
        self.inner
            .lock()
            .map_err(|_| "Job store lock was poisoned".to_string())?
            .jobs
            .insert(job_id, record);
        Ok((status, control))
    }

    pub fn status(&self, job_id: &str) -> Result<GenerationJobStatus, String> {
        self.inner
            .lock()
            .map_err(|_| "Job store lock was poisoned".to_string())?
            .jobs
            .get(job_id)
            .map(|record| record.status.clone())
            .ok_or_else(|| format!("Generation job {job_id} was not found."))
    }

    pub fn mark_running(
        &self,
        job_id: &str,
        ai_run_id: String,
        progress_message: &str,
    ) -> Result<GenerationJobStatus, String> {
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
    ) -> Result<GenerationJobStatus, String> {
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
    ) -> Result<GenerationJobStatus, String> {
        self.update(job_id, |status| {
            status.partial_text = Some(tail(partial_text, PARTIAL_TEXT_LIMIT));
        })
    }

    pub fn complete(&self, job_id: &str) -> Result<GenerationJobStatus, String> {
        self.finish(job_id, |status| {
            status.state = GenerationJobState::Completed;
            status.progress_message = "Generation completed".to_string();
            status.error_message = None;
        })
    }

    pub fn fail(&self, job_id: &str, error_message: &str) -> Result<GenerationJobStatus, String> {
        self.finish(job_id, |status| {
            status.state = GenerationJobState::Failed;
            status.progress_message = "Generation failed".to_string();
            status.error_message = Some(error_message.to_string());
        })
    }

    pub fn cancel(&self, job_id: &str) -> Result<GenerationJobStatus, String> {
        let record_control = {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "Job store lock was poisoned".to_string())?;
            let record = inner
                .jobs
                .get_mut(job_id)
                .ok_or_else(|| format!("Generation job {job_id} was not found."))?;
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
        record_control.request_cancel()?;
        self.status(job_id)
    }

    pub fn mark_cancelled(&self, job_id: &str) -> Result<GenerationJobStatus, String> {
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
    ) -> Result<GenerationJobStatus, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Job store lock was poisoned".to_string())?;
        let record = inner
            .jobs
            .get_mut(job_id)
            .ok_or_else(|| format!("Generation job {job_id} was not found."))?;
        apply(&mut record.status);
        Ok(record.status.clone())
    }

    fn finish(
        &self,
        job_id: &str,
        apply: impl FnOnce(&mut GenerationJobStatus),
    ) -> Result<GenerationJobStatus, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "Job store lock was poisoned".to_string())?;
        let next_terminal_sequence = inner.next_terminal_sequence;
        let (status, assigned_terminal_sequence) = {
            let record = inner
                .jobs
                .get_mut(job_id)
                .ok_or_else(|| format!("Generation job {job_id} was not found."))?;
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
mod tests {
    use super::{GenerationJobState, JobStore};

    #[test]
    fn job_store_tracks_active_lifecycle() {
        let store = JobStore::default();
        let (status, _) = store
            .insert_generation_job(
                "job-1".to_string(),
                "session-1".to_string(),
                "testware".to_string(),
            )
            .expect("job inserts");

        assert_eq!(status.state, GenerationJobState::Starting);
        assert_eq!(store.len(), 1);

        let status = store
            .mark_running("job-1", "run-1".to_string(), "Provider started")
            .expect("job starts");
        assert_eq!(status.state, GenerationJobState::Running);
        assert_eq!(status.ai_run_id.as_deref(), Some("run-1"));

        let status = store
            .update_partial("job-1", "partial")
            .expect("partial updates");
        assert_eq!(status.partial_text.as_deref(), Some("partial"));

        let status = store.complete("job-1").expect("job completes");
        assert_eq!(status.state, GenerationJobState::Completed);
        assert_eq!(store.len(), 0);
    }

    #[test]
    fn cancellation_marks_job_cancelling_then_cancelled() {
        let store = JobStore::default();
        store
            .insert_generation_job(
                "job-1".to_string(),
                "session-1".to_string(),
                "summary".to_string(),
            )
            .expect("job inserts");

        let status = store.cancel("job-1").expect("job cancels");
        assert_eq!(status.state, GenerationJobState::Cancelling);
        assert_eq!(store.len(), 1);

        let status = store.mark_cancelled("job-1").expect("job marks cancelled");
        assert_eq!(status.state, GenerationJobState::Cancelled);
        assert_eq!(store.len(), 0);
    }

    #[test]
    fn terminal_jobs_are_bounded_but_recent_status_is_available() {
        let store = JobStore::default();
        for index in 0..40 {
            let job_id = format!("job-{index}");
            store
                .insert_generation_job(
                    job_id.clone(),
                    "session-1".to_string(),
                    "summary".to_string(),
                )
                .expect("job inserts");
            store.complete(&job_id).expect("job completes");
        }

        assert_eq!(store.len(), 0);
        assert!(store.status("job-0").is_err());
        let recent = store.status("job-39").expect("recent terminal job remains");
        assert_eq!(recent.state, GenerationJobState::Completed);
    }
}
