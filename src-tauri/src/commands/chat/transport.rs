use std::time::{Duration, Instant};

use qa_scribe_core::ai::{
    ProviderGenerationOutput, chat::streaming_chat_command, stream::StreamUpdate,
};
use tauri::ipc::Channel;

use super::StartChatJobRequest;
use crate::{
    commands::{
        ai::{
            provider_execution::validate_effective_selection,
            streaming_exec::run_generation_command_streaming,
        },
        providers::provider_readiness_for_job,
    },
    jobs::{GenerationJobStatus, JobControl, JobStore},
};

pub(super) struct ChatTransport<'a> {
    pub job_id: &'a str,
    pub jobs: &'a JobStore,
    pub events: &'a Channel<GenerationJobStatus>,
    pub control: &'a JobControl,
}

impl ChatTransport<'_> {
    pub fn execute(
        &self,
        request: &StartChatJobRequest,
        prompt: &str,
    ) -> Result<ProviderGenerationOutput, String> {
        if self.control.is_cancelled() {
            return Err("Generation cancelled.".into());
        }
        let readiness = provider_readiness_for_job(request.provider, self.control);
        if self.control.is_cancelled() {
            return Err("Generation cancelled.".into());
        }
        if !readiness.descriptor.status.is_ready() {
            return Err(readiness.descriptor.reason);
        }
        validate_effective_selection(
            &readiness.descriptor,
            &request.model,
            request.reasoning_effort.as_deref(),
        )?;
        let command = streaming_chat_command(
            request.provider,
            prompt,
            &request.model,
            request.reasoning_effort.as_deref(),
            readiness.copilot_direct_cli_ready,
        )?;
        let mut partial = String::new();
        let mut last_emit = Instant::now();
        let mut last_len = 0usize;
        run_generation_command_streaming(&command, self.control, |update| {
            if self.control.is_cancelled() {
                return;
            }
            match update {
                StreamUpdate::Progress(message) => {
                    if let Ok(status) = self.jobs.update_progress(self.job_id, &message) {
                        let _ = self.events.send(status);
                    }
                    return;
                }
                StreamUpdate::PartialDelta(delta) => partial.push_str(&delta),
                StreamUpdate::PartialSnapshot(body) => partial = body,
            }
            if partial.len() < last_len
                || partial.len().saturating_sub(last_len) >= 512
                || last_emit.elapsed() >= Duration::from_millis(250)
            {
                last_emit = Instant::now();
                last_len = partial.len();
                if let Ok(status) = self.jobs.update_partial(self.job_id, &partial) {
                    let _ = self.events.send(status);
                }
            }
        })
    }
}
