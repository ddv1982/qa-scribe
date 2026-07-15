use qa_scribe_core::{
    ai::{ProviderCapability, provider_capabilities},
    domain::AiProvider,
};

mod cache;
mod defaults;
mod detection;
mod models;
mod probe;
mod rollout;
#[cfg(test)]
mod tests;
mod types;

#[allow(unused_imports)]
pub use types::{
    ProviderCatalogRollout, ProviderCatalogSource, ProviderCatalogState, ProviderDefaultOrigin,
    ProviderDefaultOriginKind, ProviderDefaultResolution, ProviderDefaultSnapshot,
    ProviderDefaultValue, ProviderDescriptor, ProviderDiscoveryError, ProviderDiscoveryErrorCode,
    ProviderDiscoveryState, ProviderEvidenceConfidence, ProviderModelAvailability,
    ProviderModelCapabilities, ProviderModelCatalogSnapshot, ProviderModelDescriptor,
    ProviderModelSource, ProviderReadiness, ProviderResolutionScope, ProviderState, ProviderStatus,
    ProviderWarning, ProviderWarningSeverity,
};

use cache::{cache_readiness, clear_readiness_cache, retain_last_successful_discovery};
use detection::{detect_capability, provider_readiness_with_runners};
use probe::ProbeRunner;
use probe::{DetectionMode, SystemProbeRunner};

use crate::provider_command::{ProviderPathMode, invalidate_provider_path_cache};

pub fn cancel_active_provider_discovery() {
    probe::cancel_all_provider_discovery();
}

#[tauri::command]
#[specta::specta]
pub fn get_provider_status() -> ProviderStatus {
    provider_status_with_system_runner()
}

#[tauri::command]
#[specta::specta]
pub async fn refresh_provider_status() -> ProviderStatus {
    clear_readiness_cache();
    invalidate_provider_path_cache();
    tauri::async_runtime::spawn_blocking(|| {
        provider_status_with_system_runner_for_mode(DetectionMode::Deep)
    })
    .await
    .expect("provider discovery worker should complete")
}

pub fn provider_readiness(provider: AiProvider) -> ProviderReadiness {
    provider_readiness_with_runners(
        provider,
        &SystemProbeRunner::new(ProviderPathMode::Fast),
        &SystemProbeRunner::new(ProviderPathMode::Deep),
    )
}

#[cfg(test)]
fn provider_status_with_runner(runner: &impl ProbeRunner, mode: DetectionMode) -> ProviderStatus {
    ProviderStatus {
        providers: provider_capabilities()
            .into_iter()
            .map(|capability| detect_capability(capability, runner, mode).descriptor)
            .collect(),
        catalog_rollout: rollout::provider_catalog_rollout(),
    }
}

fn provider_status_with_system_runner() -> ProviderStatus {
    provider_status_with_system_runner_for_mode(DetectionMode::Fast)
}

fn provider_status_with_system_runner_for_mode(mode: DetectionMode) -> ProviderStatus {
    let capabilities = provider_capabilities();
    let readinesses = if mode == DetectionMode::Deep {
        std::thread::scope(|scope| {
            capabilities
                .into_iter()
                .map(|capability| scope.spawn(move || detect_system_capability(capability, mode)))
                .collect::<Vec<_>>()
                .into_iter()
                .map(|worker| {
                    worker
                        .join()
                        .expect("provider detection worker should complete")
                })
                .collect::<Vec<_>>()
        })
    } else {
        capabilities
            .into_iter()
            .map(|capability| detect_system_capability(capability, mode))
            .collect()
    };

    ProviderStatus {
        providers: readinesses
            .into_iter()
            .map(|(_, readiness)| readiness.descriptor)
            .collect(),
        catalog_rollout: rollout::provider_catalog_rollout(),
    }
}

fn detect_system_capability(
    capability: ProviderCapability,
    mode: DetectionMode,
) -> (AiProvider, ProviderReadiness) {
    let provider = capability.id;
    // A fresh runner gives every provider its own absolute transaction
    // deadline. Deep detection runs providers concurrently, so one slow CLI
    // cannot consume another provider's budget or add its timeout serially.
    let runner = SystemProbeRunner::new(mode.into());
    let readiness = detect_capability(capability, &runner, mode);
    let fingerprint = runner.cache_fingerprint(provider);
    let readiness = if mode == DetectionMode::Deep {
        retain_last_successful_discovery(provider, fingerprint, readiness)
    } else {
        readiness
    };
    cache_readiness(provider, mode, fingerprint, &readiness);
    (provider, readiness)
}
