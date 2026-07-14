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

pub(super) fn claude_default_snapshot(cli_version: Option<String>) -> ProviderDefaultSnapshot {
    claude_default_snapshot_from_sources(
        claude_settings_paths(),
        env::var("ANTHROPIC_MODEL").ok(),
        env::var("CLAUDE_CODE_EFFORT_LEVEL").ok(),
        cli_version,
    )
}

fn claude_default_snapshot_from_sources(
    settings_paths: impl IntoIterator<Item = PathBuf>,
    environment_model: Option<String>,
    environment_reasoning: Option<String>,
    cli_version: Option<String>,
) -> ProviderDefaultSnapshot {
    let mut model = None;
    let mut reasoning = None;
    let mut model_origin = None;
    let mut reasoning_origin = None;
    for path in settings_paths {
        let Ok(contents) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(settings) = serde_json::from_str::<Value>(&contents) else {
            continue;
        };
        if let Some(value) = json_string(&settings, "model") {
            model = configured_value(value);
            model_origin = model.as_ref().map(|_| origin_from_path(&path));
        }
        if let Some(value) = json_string(&settings, "effortLevel") {
            reasoning = configured_value(value);
            reasoning_origin = reasoning.as_ref().map(|_| origin_from_path(&path));
        }
    }
    if let Some(value) = environment_model {
        model = configured_value(value);
        model_origin = model
            .as_ref()
            .map(|_| environment_origin("ANTHROPIC_MODEL"));
    }
    if let Some(value) = environment_reasoning {
        reasoning = configured_value(value);
        reasoning_origin = reasoning
            .as_ref()
            .map(|_| environment_origin("CLAUDE_CODE_EFFORT_LEVEL"));
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
        cli_version,
        resolution_scope: ProviderResolutionScope::neutral(),
        error: None,
        warnings: Vec::new(),
    }
}

pub(super) fn copilot_default_snapshot(cli_version: Option<String>) -> ProviderDefaultSnapshot {
    copilot_default_snapshot_from_sources(
        copilot_config_path(),
        env::var("COPILOT_MODEL").ok(),
        cli_version,
    )
}

fn copilot_default_snapshot_from_sources(
    path: Option<PathBuf>,
    environment_model: Option<String>,
    cli_version: Option<String>,
) -> ProviderDefaultSnapshot {
    let settings = path
        .as_ref()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|contents| json5::from_str::<Value>(&contents).ok());
    let mut model = settings
        .as_ref()
        .and_then(|value| json_string(value, "model"))
        .and_then(configured_copilot_value);
    let reasoning_effort = settings
        .as_ref()
        .and_then(|value| json_string(value, "effortLevel"));
    let origin = path.as_deref().map(origin_from_path);
    let mut model_origin = model.as_ref().and(origin.clone());
    let reasoning_origin = reasoning_effort.as_ref().and(origin);
    if let Some(value) = environment_model {
        model = configured_copilot_value(value);
        model_origin = model.as_ref().map(|_| environment_origin("COPILOT_MODEL"));
    }
    let detected = model.is_some() || reasoning_effort.is_some();
    ProviderDefaultSnapshot {
        state: if detected {
            ProviderDiscoveryState::Detected
        } else {
            ProviderDiscoveryState::ProviderManaged
        },
        model: ProviderDefaultValue::new(
            model,
            if model_origin.is_some() {
                ProviderDefaultResolution::Configured
            } else {
                ProviderDefaultResolution::ProviderManaged
            },
            model_origin,
            Some("auto".to_string()),
        ),
        reasoning_effort: ProviderDefaultValue::new(
            reasoning_effort,
            if reasoning_origin.is_some() {
                ProviderDefaultResolution::Configured
            } else {
                ProviderDefaultResolution::ProviderManaged
            },
            reasoning_origin,
            None,
        ),
        checked_at: Some(checked_at_now()),
        cli_version,
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

fn configured_copilot_value(value: String) -> Option<String> {
    configured_value(value).filter(|value| !value.eq_ignore_ascii_case("auto"))
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
        label: match kind {
            ProviderDefaultOriginKind::Profile => "Codex profile".to_string(),
            ProviderDefaultOriginKind::ManagedConfig => "Managed configuration".to_string(),
            ProviderDefaultOriginKind::RuntimeFlag => "Runtime override".to_string(),
            _ => "Codex configuration".to_string(),
        },
        display_path: None,
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
    let is_managed_config = technical_path.contains("managed-settings.json")
        || technical_path.contains("/etc/claude-code/")
        || technical_path.contains("/Library/Application Support/ClaudeCode/")
        || technical_path
            .to_ascii_lowercase()
            .contains("programdata\\claudecode\\");
    let kind = if is_managed_config {
        ProviderDefaultOriginKind::ManagedConfig
    } else if is_user_config {
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
            ProviderDefaultOriginKind::ManagedConfig => "Managed configuration".to_string(),
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
    }
}

fn environment_origin(key: &str) -> ProviderDefaultOrigin {
    ProviderDefaultOrigin {
        kind: ProviderDefaultOriginKind::Environment,
        label: format!("Environment variable {key}"),
        display_path: None,
    }
}

fn recommendation_origin(label: &str) -> ProviderDefaultOrigin {
    ProviderDefaultOrigin {
        kind: ProviderDefaultOriginKind::CliRecommendation,
        label: label.to_string(),
        display_path: None,
    }
}

fn claude_settings_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(config_dir) = env::var_os("CLAUDE_CONFIG_DIR").filter(|value| !value.is_empty()) {
        paths.push(PathBuf::from(config_dir).join("settings.json"));
    } else if let Some(home) = env::var_os("HOME") {
        paths.push(PathBuf::from(home).join(".claude/settings.json"));
    }
    paths.extend(claude_managed_settings_paths());
    paths
}

fn claude_managed_settings_paths() -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        vec![PathBuf::from(
            "/Library/Application Support/ClaudeCode/managed-settings.json",
        )]
    } else if cfg!(windows) {
        env::var_os("PROGRAMDATA")
            .map(PathBuf::from)
            .map(|path| path.join("ClaudeCode/managed-settings.json"))
            .into_iter()
            .collect()
    } else {
        vec![PathBuf::from("/etc/claude-code/managed-settings.json")]
    }
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
mod tests;
