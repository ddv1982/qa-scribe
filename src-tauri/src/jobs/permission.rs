use std::sync::mpsc::{self, Receiver};

use qa_scribe_core::domain::AiProvider;
use serde::{Deserialize, Serialize};

use super::{
    GenerationJobState, GenerationJobStatus, JobControl, JobRecord, JobStore, JobStoreError,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatPermissionDetails {
    #[serde(default = "default_can_approve", skip_serializing_if = "is_true")]
    pub can_approve: bool,
    pub provider: AiProvider,
    pub title: String,
    pub tool_name: Option<String>,
    pub server_name: Option<String>,
    pub input_json: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatPermissionRequest {
    #[serde(default = "default_can_approve", skip_serializing_if = "is_true")]
    pub can_approve: bool,
    pub request_id: String,
    pub provider: AiProvider,
    pub title: String,
    pub tool_name: Option<String>,
    pub server_name: Option<String>,
    pub input_json: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ChatPermissionDecision {
    Approve,
    ApproveAll,
    Deny,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatPermissionDecisionRequest {
    pub job_id: String,
    pub session_id: String,
    pub request_id: String,
    pub provider: AiProvider,
    pub decision: ChatPermissionDecision,
}

impl JobStore {
    pub fn publish_chat_permission(
        &self,
        job_id: &str,
        details: ChatPermissionDetails,
    ) -> Result<(GenerationJobStatus, Receiver<ChatPermissionDecision>), JobStoreError> {
        validate_details(&details)?;
        self.with_permission_job(job_id, |record| {
            if record.status.pending_permission.is_some() || record.permission_reply.is_some() {
                return Err(invalid("A chat permission request is already pending"));
            }
            let (sender, receiver) = mpsc::channel();
            record.status.pending_permission = Some(ChatPermissionRequest {
                can_approve: details.can_approve,
                request_id: uuid::Uuid::new_v4().to_string(),
                provider: details.provider,
                title: details.title,
                tool_name: details.tool_name,
                server_name: details.server_name,
                input_json: details.input_json,
            });
            record.permission_reply = Some(sender);
            Ok((record.status.clone(), receiver))
        })
    }

    pub fn decide_chat_permission(
        &self,
        request: ChatPermissionDecisionRequest,
    ) -> Result<GenerationJobStatus, JobStoreError> {
        self.with_permission_job(&request.job_id, |record| {
            let pending = record
                .status
                .pending_permission
                .as_ref()
                .ok_or_else(|| invalid("No chat permission request is pending"))?;
            if record.status.session_id != request.session_id
                || pending.provider != request.provider
                || pending.request_id != request.request_id
            {
                return Err(invalid("Chat permission request identity does not match"));
            }
            if request.decision != ChatPermissionDecision::Deny && !pending.can_approve {
                return Err(invalid("Chat permission request does not offer approval"));
            }
            let sender = record
                .permission_reply
                .take()
                .ok_or_else(|| invalid("Chat permission receiver is unavailable"))?;
            record.status.pending_permission = None;
            // Unbounded mpsc send cannot block. Keep delivery inside the gate
            // and store lock so accepted cancellation cannot interleave it.
            sender
                .send(request.decision)
                .map_err(|_| invalid("Chat permission receiver was disconnected"))?;
            Ok(record.status.clone())
        })
    }

    pub(super) fn permission_control(&self, job_id: &str) -> Result<JobControl, JobStoreError> {
        self.inner
            .lock()
            .map_err(|_| JobStoreError::internal("Job store lock was poisoned"))?
            .jobs
            .get(job_id)
            .map(|record| record.control.clone())
            .ok_or_else(|| JobStoreError::NotFound {
                job_id: job_id.to_string(),
            })
    }

    fn with_permission_job<R>(
        &self,
        job_id: &str,
        operation: impl FnOnce(&mut JobRecord) -> Result<R, JobStoreError>,
    ) -> Result<R, JobStoreError> {
        let control = self.permission_control(job_id)?;
        let outcome = control
            .run_if_not_cancelled(|| {
                let mut inner = self
                    .inner
                    .lock()
                    .map_err(|_| JobStoreError::internal("Job store lock was poisoned"))?;
                let deleting = inner.jobs.get(job_id).is_some_and(|record| {
                    inner.deleting_sessions.contains(&record.status.session_id)
                });
                let record = inner
                    .jobs
                    .get_mut(job_id)
                    .ok_or_else(|| JobStoreError::NotFound {
                        job_id: job_id.to_string(),
                    })?;
                if control.is_cancelled() {
                    record.clear_permission();
                    return Err(invalid("Chat permission job was cancelled"));
                }
                if deleting
                    || record.status.action != "chat"
                    || record.status.state != GenerationJobState::Running
                {
                    return Err(invalid("Chat permissions require a running chat job"));
                }
                operation(record)
            })
            .map_err(JobStoreError::internal)?;
        match outcome {
            Some(result) => result,
            None => {
                // Direct JobControl cancellation can precede status reconciliation.
                // Reacquire in gate-then-inner order to revoke the waiting channel.
                control
                    .run_serialized(|| {
                        let mut inner = self
                            .inner
                            .lock()
                            .map_err(|_| JobStoreError::internal("Job store lock was poisoned"))?;
                        if let Some(record) = inner.jobs.get_mut(job_id) {
                            record.clear_permission();
                        }
                        Ok::<(), JobStoreError>(())
                    })
                    .map_err(JobStoreError::internal)??;
                Err(invalid("Chat permission job was cancelled"))
            }
        }
    }
}

impl JobRecord {
    pub(super) fn clear_permission(&mut self) {
        self.status.pending_permission = None;
        self.permission_reply = None;
    }
}

fn invalid(message: &str) -> JobStoreError {
    JobStoreError::InvalidPermission(message.to_string())
}

fn default_can_approve() -> bool {
    true
}

fn is_true(value: &bool) -> bool {
    *value
}

fn validate_details(details: &ChatPermissionDetails) -> Result<(), JobStoreError> {
    if details.title.trim().is_empty() || details.title.len() > 4096 {
        return Err(invalid(
            "Chat permission title must contain 1 to 4096 bytes",
        ));
    }
    if details
        .tool_name
        .as_ref()
        .is_some_and(|name| name.len() > 512)
        || details
            .server_name
            .as_ref()
            .is_some_and(|name| name.len() > 512)
    {
        return Err(invalid("Chat permission names cannot exceed 512 bytes"));
    }
    if details
        .input_json
        .as_ref()
        .is_some_and(|input| input.len() > 32768)
    {
        return Err(invalid("Chat permission input cannot exceed 32768 bytes"));
    }
    Ok(())
}
