use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde_json::Value;

use super::{
    ProbeRunner, ProviderDefaultOrigin, ProviderDefaultOriginKind, ProviderDefaultResolution,
    ProviderDefaultSnapshot, ProviderDefaultValue, ProviderDiscoveryState, ProviderModelDescriptor,
    ProviderResolutionScope, ProviderWarning, ProviderWarningSeverity, probe::CodexDefaultsProbe,
    types::checked_at_now,
};

pub(super) fn codex_default_snapshot(
    runner: &dyn ProbeRunner,
    fallback_models: &[ProviderModelDescriptor],
    cli_version: Option<String>,
) -> ProviderDefaultSnapshot {
    let defaults = match runner.codex_app_server_defaults() {
        CodexDefaultsProbe::NotAttempted => return ProviderDefaultSnapshot::unchecked(),
        CodexDefaultsProbe::Failed(error) => {
            return ProviderDefaultSnapshot::unresolved(error, cli_version);
        }
        CodexDefaultsProbe::Success(defaults) => defaults,
    };
    let config_result = defaults.config;
    let config = config_result.get("config").unwrap_or(&Value::Null);
    let model = json_string(config, "model");
    let reasoning_effort = json_string(config, "model_reasoning_effort");
    let catalog = defaults.models;
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
    let model_origin = configured_origin(&config_result, "model");
    let reasoning_origin = configured_origin(&config_result, "model_reasoning_effort");
    let mut warnings = Vec::new();
    if let Some(selected) = model.as_deref()
        && selected_catalog_entry.is_none()
        && !fallback_models
            .iter()
            .any(|candidate| candidate.id == selected)
    {
        warnings.push(advisory_warning(
            "unlisted-configured-model",
            format!(
                "The configured model `{selected}` is not listed in the Codex picker. Codex CLI will still validate its live configuration when the run starts."
            ),
        ));
    }
    if let Some(effort) = reasoning_effort.as_deref()
        && !supported_efforts.is_empty()
        && !supported_efforts
            .iter()
            .any(|candidate| candidate == effort)
    {
        warnings.push(advisory_warning(
            "unadvertised-reasoning-effort",
            format!(
                "The configured reasoning effort `{effort}` is not advertised for the observed model. Codex CLI remains authoritative for a default run."
            ),
        ));
    }

    let model_resolution = if model.is_some() {
        ProviderDefaultResolution::Configured
    } else if recommended_model.is_some() {
        ProviderDefaultResolution::Recommended
    } else {
        ProviderDefaultResolution::ProviderManaged
    };
    let reasoning_resolution = if reasoning_effort.is_some() {
        ProviderDefaultResolution::Configured
    } else if recommended_reasoning_effort.is_some() {
        ProviderDefaultResolution::Recommended
    } else {
        ProviderDefaultResolution::ProviderManaged
    };
    let effective_reasoning = reasoning_effort
        .clone()
        .or_else(|| recommended_reasoning_effort.clone());
    ProviderDefaultSnapshot {
        state: if effective_model.is_some() || effective_reasoning.is_some() {
            ProviderDiscoveryState::Detected
        } else {
            ProviderDiscoveryState::ProviderManaged
        },
        model: ProviderDefaultValue::new(
            effective_model,
            model_resolution,
            model_origin.or_else(|| {
                recommended_model
                    .as_ref()
                    .map(|_| recommendation_origin("Codex model catalog default"))
            }),
            recommended_model,
        ),
        reasoning_effort: ProviderDefaultValue::new(
            effective_reasoning,
            reasoning_resolution,
            reasoning_origin.or_else(|| {
                recommended_reasoning_effort
                    .as_ref()
                    .map(|_| recommendation_origin("Codex model recommendation"))
            }),
            recommended_reasoning_effort,
        ),
        checked_at: Some(checked_at_now()),
        cli_version,
        resolution_scope: ProviderResolutionScope::neutral(),
        error: None,
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
            model_origin = Some(origin_from_path(&path));
        }
        if let Some(value) = json_string(&settings, "effortLevel") {
            reasoning = configured_value(value);
            reasoning_origin = Some(origin_from_path(&path));
        }
    }
    if let Ok(value) = env::var("ANTHROPIC_MODEL") {
        model = configured_value(value);
        model_origin = Some(environment_origin("ANTHROPIC_MODEL"));
    }
    if let Ok(value) = env::var("CLAUDE_CODE_EFFORT_LEVEL") {
        reasoning = configured_value(value);
        reasoning_origin = Some(environment_origin("CLAUDE_CODE_EFFORT_LEVEL"));
    }
    let detected = model.is_some() || reasoning.is_some();
    ProviderDefaultSnapshot {
        state: if detected {
            ProviderDiscoveryState::Detected
        } else {
            ProviderDiscoveryState::ProviderManaged
        },
        model: observed_value(model, model_origin),
        reasoning_effort: observed_value(reasoning, reasoning_origin),
        checked_at: Some(checked_at_now()),
        cli_version: None,
        resolution_scope: ProviderResolutionScope::neutral(),
        error: None,
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
    let origin = path.as_deref().map(origin_from_path);
    let mut model_origin = model.as_ref().and(origin.clone());
    let reasoning_origin = reasoning_effort.as_ref().and(origin);
    if let Ok(value) = env::var("COPILOT_MODEL") {
        model = configured_value(value);
        model_origin = Some(environment_origin("COPILOT_MODEL"));
    }
    let effective_model = model.or_else(|| Some("auto".to_string()));
    let effective_reasoning = reasoning_effort.or_else(|| Some("medium".to_string()));
    ProviderDefaultSnapshot {
        state: ProviderDiscoveryState::Detected,
        model: ProviderDefaultValue::new(
            effective_model,
            if model_origin.is_some() {
                ProviderDefaultResolution::Configured
            } else {
                ProviderDefaultResolution::Recommended
            },
            model_origin.or_else(|| Some(recommendation_origin("Copilot automatic selection"))),
            Some("auto".to_string()),
        ),
        reasoning_effort: ProviderDefaultValue::new(
            effective_reasoning,
            if reasoning_origin.is_some() {
                ProviderDefaultResolution::Configured
            } else {
                ProviderDefaultResolution::Recommended
            },
            reasoning_origin
                .or_else(|| Some(recommendation_origin("Copilot reasoning recommendation"))),
            Some("medium".to_string()),
        ),
        checked_at: Some(checked_at_now()),
        cli_version: None,
        resolution_scope: ProviderResolutionScope::neutral(),
        error: None,
        warnings: Vec::new(),
    }
}

