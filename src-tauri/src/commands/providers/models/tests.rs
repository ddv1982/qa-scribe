use serde_json::json;

use std::path::PathBuf;

use super::{parse_codex_app_server_models, provider_catalog};
use crate::commands::providers::{
    ProviderCatalogSource, ProviderCatalogState, ProviderDiscoveryError,
    ProviderDiscoveryErrorCode, ProviderModelAvailability, ProviderModelSource,
    probe::{
        CodexAppServerDefaults, CodexDefaultsProbe, CommandProbe, DetectionMode, ProbeRunner,
        StructuredCatalog, StructuredCatalogProbe,
    },
};
use qa_scribe_core::domain::AiProvider;

#[test]
fn app_server_catalog_preserves_default_and_reasoning_metadata() {
    let models = parse_codex_app_server_models(&[json!({
        "model": "gpt-next",
        "displayName": "GPT Next",
        "description": "Detected from app-server",
        "isDefault": true,
        "defaultReasoningEffort": "medium",
        "supportedReasoningEfforts": [
            {"reasoningEffort": "low"},
            {"reasoningEffort": "medium"}
        ]
    })]);

    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "gpt-next");
    assert_eq!(models[0].label, "GPT Next");
    assert_eq!(models[0].source, ProviderModelSource::CliCatalog);
    assert!(models[0].is_default);
    assert_eq!(models[0].reasoning_efforts, vec!["low", "medium"]);
    assert_eq!(
        models[0].default_reasoning_effort.as_deref(),
        Some("medium")
    );
}

struct StructuredRunner {
    claude: StructuredCatalogProbe,
    copilot: StructuredCatalogProbe,
    help: CommandProbe,
}

impl ProbeRunner for StructuredRunner {
    fn executable_path(&self, _program: &str) -> Option<PathBuf> {
        None
    }

    fn run(&self, _program: &str, _args: &[&str]) -> CommandProbe {
        self.help.clone()
    }

    fn claude_structured_catalog(&self) -> StructuredCatalogProbe {
        self.claude.clone()
    }

    fn copilot_structured_catalog(&self) -> StructuredCatalogProbe {
        self.copilot.clone()
    }
}

fn unattempted_catalog() -> StructuredCatalogProbe {
    StructuredCatalogProbe::NotAttempted
}

#[test]
fn claude_structured_catalog_maps_authoritative_capabilities() {
    let runner = StructuredRunner {
        claude: StructuredCatalogProbe::Success(StructuredCatalog {
            models: vec![json!({
                "id": "opus",
                "label": "Opus",
                "supportsEffort": true,
                "reasoningEfforts": ["high"],
                "supportsAdaptiveThinking": true,
                "resolvedModel": "claude-opus-current"
            })],
            cli_version: Some("2.1.50".to_string()),
        }),
        copilot: unattempted_catalog(),
        help: CommandProbe::not_found(),
    };

    let snapshot = provider_catalog(AiProvider::ClaudeCode, &runner, DetectionMode::Deep, None);
    let model = snapshot
        .models
        .iter()
        .find(|model| model.id == "opus")
        .unwrap();

    assert_eq!(snapshot.state, ProviderCatalogState::Fresh);
    assert_eq!(snapshot.source, ProviderCatalogSource::CliCatalog);
    assert_eq!(model.source, ProviderModelSource::CliCatalog);
    assert_eq!(model.capabilities.reasoning, Some(true));
    assert_eq!(model.capabilities.adaptive_thinking, Some(true));
    assert_eq!(model.resolved_model.as_deref(), Some("claude-opus-current"));
}

