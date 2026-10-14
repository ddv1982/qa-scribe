use std::panic::{AssertUnwindSafe, catch_unwind};

use qa_scribe_core::domain::ChatFailureKind;
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
    let failed = control.run_if_not_cancelled(|| {
        let persistence = state.with_service(|service| {
            lifecycle::fail(service, &prepared, ChatFailureKind::Failed, &error)
        });
        let message = persistence
            .err()
            .map(|failure| format!("{error} (Chat reconciliation failed: {})", failure.message))
            .unwrap_or_else(|| error.clone());
        jobs.fail(&job_id, &message)
    });
    match failed {
        Ok(Some(Ok(status))) => {
            let _ = events.send(status);
        }
        Ok(None) => {
            if let Err(error) = state.with_service(|service| {
                lifecycle::fail(
                    service,
                    &prepared,
                    ChatFailureKind::Cancelled,
                    "Generation cancelled.",
                )
            }) {
                eprintln!(
                    "qa-scribe Chat cancellation reconciliation failed: {}",
                    error.message
                );
            }
            // request_cancel on exit can precede the JobStore cancelling state.
            let _ = jobs.cancel(&job_id);
            if let Ok(status) = jobs.mark_cancelled(&job_id) {
                let _ = events.send(status);
            }
        }
        Ok(Some(Err(error))) => eprintln!("qa-scribe Chat job terminal transition failed: {error}"),
        Err(error) => {
            // A poisoned cancellation gate cannot permit a late successful
            // finalizer. Reconcile this worker's already stopped execution.
            let _ = state.with_service(|service| {
                lifecycle::fail(service, &prepared, ChatFailureKind::Failed, &error)
            });
            if let Ok(status) = jobs.fail(&job_id, &error) {
                let _ = events.send(status);
            }
        }
    }
}