fn observed_value(
    value: Option<String>,
    origin: Option<ProviderDefaultOrigin>,
) -> ProviderDefaultValue {
    ProviderDefaultValue::new(
        value,
        if origin.is_some() {
            ProviderDefaultResolution::Configured
        } else {
            ProviderDefaultResolution::ProviderManaged
        },
        origin,
        None,
    )
}

fn advisory_warning(code: &str, message: String) -> ProviderWarning {
    ProviderWarning {
        code: code.to_string(),
        severity: ProviderWarningSeverity::Advisory,
        message,
    }
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

fn configured_origin(config_result: &Value, key: &str) -> Option<ProviderDefaultOrigin> {
    let origin = config_result.get("origins")?.get(key)?;
    if let Some(path) = origin
        .get("name")
        .and_then(|name| name.get("file"))
        .or_else(|| origin.get("file"))
        .and_then(Value::as_str)
    {
        return Some(origin_from_path(Path::new(path)));
    }

    let name = origin
        .get("name")
        .and_then(Value::as_str)
        .or_else(|| origin.as_str())
        .unwrap_or("Codex configuration");
    let normalized = name.to_ascii_lowercase();
    let kind = if normalized.contains("profile") {
        ProviderDefaultOriginKind::Profile
    } else if normalized.contains("managed") || normalized.contains("mdm") {
        ProviderDefaultOriginKind::ManagedConfig
    } else if normalized.contains("flag") || normalized.contains("override") {
        ProviderDefaultOriginKind::RuntimeFlag
    } else {
        ProviderDefaultOriginKind::Unknown
    };
    Some(ProviderDefaultOrigin {
        kind,
        label: name.to_string(),
        display_path: None,
        technical_path: None,
    })
}

fn origin_from_path(path: &Path) -> ProviderDefaultOrigin {
    let technical_path = path.to_string_lossy().into_owned();
    let home = env::var_os("HOME").map(PathBuf::from);
    let display_path = home.as_ref().and_then(|home| {
        path.strip_prefix(home)
            .ok()
            .map(|suffix| format!("~/{}", suffix.to_string_lossy()))
    });
    let is_user_config = display_path.as_deref().is_some_and(|path| {
        path.starts_with("~/.codex/")
            || path.starts_with("~/.claude/")
            || path.starts_with("~/.copilot/")
    });
    let kind = if is_user_config {
        ProviderDefaultOriginKind::UserConfig
    } else if technical_path.contains("/.codex/")
        || technical_path.contains("/.claude/")
        || technical_path.contains("/.copilot/")
    {
        ProviderDefaultOriginKind::ProjectConfig
    } else {
        ProviderDefaultOriginKind::ConfigFile
    };
    ProviderDefaultOrigin {
        kind,
        label: match kind {
            ProviderDefaultOriginKind::UserConfig => "User configuration".to_string(),
            ProviderDefaultOriginKind::ProjectConfig => "Project configuration".to_string(),
            _ => "CLI configuration file".to_string(),
        },
        display_path: Some(display_path.unwrap_or_else(|| {
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("configuration file")
                .to_string()
        })),
        technical_path: Some(technical_path),
    }
}

fn environment_origin(key: &str) -> ProviderDefaultOrigin {
    ProviderDefaultOrigin {
        kind: ProviderDefaultOriginKind::Environment,
        label: format!("Environment variable {key}"),
        display_path: None,
        technical_path: None,
    }
}

fn recommendation_origin(label: &str) -> ProviderDefaultOrigin {
    ProviderDefaultOrigin {
        kind: ProviderDefaultOriginKind::CliRecommendation,
        label: label.to_string(),
        display_path: None,
        technical_path: None,
    }
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
        ProviderDefaultOriginKind, ProviderDefaultResolution, ProviderWarningSeverity,
        probe::{CodexAppServerDefaults, CodexDefaultsProbe, CommandProbe, ProbeRunner},
    };

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
        assert!(
            snapshot
                .warnings
                .iter()
                .any(|warning| warning.code == "unlisted-configured-model"
                    && warning.severity == ProviderWarningSeverity::Advisory)
        );
    }
}
