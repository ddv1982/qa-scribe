use std::{
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::Duration,
};

use crate::commands::providers::{ProviderDiscoveryError, ProviderDiscoveryErrorCode};

pub(super) const CANCELLATION_POLL_INTERVAL: Duration = Duration::from_millis(25);
static DISCOVERY_CANCELLATION_EPOCH: AtomicU64 = AtomicU64::new(0);
static PROVIDER_DISCOVERY_SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy)]
pub(super) struct DiscoveryCancellation {
    epoch: u64,
}

impl DiscoveryCancellation {
    pub(super) fn capture() -> Self {
        Self {
            epoch: DISCOVERY_CANCELLATION_EPOCH.load(Ordering::Acquire),
        }
    }

    pub(super) fn is_cancelled(self) -> bool {
        PROVIDER_DISCOVERY_SHUTTING_DOWN.load(Ordering::Acquire)
            || self.epoch != DISCOVERY_CANCELLATION_EPOCH.load(Ordering::Acquire)
    }

    pub(super) fn check(self, provider_label: &str) -> Result<(), ProviderDiscoveryError> {
        if self.is_cancelled() {
            Err(ProviderDiscoveryError {
                code: ProviderDiscoveryErrorCode::Cancelled,
                message: format!("{provider_label} model discovery was cancelled."),
                retryable: false,
            })
        } else {
            Ok(())
        }
    }
}

pub(in crate::commands::providers) fn cancel_all_provider_discovery() {
    PROVIDER_DISCOVERY_SHUTTING_DOWN.store(true, Ordering::Release);
    DISCOVERY_CANCELLATION_EPOCH.fetch_add(1, Ordering::AcqRel);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_discovery_epoch_returns_a_sanitized_cancellation() {
        let current = DISCOVERY_CANCELLATION_EPOCH.load(Ordering::Acquire);
        let cancellation = DiscoveryCancellation {
            epoch: current.wrapping_sub(1),
        };

        let error = cancellation.check("Provider").unwrap_err();

        assert_eq!(error.code, ProviderDiscoveryErrorCode::Cancelled);
        assert_eq!(error.message, "Provider model discovery was cancelled.");
        assert!(!error.retryable);
    }
}
