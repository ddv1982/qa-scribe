use qa_scribe_core::{ai::provider_capabilities, domain::AiProvider};

mod cache;
mod detection;
mod models;
mod probe;
#[cfg(test)]
mod tests;
mod types;

#[allow(unused_imports)]
pub use types::{
    ProviderDescriptor, ProviderModelDescriptor, ProviderModelSource, ProviderReadiness,
    ProviderState, ProviderStatus,
};

use cache::{cache_readinesses, clear_readiness_cache};
use detection::{detect_capability, provider_readiness_with_runners};
use probe::ProbeRunner;
use probe::{DetectionMode, SystemProbeRunner};

use crate::provider_command::{ProviderPathMode, invalidate_provider_path_cache};

#[tauri::command]
pub fn get_provider_status() -> ProviderStatus {
    provider_status_with_system_runner()
}

#[tauri::command]
pub fn refresh_provider_status() -> ProviderStatus {
    clear_readiness_cache();
    invalidate_provider_path_cache();
    provider_status_with_system_runner_for_mode(DetectionMode::Deep)
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
    }
}

fn provider_status_with_system_runner() -> ProviderStatus {
    provider_status_with_system_runner_for_mode(DetectionMode::Fast)
}

fn provider_status_with_system_runner_for_mode(mode: DetectionMode) -> ProviderStatus {
    let runner = SystemProbeRunner::new(mode.into());
    let readinesses: Vec<_> = provider_capabilities()
        .into_iter()
        .map(|capability| {
            let provider = capability.id;
            (provider, detect_capability(capability, &runner, mode))
        })
        .collect();
    cache_readinesses(mode, &readinesses);

    ProviderStatus {
        providers: readinesses
            .into_iter()
            .map(|(_, readiness)| readiness.descriptor)
            .collect(),
    }
}
