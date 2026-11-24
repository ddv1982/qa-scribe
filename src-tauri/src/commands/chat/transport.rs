use std::time::{Duration, Instant};

use qa_scribe_core::ai::{
    ProviderExecutionError, ProviderGenerationOutput,
    chat::{duplex_chat_command, restrict_local_edit},
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
        providers::{codex_mcp_inventory_for_job, provider_readiness_for_job},
    },
    jobs::{GenerationJobStatus, JobControl, JobStore},
};

pub(super) struct ChatTransport<'a> {
    pub job_id: &'a str,
    pub jobs: &'a JobStore,
    pub events: &'a Channel<GenerationJobStatus>,
    pub control: &'a JobControl,
    pub app_data_dir: &'a std::path::Path,
    #[cfg(unix)]
    pub app: &'a tauri::AppHandle,
    #[cfg(unix)]
    pub turn_id: &'a str,
}

impl ChatTransport<'_> {
    pub fn execute(
        &self,
        request: &StartChatJobRequest,
        input: &qa_scribe_core::chat::ChatInput,
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
        if input.has_images() {
            validate_image_provider(request.provider)?;
            validate_image_model(&readiness.descriptor, &request.model)?;
        }
        validate_effective_selection(
            &readiness.descriptor,
            &request.model,
            request.reasoning_effort.as_deref(),
        )?;
        let mut command = duplex_chat_command(
            request.provider,
            "",
            &request.model,
            request.reasoning_effort.as_deref(),
            readiness.copilot_direct_cli_ready,
        )?;
        if input.local_edit() {
            let servers = if request.provider == qa_scribe_core::domain::AiProvider::CodexCli {
                codex_mcp_inventory_for_job(self.control, &[])?.servers_to_disable
            } else {
                Vec::new()
            };
            restrict_local_edit(&mut command, request.provider, &servers);
        }
        #[cfg(unix)]
        let logs = self.application_logs(request, input, &mut command)?;
        #[cfg(unix)]
        let (input, log_mcp_token) = match &logs {
            Some((broker, input)) => (input, broker.codex_token()),
            None => (input, None),
        };
        #[cfg(not(unix))]
        let log_mcp_token = None;
        let mut partial = String::new();
        let mut last_emit = Instant::now();
        let mut last_len = 0usize;
        run_chat_duplex(
            &command,
            &ChatDuplexContext {
                input,
                job_id: self.job_id,
                jobs: self.jobs,
                control: self.control,
                provider: request.provider,
                app_data_dir: self.app_data_dir,
                model: &request.model,
                log_mcp_token,
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

    #[cfg(unix)]
    fn application_logs(
        &self,
        request: &StartChatJobRequest,
        input: &qa_scribe_core::chat::ChatInput,
        command: &mut qa_scribe_core::ai::GenerationCommand,
    ) -> Result<
        Option<(
            crate::log_mcp::broker::LogBroker,
            qa_scribe_core::chat::ChatInput,
        )>,
        String,
    > {
        use crate::log_mcp::broker::{ChatLogScope, LogBroker};
        use qa_scribe_core::domain::{AiProvider, ChatRef};
        use tauri::Manager;

        if input.local_edit() || request.provider == AiProvider::CopilotCli {
            return Ok(None);
        }
        let reference = ChatRef {
            session_id: request.scope.session_id.clone(),
            draft_id: request.scope.draft_id.clone(),
        };
        let state = self.app.state::<crate::settings::AppState>();
        let (sources, captures) = state
            .with_service(|service| {
                let sources =
                    service.chat_log_sources(&reference, self.turn_id, request.provider)?;
                let captures =
                    service.chat_log_replay(&reference, self.turn_id, request.provider)?;
                Ok((sources, captures))
            })
            .map_err(|error| error.message)?;
        if sources.is_empty() {
            return Ok(None);
        }
        let scope = ChatLogScope {
            app: self.app.clone(),
            job_id: self.job_id.into(),
            reference,
            turn_id: self.turn_id.into(),
            provider: request.provider,
            control: self.control.clone(),
            events: self.events.clone(),
        };
        let broker = LogBroker::start(scope, command)
            .map_err(|_| "Could not start the application logs tool.")?;
        let labels = sources
            .iter()
            .map(|source| source.label.as_str())
            .collect::<Vec<_>>();
        Ok(Some((
            broker,
            input.clone().with_application_logs(&labels, &captures),
        )))
    }
}

pub(super) fn validate_image_provider(
    provider: qa_scribe_core::domain::AiProvider,
) -> Result<(), String> {
    if provider == qa_scribe_core::domain::AiProvider::CopilotCli {
        return Err("Copilot Chat does not support image attachments yet. Choose another provider or start a text-only conversation. Your message and images are kept.".into());
    }
    Ok(())
}

pub(super) fn validate_image_model(
    descriptor: &crate::commands::providers::ProviderDescriptor,
    selection: &str,
) -> Result<(), String> {
    descriptor.validate_image_model(selection)
}

#[cfg(test)]
mod image_model_tests {
    use super::*;
    use crate::commands::providers::*;

    #[test]
    fn copilot_image_transport_requires_pre_send_capability_admission() {
        assert_eq!(validate_image_provider(qa_scribe_core::domain::AiProvider::CopilotCli), Err("Copilot Chat does not support image attachments yet. Choose another provider or start a text-only conversation. Your message and images are kept.".into()));
    }

    fn descriptor(vision: Option<bool>) -> ProviderDescriptor {
        let models = vec![ProviderModelDescriptor {
            id: "model".into(),
            label: "Model".into(),
            description: None,
            source: ProviderModelSource::CliCatalog,
            availability: ProviderModelAvailability::Available,
            confidence: ProviderEvidenceConfidence::Authoritative,
            is_default: true,
            reasoning_efforts: vec![],
            default_reasoning_effort: None,
            capabilities: ProviderModelCapabilities {
                vision,
                ..Default::default()
            },
            resolved_model: None,
        }];
        ProviderDescriptor {
            id: "codex_cli".into(),
            label: "Codex CLI",
            status: ProviderState::Ready,
            available: true,
            reason: "ready".into(),
            command: Some("codex".into()),
            models: models.clone(),
            catalog_snapshot: ProviderModelCatalogSnapshot::fresh(
                ProviderCatalogSource::CliCatalog,
                models,
                None,
                vec![],
            ),
            default_snapshot: ProviderDefaultSnapshot {
                state: ProviderDiscoveryState::Detected,
                model: ProviderDefaultValue::new(
                    Some("model".into()),
                    ProviderDefaultResolution::Configured,
                    None,
                    None,
                ),
                reasoning_effort: ProviderDefaultValue::new(
                    None,
                    ProviderDefaultResolution::Unresolved,
                    None,
                    None,
                ),
                checked_at: None,
                cli_version: None,
                resolution_scope: ProviderResolutionScope::neutral(),
                error: None,
                warnings: vec![],
            },
            local_only: true,
        }
    }

    #[test]
    fn image_models_require_explicit_vision_support_including_resolved_defaults() {
        for selection in ["model", "default", "auto", ""] {
            assert_eq!(
                validate_image_model(&descriptor(Some(true)), selection),
                Ok(())
            );
            assert!(
                validate_image_model(&descriptor(Some(false)), selection)
                    .unwrap_err()
                    .contains("does not support images")
            );
            assert!(
                validate_image_model(&descriptor(None), selection)
                    .unwrap_err()
                    .contains("unknown")
            );
        }
        assert!(
            validate_image_model(&descriptor(Some(true)), "unreported-model")
                .unwrap_err()
                .contains("unknown")
        );
    }
}
