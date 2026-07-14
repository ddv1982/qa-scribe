use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use qa_scribe_core::domain::AiProvider;

use super::{
    probe::DetectionMode,
    types::{
        ProviderCatalogState, ProviderDiscoveryError, ProviderDiscoveryErrorCode,
        ProviderDiscoveryState, ProviderReadiness, ReadinessCacheKey,
    },
};

const READINESS_CACHE_TTL: Duration = Duration::from_secs(30);
static READINESS_CACHE: OnceLock<Mutex<HashMap<ReadinessCacheKey, CachedProviderReadiness>>> =
    OnceLock::new();
static LAST_SUCCESSFUL_DEFAULTS: OnceLock<Mutex<HashMap<AiProvider, LastSuccessfulReadiness>>> =
    OnceLock::new();
static LAST_SUCCESSFUL_CATALOGS: OnceLock<Mutex<HashMap<AiProvider, LastSuccessfulReadiness>>> =
    OnceLock::new();

#[derive(Clone, Debug)]
struct CachedProviderReadiness {
    checked_at: Instant,
    readiness: ProviderReadiness,
}

#[derive(Clone, Debug)]
struct LastSuccessfulReadiness {
    fingerprint: u64,
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
    fingerprint: u64,
) -> Option<ProviderReadiness> {
    let cache = READINESS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(cached) = cache.lock()
        && let Some(entry) = cached.get(&ReadinessCacheKey {
            provider,
            mode,
            fingerprint,
        })
        && entry.checked_at.elapsed() < READINESS_CACHE_TTL
    {
        return Some(entry.readiness.clone());
    }
    None
}

pub(super) fn cache_readiness(
    provider: AiProvider,
    mode: DetectionMode,
    fingerprint: u64,
    readiness: &ProviderReadiness,
) {
    let cache = READINESS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut cache) = cache.lock() {
        cache.insert(
            ReadinessCacheKey {
                provider,
                mode,
                fingerprint,
            },
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
            successes.insert(
                provider,
                LastSuccessfulReadiness {
                    fingerprint,
                    readiness: readiness.clone(),
                },
            );
        }
    }
    if mode == DetectionMode::Deep
        && readiness
            .descriptor
            .catalog_snapshot
            .has_successful_observation()
    {
        let successes = LAST_SUCCESSFUL_CATALOGS.get_or_init(|| Mutex::new(HashMap::new()));
        if let Ok(mut successes) = successes.lock() {
            successes.insert(
                provider,
                LastSuccessfulReadiness {
                    fingerprint,
                    readiness: readiness.clone(),
                },
            );
        }
    }
}

pub(super) fn retain_last_successful_discovery(
    provider: AiProvider,
    fingerprint: u64,
    readiness: ProviderReadiness,
) -> ProviderReadiness {
    retain_last_successful_catalog(
        provider,
        fingerprint,
        retain_last_successful_defaults(provider, fingerprint, readiness),
    )
}

pub(super) fn retain_last_successful_defaults(
    provider: AiProvider,
    fingerprint: u64,
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
    let Some(previous) = successes
        .get(&provider)
        .filter(|previous| previous.fingerprint == fingerprint)
    else {
        return readiness;
    };

    let mut snapshot = previous.readiness.descriptor.default_snapshot.clone();
    snapshot.state = ProviderDiscoveryState::Stale;
    snapshot.error = current_error;
    snapshot.warnings.extend(current_warnings);
    readiness.descriptor.default_snapshot = snapshot;
    readiness
}

fn retain_last_successful_catalog(
    provider: AiProvider,
    fingerprint: u64,
    mut readiness: ProviderReadiness,
) -> ProviderReadiness {
    if readiness.descriptor.catalog_snapshot.state != ProviderCatalogState::Failed {
        return readiness;
    }
    let current_error = readiness.descriptor.catalog_snapshot.error.clone();
    if !catalog_failure_allows_stale_reuse(current_error.as_ref()) {
        return readiness;
    }
    let current_warnings = readiness.descriptor.catalog_snapshot.warnings.clone();
    let Some(successes) = LAST_SUCCESSFUL_CATALOGS.get() else {
        return readiness;
    };
    let Ok(successes) = successes.lock() else {
        return readiness;
    };
    let Some(previous) = successes
        .get(&provider)
        .filter(|previous| previous.fingerprint == fingerprint)
    else {
        return readiness;
    };

    let mut snapshot = previous.readiness.descriptor.catalog_snapshot.clone();
    snapshot.state = ProviderCatalogState::Stale;
    snapshot.error = current_error;
    snapshot.warnings.extend(current_warnings);
    // The descriptor is the rollout-aware selector projection. In diagnostics
    // it deliberately differs from the authoritative account catalog retained
    // in the snapshot, so reuse the prior projection instead of promoting the
    // account catalog into the selector after a failed refresh.
    readiness.descriptor.models = previous.readiness.descriptor.models.clone();
    readiness.descriptor.catalog_snapshot = snapshot;
    readiness
}

fn catalog_failure_allows_stale_reuse(error: Option<&ProviderDiscoveryError>) -> bool {
    error.is_some_and(|error| {
        error.retryable
            && matches!(
                error.code,
                ProviderDiscoveryErrorCode::SpawnFailed
                    | ProviderDiscoveryErrorCode::HandshakeFailed
                    | ProviderDiscoveryErrorCode::TimedOut
                    | ProviderDiscoveryErrorCode::Network
                    | ProviderDiscoveryErrorCode::RateLimited
                    | ProviderDiscoveryErrorCode::Unavailable
            )
    })
}