#[test]
fn copilot_structured_catalog_preserves_policy_and_limits() {
    let runner = StructuredRunner {
        claude: unattempted_catalog(),
        copilot: StructuredCatalogProbe::Success(StructuredCatalog {
            models: vec![
                json!({
                    "id": "auto",
                    "label": "Auto from account",
                    "reasoningEfforts": ["low", "high"],
                    "defaultReasoningEffort": "high",
                    "reasoning": true
                }),
                json!({
                    "id": "gpt-policy",
                    "label": "GPT Policy",
                    "policyState": "disabled",
                    "vision": true,
                    "contextWindowTokens": 128000,
                    "maxOutputTokens": 16000
                }),
            ],
            cli_version: Some("1.0.7".to_string()),
        }),
        help: CommandProbe::not_found(),
    };

    let snapshot = provider_catalog(AiProvider::CopilotCli, &runner, DetectionMode::Deep, None);
    let model = snapshot
        .models
        .iter()
        .find(|model| model.id == "gpt-policy")
        .unwrap();

    assert_eq!(snapshot.state, ProviderCatalogState::Fresh);
    assert_eq!(
        model.availability,
        ProviderModelAvailability::PolicyDisabled
    );
    assert_eq!(model.capabilities.vision, Some(true));
    assert_eq!(model.capabilities.context_window_tokens, Some(128_000));
    assert_eq!(model.capabilities.max_output_tokens, Some(16_000));
    let automatic = snapshot
        .models
        .iter()
        .find(|model| model.id == "auto")
        .unwrap();
    assert_eq!(automatic.source, ProviderModelSource::ProviderDefault);
    assert_eq!(automatic.reasoning_efforts, vec!["low", "high"]);
    assert_eq!(automatic.default_reasoning_effort.as_deref(), Some("high"));
    assert_eq!(automatic.capabilities.reasoning, Some(true));
    assert_eq!(automatic.capabilities.auto_mode, Some(true));
}

#[test]
fn structured_failure_category_survives_a_help_fallback() {
    let runner = StructuredRunner {
        claude: unattempted_catalog(),
        copilot: StructuredCatalogProbe::Failed(ProviderDiscoveryError {
            code: ProviderDiscoveryErrorCode::RateLimited,
            message: "private provider detail".to_string(),
            retryable: true,
        }),
        help: CommandProbe {
            success: true,
            stdout: "--model use 'gpt-fallback'".to_string(),
            stderr: String::new(),
            not_found: false,
            scope_error: None,
        },
    };

    let snapshot = provider_catalog(AiProvider::CopilotCli, &runner, DetectionMode::Deep, None);

    assert_eq!(snapshot.state, ProviderCatalogState::Failed);
    assert_eq!(snapshot.source, ProviderCatalogSource::CliHelp);
    assert_eq!(
        snapshot.error.as_ref().map(|error| error.code),
        Some(ProviderDiscoveryErrorCode::RateLimited)
    );
    assert!(!snapshot.error.unwrap().message.contains("private"));
    assert!(
        snapshot
            .models
            .iter()
            .any(|model| model.id == "gpt-fallback")
    );
}

#[test]
fn live_codex_catalog_replaces_presets_and_hides_unavailable_entries() {
    struct CatalogRunner;

    impl ProbeRunner for CatalogRunner {
        fn executable_path(&self, _program: &str) -> Option<PathBuf> {
            None
        }

        fn run(&self, _program: &str, _args: &[&str]) -> CommandProbe {
            panic!("fallback catalog must not run after app-server discovery")
        }

        fn codex_app_server_defaults(&self) -> CodexDefaultsProbe {
            CodexDefaultsProbe::Success(CodexAppServerDefaults {
                config: json!({}),
                models: vec![
                    json!({"model": "gpt-live", "displayName": "GPT Live", "hidden": false}),
                    json!({"model": "gpt-hidden", "displayName": "GPT Hidden", "hidden": true}),
                ],
            })
        }
    }

    let models = provider_catalog(
        AiProvider::CodexCli,
        &CatalogRunner,
        DetectionMode::Deep,
        None,
    )
    .models;

    assert_eq!(
        models
            .iter()
            .map(|model| model.id.as_str())
            .collect::<Vec<_>>(),
        vec!["default", "gpt-live"]
    );
    assert_eq!(models[1].source, ProviderModelSource::CliCatalog);
    assert!(
        models
            .iter()
            .all(|model| model.source != ProviderModelSource::Preset)
    );
}
