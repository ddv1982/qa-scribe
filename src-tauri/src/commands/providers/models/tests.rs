use serde_json::json;

use std::path::PathBuf;

use super::{codex_models, parse_codex_app_server_models};
use crate::commands::providers::{
    ProviderModelSource,
    probe::{CodexAppServerDefaults, CodexDefaultsProbe, CommandProbe, ProbeRunner},
};

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
    assert_eq!(models[0].source, ProviderModelSource::Detected);
    assert!(models[0].is_default);
    assert_eq!(models[0].reasoning_efforts, vec!["low", "medium"]);
    assert_eq!(
        models[0].default_reasoning_effort.as_deref(),
        Some("medium")
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

    let models = codex_models(&CatalogRunner);

    assert_eq!(
        models
            .iter()
            .map(|model| model.id.as_str())
            .collect::<Vec<_>>(),
        vec!["default", "gpt-live"]
    );
    assert_eq!(models[1].source, ProviderModelSource::Detected);
    assert!(
        models
            .iter()
            .all(|model| model.source != ProviderModelSource::Preset)
    );
}
