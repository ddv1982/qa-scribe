use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

use serde_json::{Value, json};

use super::{
    claude_default_snapshot_from_sources, codex_default_snapshot,
    copilot_default_snapshot_from_sources,
};
use crate::commands::providers::{
    ProviderDefaultOriginKind, ProviderDefaultResolution, ProviderDiscoveryState,
    ProviderResolutionScope, ProviderWarningSeverity,
    probe::{CodexAppServerDefaults, CodexDefaultsProbe, CommandProbe, ProbeRunner},
};

static SETTINGS_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

struct CodexAppServerRunner {
    config: Value,
    models: Vec<Value>,
}

impl ProbeRunner for CodexAppServerRunner {
    fn executable_path(&self, _program: &str) -> Option<PathBuf> {
        None
    }

    fn run(&self, _program: &str, _args: &[&str]) -> CommandProbe {
        CommandProbe::not_found()
    }

    fn codex_app_server_defaults(&self) -> CodexDefaultsProbe {
        CodexDefaultsProbe::Success(CodexAppServerDefaults {
            config: self.config.clone(),
            models: self.models.clone(),
        })
    }
}

#[test]
fn codex_snapshot_keeps_configured_values_origins_and_catalog_warning() {
    let runner = CodexAppServerRunner {
        config: json!({
            "config": {"model": "gpt-private", "model_reasoning_effort": "high"},
            "origins": {
                "model": {"name": {"file": "/home/test/.codex/config.toml"}},
                "model_reasoning_effort": {"name": {"file": "/home/test/.codex/config.toml"}}
            }
        }),
        models: vec![json!({
            "id": "gpt-5.5", "model": "gpt-5.5", "isDefault": true,
            "defaultReasoningEffort": "medium",
            "supportedReasoningEfforts": [{"reasoningEffort": "low"}, {"reasoningEffort": "medium"}]
        })],
    };

    let snapshot = codex_default_snapshot(&runner, &[], Some("codex-cli 0.144.1".to_string()));

    assert_eq!(snapshot.model.value.as_deref(), Some("gpt-private"));
    assert_eq!(snapshot.reasoning_effort.value.as_deref(), Some("high"));
    assert_eq!(
        snapshot.model.origin.as_ref().map(|origin| origin.kind),
        Some(ProviderDefaultOriginKind::ProjectConfig)
    );
    assert_eq!(
        snapshot.model.resolution,
        ProviderDefaultResolution::Configured
    );
    assert_eq!(snapshot.model.recommended_value.as_deref(), Some("gpt-5.5"));
    assert_eq!(
        snapshot.reasoning_effort.resolution,
        ProviderDefaultResolution::Configured
    );
    assert!(snapshot.warnings.iter().any(|warning| {
        warning.code == "unlisted-configured-model"
            && warning.severity == ProviderWarningSeverity::Advisory
    }));
}

#[test]
fn claude_defaults_apply_managed_then_environment_precedence_without_project_settings() {
    let user = write_settings(
        "claude-user",
        r#"{"model":"user-model","effortLevel":"low"}"#,
    );
    let managed = write_settings(
        "claude-managed",
        r#"{"model":"managed-model","effortLevel":"high"}"#,
    );

    let snapshot = claude_default_snapshot_from_sources(
        vec![user.clone(), managed.clone()],
        Some("environment-model".to_string()),
        None,
        Some("2.1.50".to_string()),
    );

    assert_eq!(snapshot.state, ProviderDiscoveryState::Detected);
    assert_eq!(snapshot.model.value.as_deref(), Some("environment-model"));
    assert_eq!(
        snapshot.model.origin.as_ref().map(|origin| origin.kind),
        Some(ProviderDefaultOriginKind::Environment)
    );
    assert_eq!(snapshot.reasoning_effort.value.as_deref(), Some("high"));
    assert_eq!(
        snapshot
            .reasoning_effort
            .origin
            .as_ref()
            .map(|origin| origin.kind),
        Some(ProviderDefaultOriginKind::ConfigFile)
    );
    assert_eq!(
        snapshot.resolution_scope,
        ProviderResolutionScope::neutral()
    );

    let provider_managed =
        claude_default_snapshot_from_sources(Vec::new(), Some("default".to_string()), None, None);
    assert_eq!(
        provider_managed.state,
        ProviderDiscoveryState::ProviderManaged
    );
    assert_eq!(provider_managed.model.value, None);

    let _ = fs::remove_file(user);
    let _ = fs::remove_file(managed);
}

#[test]
fn copilot_defaults_keep_auto_distinct_from_an_explicit_configured_model() {
    let settings = write_settings(
        "copilot-user",
        "{ model: 'gpt-user', effortLevel: 'high', trailing: true, }",
    );

    let configured = copilot_default_snapshot_from_sources(
        Some(settings.clone()),
        None,
        Some("1.0.70".to_string()),
    );
    assert_eq!(configured.model.value.as_deref(), Some("gpt-user"));
    assert_eq!(
        configured.model.resolution,
        ProviderDefaultResolution::Configured
    );
    assert_eq!(configured.reasoning_effort.value.as_deref(), Some("high"));
    assert_eq!(configured.model.recommended_value.as_deref(), Some("auto"));

    let automatic = copilot_default_snapshot_from_sources(
        Some(settings.clone()),
        Some("auto".to_string()),
        None,
    );
    assert_eq!(automatic.model.value, None);
    assert_eq!(
        automatic.model.resolution,
        ProviderDefaultResolution::ProviderManaged
    );
    assert_eq!(automatic.model.recommended_value.as_deref(), Some("auto"));
    assert_eq!(automatic.reasoning_effort.value.as_deref(), Some("high"));

    let _ = fs::remove_file(settings);
}

fn write_settings(label: &str, contents: &str) -> PathBuf {
    let id = SETTINGS_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!(
        "qa-scribe-provider-defaults-{}-{id}-{label}.json",
        std::process::id()
    ));
    fs::write(&path, contents).expect("settings fixture should write");
    path
}
