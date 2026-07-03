//! Tauri-side orchestration of one streaming provider run: readiness check,
//! command construction, and throttled forwarding of stream updates to the
//! UI channel and job store. The workflow and stream parsing live in core.

use std::time::{Duration, Instant};

use qa_scribe_core::{
    ai::{ProviderGenerationOutput, stream::StreamUpdate, streaming_generation_command},
    domain::AiProvider,
};
use tauri::ipc::Channel;

use super::{
    job_events::{GenerationJobEvent, send_event, send_progress},
    streaming_exec::run_generation_command_streaming,
};
use crate::{
    commands::providers::provider_readiness,
    jobs::{JobControl, JobStore},
};

const PARTIAL_UPDATE_MIN_BYTES: usize = 512;
const PARTIAL_UPDATE_INTERVAL: Duration = Duration::from_millis(250);

#[allow(clippy::too_many_arguments)]
pub(super) fn execute_provider_generation_streaming(
    provider: AiProvider,
    model: &str,
    reasoning_effort: Option<&str>,
    prompt: &str,
    log_context: &str,
    job_id: &str,
    jobs: &JobStore,
    events: &Channel<GenerationJobEvent>,
    control: &JobControl,
) -> Result<ProviderGenerationOutput, String> {
    let readiness = provider_readiness(provider);
    if !readiness.descriptor.status.is_ready() {
        return Err(readiness.descriptor.reason);
    }

    let command = streaming_generation_command(
        provider,
        prompt,
        model,
        reasoning_effort,
        readiness.copilot_direct_cli_ready,
    )?;
    let started = Instant::now();
    let mut last_partial_len = 0usize;
    let mut last_partial_emit = Instant::now()
        .checked_sub(PARTIAL_UPDATE_INTERVAL)
        .unwrap_or_else(Instant::now);
    let output = run_generation_command_streaming(&command, control, |update| match update {
        StreamUpdate::Progress(message) => {
            let _ = send_progress(events, jobs, job_id, &message);
        }
        StreamUpdate::Partial(body) => {
            let body_len = body.len();
            let enough_new_text = body_len < last_partial_len
                || body_len.saturating_sub(last_partial_len) >= PARTIAL_UPDATE_MIN_BYTES;
            if !enough_new_text && last_partial_emit.elapsed() < PARTIAL_UPDATE_INTERVAL {
                return;
            }
            last_partial_len = body_len;
            last_partial_emit = Instant::now();
            let status = jobs.update_partial(job_id, &body);
            if let Ok(status) = status {
                send_event(
                    events,
                    GenerationJobEvent::Partial {
                        job_id: job_id.to_string(),
                        status,
                        body,
                    },
                );
            }
        }
    });
    eprintln!(
        "qa-scribe {log_context} provider stream finished: elapsed_ms={}, success={}, failure={}",
        started.elapsed().as_millis(),
        output
            .as_ref()
            .map(ProviderGenerationOutput::success)
            .unwrap_or(false),
        output_failure_for_log(&output)
    );
    output
}

fn output_failure_for_log(output: &Result<ProviderGenerationOutput, String>) -> String {
    match output {
        Ok(output) if output.success() => "none".to_string(),
        Ok(output) => truncate_for_log(&output.failure_message(), 500),
        Err(error) => truncate_for_log(error, 500),
    }
}

fn truncate_for_log(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    let mut chars = trimmed.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else if truncated.is_empty() {
        "none".to_string()
    } else {
        truncated
    }
}
