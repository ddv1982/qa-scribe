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

    validate_effective_selection(&readiness.descriptor, model, reasoning_effort)?;

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

fn validate_effective_selection(
    provider: &crate::commands::providers::ProviderDescriptor,
    model_override: &str,
    reasoning_override: Option<&str>,
) -> Result<(), String> {
    let uses_default_model = model_override.trim().is_empty()
        || model_override.eq_ignore_ascii_case("default")
        || model_override.eq_ignore_ascii_case("auto");

    // With no QA Scribe overrides, Codex is authoritative. Discovery is a
    // display snapshot and can be stale or merely recommended; it must never
    // turn a valid CLI-default invocation into a blocked preflight.
    if uses_default_model && reasoning_override.is_none() {
        if provider.id == "codex_cli"
            && provider.default_snapshot.resolution
                == crate::commands::providers::ProviderDefaultResolution::Configured
            && let Some(model) = provider.default_snapshot.model.as_deref()
            && !provider.models.is_empty()
            && !provider
                .models
                .iter()
                .any(|candidate| candidate.id == model)
        {
            return Err(format!(
                "Configured Codex CLI default model `{model}` is not advertised by the installed CLI. Upgrade Codex CLI or choose an explicit QA Scribe model override."
            ));
        }
        return Ok(());
    }

    let model = if uses_default_model {
        provider.default_snapshot.model.as_deref()
    } else {
        Some(model_override.trim())
    };
    let reasoning = reasoning_override.or(provider.default_snapshot.reasoning_effort.as_deref());
    let Some((model, reasoning)) = model.zip(reasoning) else {
        return Ok(());
    };
    let Some(descriptor) = provider
        .models
        .iter()
        .find(|candidate| candidate.id == model)
    else {
        return Ok(());
    };
    if !descriptor.reasoning_efforts.is_empty()
        && !descriptor
            .reasoning_efforts
            .iter()
            .any(|candidate| candidate == reasoning)
    {
        return Err(format!(
            "Reasoning `{reasoning}` is not supported by model `{model}`. Choose one of: {}.",
            descriptor.reasoning_efforts.join(", ")
        ));
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use crate::commands::providers::{
        ProviderDefaultResolution, ProviderDefaultSnapshot, ProviderDescriptor,
        ProviderModelDescriptor, ProviderModelSource, ProviderState,
    };

    use super::validate_effective_selection;

    fn codex_descriptor() -> ProviderDescriptor {
        ProviderDescriptor {
            id: "codex_cli".to_string(),
            label: "Codex CLI",
            status: ProviderState::Ready,
            available: true,
            reason: "ready".to_string(),
            command: Some("codex".to_string()),
            executable_path: Some("/mock/bin/codex".to_string()),
            models: vec![ProviderModelDescriptor {
                id: "gpt-codex".to_string(),
                label: "gpt-codex".to_string(),
                description: None,
                source: ProviderModelSource::Detected,
                is_default: true,
                reasoning_efforts: vec!["low".to_string()],
                default_reasoning_effort: Some("low".to_string()),
            }],
            default_snapshot: ProviderDefaultSnapshot {
                model: Some("gpt-codex".to_string()),
                reasoning_effort: Some("stale-value".to_string()),
                model_origin: None,
                reasoning_origin: None,
                resolution: ProviderDefaultResolution::Configured,
                recommended_model: None,
                recommended_reasoning_effort: None,
                warnings: Vec::new(),
            },
            local_only: true,
        }
    }

    #[test]
    fn cli_defaults_are_not_blocked_by_a_stale_discovery_snapshot() {
        assert_eq!(
            validate_effective_selection(&codex_descriptor(), "default", None),
            Ok(())
        );
    }

    #[test]
    fn explicit_reasoning_override_is_still_checked_against_the_cli_model() {
        assert!(
            validate_effective_selection(&codex_descriptor(), "default", Some("high"))
                .unwrap_err()
                .contains("not supported")
        );
    }

    #[test]
    fn unadvertised_configured_codex_default_is_rejected_before_generation() {
        let mut provider = codex_descriptor();
        provider.default_snapshot.model = Some("requires-newer-cli".to_string());

        let error = validate_effective_selection(&provider, "default", None).unwrap_err();
        assert!(error.contains("Upgrade Codex CLI"));
        assert!(error.contains("model override"));
    }
}
