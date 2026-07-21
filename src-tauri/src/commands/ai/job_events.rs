use qa_scribe_core::{
    domain::{AiRun, GenerationContext},
    generation::{GenerateAiActionRequest, GenerateAiActionResult},
};
use serde::Serialize;
use tauri::ipc::Channel;

use crate::{
    jobs::{GenerationJobState, GenerationJobStatus, JobStore, JobStoreError},
    settings::AppState,
};

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum GenerationJobEvent {
    Started {
        job_id: String,
        status: GenerationJobStatus,
        generation_context: GenerationContext,
        ai_run: AiRun,
    },
    Progress {
        job_id: String,
        status: GenerationJobStatus,
        message: String,
    },
    Partial {
        job_id: String,
        status: GenerationJobStatus,
        body: String,
    },
    Completed {
        job_id: String,
        status: GenerationJobStatus,
        result: Box<GenerateAiActionResult>,
    },
    Failed {
        job_id: String,
        status: GenerationJobStatus,
        error_message: String,
        ai_run: Option<AiRun>,
    },
    Cancelled {
        job_id: String,
        status: GenerationJobStatus,
        ai_run: Option<AiRun>,
    },
}

pub(super) fn send_event(events: &Channel<GenerationJobEvent>, event: GenerationJobEvent) {
    let _ = events.send(event);
}

pub(super) fn send_progress(
    events: &Channel<GenerationJobEvent>,
    jobs: &JobStore,
    job_id: &str,
    message: &str,
) -> Result<GenerationJobStatus, JobStoreError> {
    let status = jobs.update_progress(job_id, message)?;
    send_event(
        events,
        GenerationJobEvent::Progress {
            job_id: job_id.to_string(),
            status: status.clone(),
            message: message.to_string(),
        },
    );
    Ok(status)
}

pub(super) fn finish_cancelled_job(
    events: &Channel<GenerationJobEvent>,
    jobs: &JobStore,
    state: &AppState,
    job_id: &str,
    request: &GenerateAiActionRequest,
    ai_run_id: Option<&str>,
) {
    let ai_run = ai_run_id.and_then(|ai_run_id| {
        state
            .with_service(|service| service.fail_ai_run(ai_run_id, "Generation cancelled."))
            .ok()
    });
    let status = jobs.mark_cancelled(job_id).unwrap_or_else(|_| {
        fallback_status(
            job_id,
            request,
            GenerationJobState::Cancelled,
            "Generation cancelled.",
        )
    });
    send_event(
        events,
        GenerationJobEvent::Cancelled {
            job_id: job_id.to_string(),
            status,
            ai_run,
        },
    );
}

pub(super) fn fallback_status(
    job_id: &str,
    request: &GenerateAiActionRequest,
    state: GenerationJobState,
    message: &str,
) -> GenerationJobStatus {
    GenerationJobStatus {
        job_id: job_id.to_string(),
        session_id: request.session_id.clone(),
        action: request.action.as_str().to_string(),
        state,
        progress_message: message.to_string(),
        ai_run_id: None,
        error_message: (!message.is_empty()).then(|| message.to_string()),
        partial_text: None,
    }
}
