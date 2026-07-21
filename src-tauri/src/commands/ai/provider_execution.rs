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
    commands::providers::provider_readiness_for_job,
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
    if control.is_cancelled() {
        return Err("Generation cancelled.".to_string());
    }
    let readiness = provider_readiness_for_job(provider, control);
    if control.is_cancelled() {
        return Err("Generation cancelled.".to_string());
    }
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
    let mut partial_body = String::new();
    let mut last_partial_emit = Instant::now()
        .checked_sub(PARTIAL_UPDATE_INTERVAL)
        .unwrap_or_else(Instant::now);
    let mut forward_partial = |body: &str| {
        let body_len = body.len();
        let enough_new_text = body_len < last_partial_len
            || body_len.saturating_sub(last_partial_len) >= PARTIAL_UPDATE_MIN_BYTES;
        if !enough_new_text && last_partial_emit.elapsed() < PARTIAL_UPDATE_INTERVAL {
            return;
        }
        last_partial_len = body_len;
        last_partial_emit = Instant::now();
        if let Ok(status) = jobs.update_partial(job_id, body) {
            send_event(
                events,
                GenerationJobEvent::Partial {
                    job_id: job_id.to_string(),
                    status,
                    body: body.to_string(),
                },
            );
        }
    };
    let output = run_generation_command_streaming(&command, control, |update| match update {
        StreamUpdate::Progress(message) => {
            let _ = send_progress(events, jobs, job_id, &message);
        }
        StreamUpdate::PartialDelta(delta) => {
            partial_body.push_str(&delta);
            forward_partial(&partial_body);
        }
        StreamUpdate::PartialSnapshot(body) => {
            partial_body = body;
            forward_partial(&partial_body);
        }
    });
    eprintln!(
        "qa-scribe {log_context} provider stream finished: elapsed_ms={}, outcome={}",
        started.elapsed().as_millis(),
        output_outcome_for_log(&output)
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
        return Ok(());
    }

    let model = if uses_default_model {
        provider.default_snapshot.model.value.as_deref()
    } else {
        Some(model_override.trim())
    };
    let reasoning =
        reasoning_override.or(provider.default_snapshot.reasoning_effort.value.as_deref());
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

fn output_outcome_for_log(output: &Result<ProviderGenerationOutput, String>) -> &'static str {
    match output {
        Ok(output) if output.success() => "success",
        Ok(output) if output.cancelled => "cancelled",
        Ok(_) => "provider_failed",
        Err(_) => "execution_failed",
    }
}

#[cfg(test)]
mod tests {
    use crate::commands::providers::{
        ProviderCatalogSource, ProviderDefaultOrigin, ProviderDefaultOriginKind,
        ProviderDefaultResolution, ProviderDefaultSnapshot, ProviderDefaultValue,
        ProviderDescriptor, ProviderDiscoveryState, ProviderEvidenceConfidence,
        ProviderModelAvailability, ProviderModelCapabilities, ProviderModelCatalogSnapshot,
        ProviderModelDescriptor, ProviderModelSource, ProviderResolutionScope, ProviderState,
    };

    use super::validate_effective_selection;

    fn codex_descriptor() -> ProviderDescriptor {
        let models = vec![ProviderModelDescriptor {
            id: "gpt-codex".to_string(),
            label: "gpt-codex".to_string(),
            description: None,
            source: ProviderModelSource::CliCatalog,
            availability: ProviderModelAvailability::Available,
            confidence: ProviderEvidenceConfidence::Authoritative,
            is_default: true,
            reasoning_efforts: vec!["low".to_string()],
            default_reasoning_effort: Some("low".to_string()),
            capabilities: ProviderModelCapabilities::default(),
            resolved_model: None,
        }];
        ProviderDescriptor {
            id: "codex_cli".to_string(),
            label: "Codex CLI",
            status: ProviderState::Ready,
            available: true,
            reason: "ready".to_string(),
            command: Some("codex".to_string()),
            models: models.clone(),
            catalog_snapshot: ProviderModelCatalogSnapshot::fresh(
                ProviderCatalogSource::CliCatalog,
                models,
                Some("codex-cli 0.144.1".to_string()),
                Vec::new(),
            ),
            default_snapshot: ProviderDefaultSnapshot {
                state: ProviderDiscoveryState::Detected,
                model: ProviderDefaultValue::new(
                    Some("gpt-codex".to_string()),
                    ProviderDefaultResolution::Configured,
                    Some(ProviderDefaultOrigin {
                        kind: ProviderDefaultOriginKind::UserConfig,
                        label: "User configuration".to_string(),
                        display_path: Some("~/.codex/config.toml".to_string()),
                    }),
                    None,
                ),
                reasoning_effort: ProviderDefaultValue::new(
                    Some("stale-value".to_string()),
                    ProviderDefaultResolution::Configured,
                    None,
                    None,
                ),
                checked_at: Some("2026-07-13T10:00:00Z".to_string()),
                cli_version: Some("codex-cli 0.144.1".to_string()),
                resolution_scope: ProviderResolutionScope::neutral(),
                error: None,
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
    fn unadvertised_configured_codex_default_is_delegated_to_cli() {
        let mut provider = codex_descriptor();
        provider.default_snapshot.model.value = Some("requires-newer-cli".to_string());

        assert_eq!(
            validate_effective_selection(&provider, "default", None),
            Ok(())
        );
    }
}
