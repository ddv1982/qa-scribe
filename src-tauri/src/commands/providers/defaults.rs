use std::{env, fs, path::PathBuf};

use serde_json::Value;

use super::{
    ProbeRunner, ProviderDefaultResolution, ProviderDefaultSnapshot, ProviderModelDescriptor,
};

pub(super) fn codex_default_snapshot(
    runner: &dyn ProbeRunner,
    fallback_models: &[ProviderModelDescriptor],
) -> ProviderDefaultSnapshot {
    let Some((config_result, models_result)) = runner.codex_app_server_defaults() else {
        return environment_snapshot("CODEX_MODEL", None)
            .unwrap_or_else(ProviderDefaultSnapshot::provider_managed);
    };
    let config = config_result.get("config").unwrap_or(&Value::Null);
    let model = json_string(config, "model");
    let reasoning_effort = json_string(config, "model_reasoning_effort");
    let catalog = models_result
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let recommended = catalog
        .iter()
        .find(|entry| entry.get("isDefault").and_then(Value::as_bool) == Some(true));
    let recommended_model = recommended.and_then(|entry| json_string(entry, "model"));
    let effective_model = model.clone().or_else(|| recommended_model.clone());
    let selected_catalog_entry = effective_model.as_deref().and_then(|selected| {
        catalog.iter().find(|entry| {
            json_string(entry, "model").as_deref() == Some(selected)
                || json_string(entry, "id").as_deref() == Some(selected)
        })
    });
    let recommended_reasoning_effort = selected_catalog_entry
        .and_then(|entry| json_string(entry, "defaultReasoningEffort"))
        .or_else(|| recommended.and_then(|entry| json_string(entry, "defaultReasoningEffort")));
    let supported_efforts: Vec<String> = selected_catalog_entry
        .and_then(|entry| entry.get("supportedReasoningEfforts"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| json_string(entry, "reasoningEffort"))
        .collect();
    let model_origin = origin_file(&config_result, "model");
    let reasoning_origin = origin_file(&config_result, "model_reasoning_effort");
    let mut warnings = Vec::new();
    if let Some(selected) = model.as_deref()
        && selected_catalog_entry.is_none()
        && !fallback_models
            .iter()
            .any(|candidate| candidate.id == selected)
    {
        warnings.push(format!(
            "Configured model `{selected}` is not in the CLI's advertised catalog."
        ));
    }
    if let Some(effort) = reasoning_effort.as_deref()
        && !supported_efforts.is_empty()
        && !supported_efforts
            .iter()
            .any(|candidate| candidate == effort)
    {
        warnings.push(format!(
            "Configured reasoning `{effort}` is not supported by the effective model."
        ));
    }

    ProviderDefaultSnapshot {
        model: effective_model,
        reasoning_effort: reasoning_effort.or_else(|| recommended_reasoning_effort.clone()),
        model_origin,
        reasoning_origin,
        resolution: if model.is_some() {
            ProviderDefaultResolution::Configured
        } else if recommended_model.is_some() {
            ProviderDefaultResolution::Recommended
        } else {
            ProviderDefaultResolution::ProviderManaged
        },
        recommended_model,
        recommended_reasoning_effort,
        warnings,
    }
}

pub(super) fn claude_default_snapshot() -> ProviderDefaultSnapshot {
    let mut model = None;
    let mut reasoning = None;
    let mut model_origin = None;
    let mut reasoning_origin = None;
    for path in claude_settings_paths() {
        let Ok(contents) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(settings) = serde_json::from_str::<Value>(&contents) else {
            continue;
        };
        if let Some(value) = json_string(&settings, "model") {
            model = configured_value(value);
            model_origin = Some(path.to_string_lossy().into_owned());
        }
        if let Some(value) = json_string(&settings, "effortLevel") {
            reasoning = configured_value(value);
            reasoning_origin = Some(path.to_string_lossy().into_owned());
        }
    }
    if let Ok(value) = env::var("ANTHROPIC_MODEL") {
        model = configured_value(value);
        model_origin = Some("environment variable ANTHROPIC_MODEL".to_string());
    }
    if let Ok(value) = env::var("CLAUDE_CODE_EFFORT_LEVEL") {
        reasoning = configured_value(value);
        reasoning_origin = Some("environment variable CLAUDE_CODE_EFFORT_LEVEL".to_string());
    }
    ProviderDefaultSnapshot {
        resolution: if model.is_some() || reasoning.is_some() {
            ProviderDefaultResolution::Configured
        } else {
            ProviderDefaultResolution::ProviderManaged
        },
        model,
        reasoning_effort: reasoning,
        model_origin,
        reasoning_origin,
        recommended_model: None,
        recommended_reasoning_effort: None,
        warnings: Vec::new(),
    }
}

pub(super) fn copilot_default_snapshot() -> ProviderDefaultSnapshot {
    let path = copilot_config_path();
    let settings = path
        .as_ref()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|contents| json5::from_str::<Value>(&contents).ok());
    let mut model = settings
        .as_ref()
        .and_then(|value| json_string(value, "model"));
    let reasoning_effort = settings
        .as_ref()
        .and_then(|value| json_string(value, "effortLevel"));
    let origin = path.map(|path| path.to_string_lossy().into_owned());
    let mut model_origin = model.as_ref().and(origin.clone());
    let reasoning_origin = reasoning_effort.as_ref().and(origin);
    if let Ok(value) = env::var("COPILOT_MODEL") {
        model = configured_value(value);
        model_origin = Some("environment variable COPILOT_MODEL".to_string());
    }
    ProviderDefaultSnapshot {
        resolution: if model.is_some() || reasoning_effort.is_some() {
            ProviderDefaultResolution::Configured
        } else {
            ProviderDefaultResolution::Recommended
        },
        model: model.or_else(|| Some("auto".to_string())),
        reasoning_effort: reasoning_effort.or_else(|| Some("medium".to_string())),
        model_origin,
        reasoning_origin,
        recommended_model: Some("auto".to_string()),
        recommended_reasoning_effort: Some("medium".to_string()),
        warnings: Vec::new(),
    }
}

