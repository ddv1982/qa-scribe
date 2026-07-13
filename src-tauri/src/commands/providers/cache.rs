use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use qa_scribe_core::domain::AiProvider;

use super::{
    probe::DetectionMode,
    types::{ProviderDiscoveryState, ProviderReadiness, ReadinessCacheKey},
};

const READINESS_CACHE_TTL: Duration = Duration::from_secs(30);
static READINESS_CACHE: OnceLock<Mutex<HashMap<ReadinessCacheKey, CachedProviderReadiness>>> =
    OnceLock::new();
static LAST_SUCCESSFUL_DEFAULTS: OnceLock<Mutex<HashMap<AiProvider, ProviderReadiness>>> =
    OnceLock::new();

#[derive(Clone, Debug)]
struct CachedProviderReadiness {
    checked_at: Instant,
    readiness: ProviderReadiness,
}

pub(super) fn clear_readiness_cache() {
    if let Some(cache) = READINESS_CACHE.get()
        && let Ok(mut cache) = cache.lock()
    {
        cache.clear();
    }
}

pub(super) fn cached_readiness(
    provider: AiProvider,
    mode: DetectionMode,
) -> Option<ProviderReadiness> {
    let cache = READINESS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(cached) = cache.lock()
        && let Some(entry) = cached.get(&ReadinessCacheKey { provider, mode })
        && entry.checked_at.elapsed() < READINESS_CACHE_TTL
    {
        return Some(entry.readiness.clone());
    }
    None
}

pub(super) fn cache_readinesses(
    mode: DetectionMode,
    readinesses: &[(AiProvider, ProviderReadiness)],
) {
    for (provider, readiness) in readinesses {
        cache_readiness(*provider, mode, readiness);
    }
}

pub(super) fn cache_readiness(
    provider: AiProvider,
    mode: DetectionMode,
    readiness: &ProviderReadiness,
) {
    let cache = READINESS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut cache) = cache.lock() {
        cache.insert(
            ReadinessCacheKey { provider, mode },
            CachedProviderReadiness {
                checked_at: Instant::now(),
                readiness: readiness.clone(),
            },
        );
    }
    if mode == DetectionMode::Deep
        && readiness
            .descriptor
            .default_snapshot
            .has_successful_observation()
    {
        let successes = LAST_SUCCESSFUL_DEFAULTS.get_or_init(|| Mutex::new(HashMap::new()));
        if let Ok(mut successes) = successes.lock() {
            successes.insert(provider, readiness.clone());
        }
    }
}

pub(super) fn retain_last_successful_defaults(
    provider: AiProvider,
    mut readiness: ProviderReadiness,
) -> ProviderReadiness {
    if readiness.descriptor.default_snapshot.state != ProviderDiscoveryState::Unresolved {
        return readiness;
    }
    let current_error = readiness.descriptor.default_snapshot.error.clone();
    let current_warnings = readiness.descriptor.default_snapshot.warnings.clone();
    let Some(successes) = LAST_SUCCESSFUL_DEFAULTS.get() else {
        return readiness;
    };
    let Ok(successes) = successes.lock() else {
        return readiness;
    };
    let Some(previous) = successes.get(&provider) else {
        return readiness;
    };

    let mut snapshot = previous.descriptor.default_snapshot.clone();
    snapshot.state = ProviderDiscoveryState::Stale;
    snapshot.error = current_error;
    snapshot.warnings.extend(current_warnings);
    readiness.descriptor.default_snapshot = snapshot;
    readiness
}
