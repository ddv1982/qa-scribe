use super::{JobControl, JobStore, JobStoreError};

/// Temporary per-Session admission, retained through durable deletion and cleanup.
/// Dropping this guard must reopen admission on success, error, or unwind.
pub struct SessionDeletionGuard<'a> {
    store: &'a JobStore,
    session_id: String,
    jobs: Vec<(String, JobControl)>,
}

impl JobStore {
    /// Atomically close admission and snapshot every active job for this Session.
    /// A second deletion must fail rather than share ownership of admission.
    pub fn begin_session_deletion(
        &self,
        session_id: &str,
    ) -> Result<super::SessionDeletionGuard<'_>, JobStoreError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| JobStoreError::internal("Job store lock was poisoned"))?;
        if !inner.deleting_sessions.insert(session_id.to_string()) {
            return Err(JobStoreError::SessionDeleting {
                session_id: session_id.to_string(),
            });
        }
        let jobs = inner
            .jobs
            .iter()
            .filter(|(_, record)| {
                record.status.session_id == session_id && record.status.state.is_active()
            })
            .map(|(id, record)| (id.clone(), record.control.clone()))
            .collect();
        Ok(SessionDeletionGuard {
            store: self,
            session_id: session_id.to_string(),
            jobs,
        })
    }
}

impl SessionDeletionGuard<'_> {
    /// Cancel the captured jobs via their existing finalization/process controls.
    /// The caller must not hold AppState's service mutex here.
    pub fn cancel_jobs(&self) -> Result<(), JobStoreError> {
        let mut failure = None;
        for (job_id, control) in &self.jobs {
            // This releases the JobStore mutex before acquiring the control
            // gate. A finalizer that already owns the gate may finish first.
            let cancelled = self.store.cancel(job_id).and_then(|status| {
                if status.state == super::GenerationJobState::Cancelling {
                    // A previous cancellation may have set Cancelling before
                    // failing to acquire the child lock. Recheck the kill path
                    // even on retry, rather than treating that state as success.
                    control
                        .kill_registered_child()
                        .map_err(JobStoreError::internal)
                } else {
                    Ok(())
                }
            });
            if let Err(error) = cancelled {
                control.kill_child_for_exit();
                failure.get_or_insert(error);
            }
        }
        match failure {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

impl Drop for SessionDeletionGuard<'_> {
    fn drop(&mut self) {
        // Cleanup must also run during unwinding, including a poisoned store.
        let mut inner = self
            .store
            .inner
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        inner.deleting_sessions.remove(&self.session_id);
    }
}

/// Test-owned child cleanup also runs when a regression assertion unwinds.
#[cfg(test)]
pub(crate) struct TestChildCleanup(pub(crate) JobControl);

#[cfg(test)]
impl Drop for TestChildCleanup {
    fn drop(&mut self) {
        let _ = self.0.kill_registered_child();
        if let Ok(Some(mut child)) = self.0.take_child() {
            crate::process_io::kill_child_group(&mut child);
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
            loop {
                match child.try_wait() {
                    Ok(Some(_)) | Err(_) => break,
                    Ok(None) if std::time::Instant::now() < deadline => {
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Ok(None) => {
                        let _ = child.kill();
                        break;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