fn environment_snapshot(
    key: &str,
    fallback_model: Option<&str>,
) -> Option<ProviderDefaultSnapshot> {
    let raw = env::var(key).ok()?;
    let model = configured_value(raw).or_else(|| fallback_model.map(str::to_string));
    Some(ProviderDefaultSnapshot {
        model,
        reasoning_effort: None,
        model_origin: Some(format!("environment variable {key}")),
        reasoning_origin: None,
        resolution: ProviderDefaultResolution::Configured,
        recommended_model: fallback_model.map(str::to_string),
        recommended_reasoning_effort: None,
        warnings: Vec::new(),
    })
}

fn configured_value(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("default") {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn json_string(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(str::to_string)
}

fn origin_file(config_result: &Value, key: &str) -> Option<String> {
    config_result
        .get("origins")?
        .get(key)?
        .get("name")?
        .get("file")?
        .as_str()
        .map(str::to_string)
}

fn claude_settings_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(home) = env::var_os("HOME") {
        paths.push(PathBuf::from(home).join(".claude/settings.json"));
    }
    if let Ok(cwd) = env::current_dir() {
        paths.push(cwd.join(".claude/settings.json"));
        paths.push(cwd.join(".claude/settings.local.json"));
    }
    paths
}

fn copilot_config_path() -> Option<PathBuf> {
    if let Some(home) = env::var_os("COPILOT_HOME").filter(|value| !value.is_empty()) {
        return Some(preferred_copilot_config_path(PathBuf::from(home)));
    }
    env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| preferred_copilot_config_path(home.join(".copilot")))
}

fn preferred_copilot_config_path(home: PathBuf) -> PathBuf {
    let settings = home.join("settings.json");
    if settings.exists() {
        settings
    } else {
        home.join("config.json")
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::{Value, json};

    use super::codex_default_snapshot;
    use crate::commands::providers::{
        ProviderDefaultResolution,
        probe::{CommandProbe, ProbeRunner},
    };

    struct CodexAppServerRunner {
        config: Value,
        models: Value,
    }

    impl ProbeRunner for CodexAppServerRunner {
        fn executable_path(&self, _program: &str) -> Option<PathBuf> {
            None
        }

        fn run(&self, _program: &str, _args: &[&str]) -> CommandProbe {
            CommandProbe::not_found()
        }

        fn codex_app_server_defaults(&self) -> Option<(Value, Value)> {
            Some((self.config.clone(), self.models.clone()))
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
            models: json!({
                "data": [{
                    "id": "gpt-5.5", "model": "gpt-5.5", "isDefault": true,
                    "defaultReasoningEffort": "medium",
                    "supportedReasoningEfforts": [{"reasoningEffort": "low"}, {"reasoningEffort": "medium"}]
                }]
            }),
        };

        let snapshot = codex_default_snapshot(&runner, &[]);

        assert_eq!(snapshot.model.as_deref(), Some("gpt-private"));
        assert_eq!(snapshot.reasoning_effort.as_deref(), Some("high"));
        assert_eq!(
            snapshot.model_origin.as_deref(),
            Some("/home/test/.codex/config.toml")
        );
        assert_eq!(snapshot.resolution, ProviderDefaultResolution::Configured);
        assert_eq!(snapshot.recommended_model.as_deref(), Some("gpt-5.5"));
        assert!(
            snapshot
                .warnings
                .iter()
                .any(|warning| warning.contains("not in the CLI"))
        );
    }
}
