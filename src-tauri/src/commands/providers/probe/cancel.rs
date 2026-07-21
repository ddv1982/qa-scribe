use std::{
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::Duration,
};

use crate::commands::providers::{ProviderDiscoveryError, ProviderDiscoveryErrorCode};
use crate::jobs::JobControl;

pub(super) const CANCELLATION_POLL_INTERVAL: Duration = Duration::from_millis(25);
static DISCOVERY_CANCELLATION_EPOCH: AtomicU64 = AtomicU64::new(0);
static PROVIDER_DISCOVERY_SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

#[derive(Clone)]
pub(super) struct DiscoveryCancellation {
    epoch: u64,
    job_control: Option<JobControl>,
}

impl DiscoveryCancellation {
    pub(super) fn capture() -> Self {
        Self {
            epoch: DISCOVERY_CANCELLATION_EPOCH.load(Ordering::Acquire),
            job_control: None,
        }
    }

    pub(super) fn for_job(job_control: &JobControl) -> Self {
        Self {
            epoch: DISCOVERY_CANCELLATION_EPOCH.load(Ordering::Acquire),
            job_control: Some(job_control.clone()),
        }
    }

    pub(super) fn is_cancelled(&self) -> bool {
        PROVIDER_DISCOVERY_SHUTTING_DOWN.load(Ordering::Acquire)
            || self.epoch != DISCOVERY_CANCELLATION_EPOCH.load(Ordering::Acquire)
            || self
                .job_control
                .as_ref()
                .is_some_and(JobControl::is_cancelled)
    }

    pub(super) fn check(&self, provider_label: &str) -> Result<(), ProviderDiscoveryError> {
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
            job_control: None,
        };

        let error = cancellation.check("Provider").unwrap_err();

        assert_eq!(error.code, ProviderDiscoveryErrorCode::Cancelled);
        assert_eq!(error.message, "Provider model discovery was cancelled.");
        assert!(!error.retryable);
    }
}
