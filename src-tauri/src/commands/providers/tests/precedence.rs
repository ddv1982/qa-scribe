//! Tests for `provider_readiness_with_runners`'s Fast/Deep cache precedence:
//! a cached Deep SUCCESS is authoritative for the TTL, but a cached Deep
//! FAILURE must not outrank a working Fast result.

use qa_scribe_core::domain::AiProvider;

use super::super::{
    ProviderState,
    cache::{cache_readiness, clear_readiness_cache},
    detection::{detect_provider, provider_readiness_with_runners},
    probe::{CommandProbe, DetectionMode},
};
use super::support::MockRunner;

#[test]
fn provider_readiness_deep_checks_when_fast_detection_misses() {
    clear_readiness_cache();
    let fast_runner = MockRunner::default();
    let deep_runner = MockRunner::default()
        .with("codex", &["--version"], CommandProbe::success())
        .with("codex", &["login", "status"], CommandProbe::success());

    let readiness =
        provider_readiness_with_runners(AiProvider::CodexCli, &fast_runner, &deep_runner);

    assert_eq!(readiness.descriptor.status, ProviderState::Ready);
    assert_eq!(
        readiness.descriptor.executable_path.as_deref(),
        Some("/mock/bin/codex")
    );
    assert!(fast_runner.calls().is_empty());
    assert!(deep_runner.calls().contains(&"codex --version".to_string()));
    assert!(
        deep_runner
            .calls()
            .contains(&"codex login status".to_string())
    );
    clear_readiness_cache();
}

#[test]
fn cached_deep_failure_falls_back_to_a_working_fast_result_instead_of_blocking() {
    clear_readiness_cache();

    // Seed a Deep cache entry that failed authentication (e.g. a CLI
    // without the expected auth subcommand). Under the old precedence this
    // was served unconditionally for the TTL, even though Fast detection
    // (executable present) would report Ready.
    let deep_runner = MockRunner::default()
        .with("codex", &["--version"], CommandProbe::success())
        .with(
            "codex",
            &["login", "status"],
            CommandProbe::failed("not logged in"),
        );
    let stale_deep_failure =
        detect_provider(AiProvider::CodexCli, &deep_runner, DetectionMode::Deep);
    assert_eq!(
        stale_deep_failure.descriptor.status,
        ProviderState::AuthRequired
    );
    cache_readiness(
        AiProvider::CodexCli,
        DetectionMode::Deep,
        &stale_deep_failure,
    );

    // Fast detection would find the executable and report Ready.
    let fast_runner = MockRunner::default().with_executable("codex");
    let unused_deep_runner = MockRunner::default();

    let readiness =
        provider_readiness_with_runners(AiProvider::CodexCli, &fast_runner, &unused_deep_runner);

    // The cached Deep AuthRequired must not outrank the working Fast
    // result: the caller should see Ready (or at minimum a fresh probe),
    // never the stale cached failure served blindly.
    assert_ne!(readiness.descriptor.status, ProviderState::AuthRequired);
    assert_eq!(readiness.descriptor.status, ProviderState::Ready);
    assert!(readiness.descriptor.available);

    clear_readiness_cache();
}
