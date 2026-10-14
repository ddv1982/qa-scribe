use super::{
    GenerationJobState, GenerationJobStatus, JobControl, JobRecord, JobStore, JobStoreError,
    MAX_ACTIVE_GENERATION_JOBS,
};

impl JobStore {
    pub fn insert_generation_job(
        &self,
        job_id: String,
        session_id: String,
        action: String,
    ) -> Result<(GenerationJobStatus, JobControl), JobStoreError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| JobStoreError::internal("Job store lock was poisoned"))?;
        // Admission and insertion share the deletion snapshot's mutex. Check
        // admission first so this boundary always reports Session validation.
        if inner.deleting_sessions.contains(&session_id) {
            return Err(JobStoreError::SessionDeleting { session_id });
        }
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
        inner.jobs.insert(
            job_id,
            JobRecord {
                status: status.clone(),
                control: control.clone(),
                terminal_sequence: None,
            },
        );
        Ok((status, control))
    }
}
