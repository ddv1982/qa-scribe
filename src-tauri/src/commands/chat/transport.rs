use std::time::{Duration, Instant};

use qa_scribe_core::ai::{
    ProviderExecutionError, ProviderGenerationOutput, chat::duplex_chat_command,
    stream::StreamUpdate,
};
use tauri::ipc::Channel;

use super::StartChatJobRequest;
use crate::{
    commands::{
        ai::{
            chat_duplex::{ChatDuplexContext, run_chat_duplex},
            provider_execution::validate_effective_selection,
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
    pub app_data_dir: &'a std::path::Path,
}

impl ChatTransport<'_> {
    pub fn execute(
        &self,
        request: &StartChatJobRequest,
        prompt: &str,
    ) -> Result<ProviderGenerationOutput, ProviderExecutionError> {
        if self.control.is_cancelled() {
            return Err("Generation cancelled.".into());
        }
        let readiness = provider_readiness_for_job(request.provider, self.control);
        if self.control.is_cancelled() {
            return Err("Generation cancelled.".into());
        }
        if !readiness.descriptor.status.is_ready() {
            return Err(readiness.descriptor.reason.into());
        }
        validate_effective_selection(
            &readiness.descriptor,
            &request.model,
            request.reasoning_effort.as_deref(),
        )?;
        let command = duplex_chat_command(
            request.provider,
            prompt,
            &request.model,
            request.reasoning_effort.as_deref(),
            readiness.copilot_direct_cli_ready,
        )?;
        let mut partial = String::new();
        let mut last_emit = Instant::now();
        let mut last_len = 0usize;
        run_chat_duplex(
            &command,
            &ChatDuplexContext {
                job_id: self.job_id,
                jobs: self.jobs,
                control: self.control,
                provider: request.provider,
                app_data_dir: self.app_data_dir,
                model: &request.model,
                reasoning_effort: request.reasoning_effort.as_deref(),
            },
            |update| {
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
            },
            |status| {
                let _ = self.events.send(status);
            },
        )
    }
}
