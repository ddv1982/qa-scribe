//! Tests for `provider_readiness_with_runners`'s Fast/Deep cache precedence:
//! a cached Deep SUCCESS is authoritative for the TTL, but a cached Deep
//! FAILURE must not outrank a working Fast result.

use qa_scribe_core::domain::AiProvider;

use super::super::{
    ProviderCatalogSource, ProviderCatalogState, ProviderDiscoveryErrorCode, ProviderState,
    cache::{cache_readiness, clear_readiness_cache, retain_last_successful_discovery},
    detection::{detect_provider, provider_readiness_with_runners},
    probe::{CommandProbe, DetectionMode},
};
use super::support::{MockRunner, readiness_cache_guard};

#[test]
fn provider_readiness_deep_checks_when_fast_detection_misses() {
    // Both tests in this module seed/read the process-global readiness
    // cache for `AiProvider::CodexCli`; hold the shared lock so they can't
    // interleave (see `readiness_cache_guard` for why).
    let _guard = readiness_cache_guard();
    clear_readiness_cache();
    let fast_runner = MockRunner::default();
    let deep_runner = MockRunner::default()
        .with("codex", &["--version"], CommandProbe::success())
        .with("codex", &["login", "status"], CommandProbe::success());

    let readiness =
        provider_readiness_with_runners(AiProvider::CodexCli, &fast_runner, &deep_runner);

    assert_eq!(readiness.descriptor.status, ProviderState::Ready);
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
fn stale_catalog_reuse_requires_a_transient_same_identity_failure_and_preserves_projection() {
    let _guard = readiness_cache_guard();
    clear_readiness_cache();
    const ORIGINAL_IDENTITY: u64 = 424_242;
    const SWITCHED_IDENTITY: u64 = 424_243;

    let successful_runner = MockRunner::default()
        .with(
            "claude",
            &["--version"],
            CommandProbe::success_with_stdout("2.1.50 (Claude Code)"),
        )
        .with(
            "claude",
            &["--help"],
            CommandProbe::success_with_stdout("--model use 'account-model'"),
        )
        .with(
            "claude",
            &["auth", "status", "--json"],
            CommandProbe::success(),
        );
    let mut successful = detect_provider(
        AiProvider::ClaudeCode,
        &successful_runner,
        DetectionMode::Deep,
    );
    assert_eq!(
        successful.descriptor.catalog_snapshot.state,
        ProviderCatalogState::Fresh
    );
    let compatibility_projection = vec![successful.descriptor.models[0].clone()];
    successful.descriptor.catalog_snapshot.source = ProviderCatalogSource::CliCatalog;
    successful.descriptor.models = compatibility_projection.clone();
    cache_readiness(
        AiProvider::ClaudeCode,
        DetectionMode::Deep,
        ORIGINAL_IDENTITY,
        &successful,
    );

    let failed_runner = MockRunner::default()
        .with(
            "claude",
            &["--version"],
            CommandProbe::success_with_stdout("2.1.50 (Claude Code)"),
        )
        .with(
            "claude",
            &["auth", "status", "--json"],
            CommandProbe::success(),
        );
    let failed = detect_provider(AiProvider::ClaudeCode, &failed_runner, DetectionMode::Deep);
    assert_eq!(
        failed.descriptor.catalog_snapshot.state,
        ProviderCatalogState::Failed
    );

    for code in [
        ProviderDiscoveryErrorCode::AuthRequired,
        ProviderDiscoveryErrorCode::PolicyDenied,
        ProviderDiscoveryErrorCode::Cancelled,
        ProviderDiscoveryErrorCode::ProtocolIncompatible,
        ProviderDiscoveryErrorCode::InvalidResponse,
        ProviderDiscoveryErrorCode::OutputLimit,
    ] {
        let mut terminal_failure = failed.clone();
        terminal_failure
            .descriptor
            .catalog_snapshot
            .error
            .as_mut()
            .expect("failed catalogs carry an error")
            .code = code;
        let retained = retain_last_successful_discovery(
            AiProvider::ClaudeCode,
            ORIGINAL_IDENTITY,
            terminal_failure,
        );
        assert_eq!(
            retained.descriptor.catalog_snapshot.state,
            ProviderCatalogState::Failed
        );
    }

    let mut transient_failure = failed;
    transient_failure
        .descriptor
        .catalog_snapshot
        .error
        .as_mut()
        .expect("failed catalogs carry an error")
        .code = ProviderDiscoveryErrorCode::Network;
    let stale = retain_last_successful_discovery(
        AiProvider::ClaudeCode,
        ORIGINAL_IDENTITY,
        transient_failure.clone(),
    );
    assert_eq!(
        stale.descriptor.catalog_snapshot.state,
        ProviderCatalogState::Stale
    );
    assert!(
        stale
            .descriptor
            .catalog_snapshot
            .models
            .iter()
            .any(|model| model.id == "account-model")
    );
    assert_eq!(stale.descriptor.models, compatibility_projection);

    let switched = retain_last_successful_discovery(
        AiProvider::ClaudeCode,
        SWITCHED_IDENTITY,
        transient_failure,
    );
    assert_eq!(
        switched.descriptor.catalog_snapshot.state,
        ProviderCatalogState::Failed
    );
    clear_readiness_cache();
}

#[test]
fn cached_deep_failure_falls_back_to_a_working_fast_result_instead_of_blocking() {
    // See the lock's doc comment: this test and
    // `provider_readiness_deep_checks_when_fast_detection_misses` share the
    // global readiness cache for `AiProvider::CodexCli` and must not run
    // concurrently.
    let _guard = readiness_cache_guard();
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
        0,
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
