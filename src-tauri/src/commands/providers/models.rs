use std::{collections::HashSet, env, fs, path::PathBuf};

use qa_scribe_core::domain::AiProvider;
use serde::Deserialize;

use super::{
    ProviderEvidenceConfidence, ProviderModelAvailability, ProviderModelCapabilities,
    ProviderModelDescriptor, ProviderModelSource,
};
use presets::{CLAUDE_PRESET_MODELS, CODEX_PRESET_MODELS, COPILOT_PRESET_MODELS};

mod presets;

mod catalog;
mod structured;

pub(super) use catalog::provider_catalog;
use structured::*;

pub(super) fn provider_default_model() -> ProviderModelDescriptor {
    ProviderModelDescriptor {
        id: "default".to_string(),
        label: "Use CLI default".to_string(),
        description: Some("Use the model configured by the local provider CLI.".to_string()),
        source: ProviderModelSource::ProviderDefault,
        availability: ProviderModelAvailability::Available,
        confidence: ProviderEvidenceConfidence::Authoritative,
        is_default: true,
        reasoning_efforts: Vec::new(),
        default_reasoning_effort: None,
        capabilities: ProviderModelCapabilities::default(),
        resolved_model: None,
    }
}

fn copilot_auto_model() -> ProviderModelDescriptor {
    ProviderModelDescriptor {
        id: "auto".to_string(),
        label: "Automatic model selection".to_string(),
        description: Some("Let GitHub Copilot choose an available model at run time.".to_string()),
        source: ProviderModelSource::ProviderDefault,
        availability: ProviderModelAvailability::Available,
        confidence: ProviderEvidenceConfidence::Authoritative,
        is_default: false,
        reasoning_efforts: Vec::new(),
        default_reasoning_effort: None,
        capabilities: ProviderModelCapabilities {
            auto_mode: Some(true),
            ..ProviderModelCapabilities::default()
        },
        resolved_model: None,
    }
}

fn environment_model(key: &str) -> Option<ProviderModelDescriptor> {
    let model = env::var(key).ok()?.trim().to_string();
    if model.is_empty() || model.eq_ignore_ascii_case("default") {
        return None;
    }

    Some(ProviderModelDescriptor {
        id: model.clone(),
        label: model,
        description: Some(format!("Detected from `{key}`.")),
        source: ProviderModelSource::Environment,
        availability: ProviderModelAvailability::SupportedByBinary,
        confidence: ProviderEvidenceConfidence::Observed,
        is_default: false,
        reasoning_efforts: Vec::new(),
        default_reasoning_effort: None,
        capabilities: ProviderModelCapabilities::default(),
        resolved_model: None,
    })
}

fn copilot_settings_model() -> Option<ProviderModelDescriptor> {
    let path = copilot_settings_path()?;
    let settings = fs::read_to_string(path).ok()?;
    let settings = json5::from_str::<CopilotSettings>(&settings).ok()?;
    let model = settings.model?.trim().to_string();
    if model.is_empty()
        || model.eq_ignore_ascii_case("default")
        || model.eq_ignore_ascii_case("auto")
    {
        return None;
    }

    Some(ProviderModelDescriptor {
        id: model.clone(),
        label: model,
        description: Some("Detected from GitHub Copilot CLI settings.".to_string()),
        source: ProviderModelSource::Config,
        availability: ProviderModelAvailability::SupportedByBinary,
        confidence: ProviderEvidenceConfidence::Observed,
        is_default: false,
        reasoning_efforts: Vec::new(),
        default_reasoning_effort: None,
        capabilities: ProviderModelCapabilities::default(),
        resolved_model: None,
    })
}

fn copilot_settings_path() -> Option<PathBuf> {
    if let Some(home) = env::var_os("COPILOT_HOME").filter(|value| !value.is_empty()) {
        return Some(preferred_copilot_settings_path(PathBuf::from(home)));
    }

    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .map(|home| preferred_copilot_settings_path(home.join(".copilot")))
}

fn preferred_copilot_settings_path(home: PathBuf) -> PathBuf {
    let settings = home.join("settings.json");
    if settings.exists() {
        settings
    } else {
        home.join("config.json")
    }
}

#[derive(Debug, Deserialize)]
struct CopilotSettings {
    model: Option<String>,
}

pub(super) fn codex_static_models() -> Vec<ProviderModelDescriptor> {
    let mut models = vec![provider_default_model()];
    models.extend(preset_models(&CODEX_PRESET_MODELS));
    normalize_models(models)
}

fn parse_codex_app_server_models(models: &[serde_json::Value]) -> Vec<ProviderModelDescriptor> {
    models
        .iter()
        .filter(|model| model.get("hidden").and_then(serde_json::Value::as_bool) != Some(true))
        .filter_map(|model| {
            let id = model
                .get("model")
                .or_else(|| model.get("id"))
                .and_then(serde_json::Value::as_str)?
                .trim();
            if id.is_empty() {
                return None;
            }
            let reasoning_efforts = model
                .get("supportedReasoningEfforts")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|effort| {
                    effort
                        .get("reasoningEffort")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .filter(|effort| !effort.is_empty())
                        .map(str::to_string)
                })
                .collect();
            Some(ProviderModelDescriptor {
                id: id.to_string(),
                label: model
                    .get("displayName")
                    .or_else(|| model.get("name"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(id)
                    .to_string(),
                description: model
                    .get("description")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
                source: ProviderModelSource::CliCatalog,
                availability: ProviderModelAvailability::Available,
                confidence: ProviderEvidenceConfidence::Authoritative,
                is_default: model.get("isDefault").and_then(serde_json::Value::as_bool)
                    == Some(true),
                reasoning_efforts,
                default_reasoning_effort: model
                    .get("defaultReasoningEffort")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
                capabilities: ProviderModelCapabilities::default(),
                resolved_model: None,
            })
        })
        .collect()
}

pub(super) fn claude_static_models() -> Vec<ProviderModelDescriptor> {
    let mut models = vec![provider_default_model()];
    if let Some(model) = environment_model("ANTHROPIC_MODEL") {
        models.push(model);
    }
    models.extend(preset_models(&CLAUDE_PRESET_MODELS));
    normalize_models(models)
}

pub(super) fn copilot_models() -> Vec<ProviderModelDescriptor> {
    let mut models = copilot_base_models();
    models.extend(preset_models(&COPILOT_PRESET_MODELS));
    normalize_models(models)
}

pub(super) fn compatibility_models(provider: AiProvider) -> Vec<ProviderModelDescriptor> {
    match provider {
        AiProvider::ClaudeCode => claude_static_models(),
        AiProvider::CodexCli => codex_static_models(),
        AiProvider::CopilotCli => copilot_models(),
    }
}

fn copilot_base_models() -> Vec<ProviderModelDescriptor> {
    let mut models = vec![provider_default_model(), copilot_auto_model()];
    if let Some(model) = environment_model("COPILOT_MODEL") {
        models.push(model);
    }
    if let Some(model) = copilot_settings_model() {
        models.push(model);
    }

    models
}

fn preset_models(models: &[&str]) -> Vec<ProviderModelDescriptor> {
    models
        .iter()
        .filter(|model| curated_static_model_allowed(model))
        .map(|model| ProviderModelDescriptor {
            id: (*model).to_string(),
            label: (*model).to_string(),
            description: Some("Curated QA Scribe preset.".to_string()),
            source: ProviderModelSource::Preset,
            availability: ProviderModelAvailability::StaticHint,
            confidence: ProviderEvidenceConfidence::Static,
            is_default: false,
            reasoning_efforts: Vec::new(),
            default_reasoning_effort: None,
            capabilities: ProviderModelCapabilities::default(),
            resolved_model: None,
        })
        .collect()
}

fn curated_static_model_allowed(model: &str) -> bool {
    !model.contains("-codex") && !model.contains("fast")
}

#[derive(Debug, Deserialize)]
struct CodexModelCatalog {
    models: Vec<CodexModel>,
}

#[derive(Debug, Deserialize)]
struct CodexModel {
    slug: String,
    display_name: Option<String>,
    description: Option<String>,
    visibility: Option<String>,
    supported_reasoning_levels: Option<Vec<CodexReasoningLevel>>,
    #[serde(alias = "default_reasoning_effort")]
    default_reasoning_level: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodexReasoningLevel {
    effort: String,
}

fn parse_codex_models(json: &str) -> Vec<ProviderModelDescriptor> {
    let Ok(catalog) = serde_json::from_str::<CodexModelCatalog>(json) else {
        return Vec::new();
    };

    catalog
        .models
        .into_iter()
        .filter(|model| model.visibility.as_deref() == Some("list"))
        .filter(|model| !model.slug.trim().is_empty())
        .map(|model| {
            let reasoning_efforts = model
                .supported_reasoning_levels
                .unwrap_or_default()
                .into_iter()
                .map(|level| level.effort.trim().to_string())
                .filter(|effort| !effort.is_empty())
                .collect();
            ProviderModelDescriptor {
                id: model.slug.clone(),
                label: model.display_name.unwrap_or_else(|| model.slug.clone()),
                description: model.description,
                source: ProviderModelSource::CliHelp,
                availability: ProviderModelAvailability::SupportedByBinary,
                confidence: ProviderEvidenceConfidence::Heuristic,
                is_default: false,
                reasoning_efforts,
                default_reasoning_effort: model.default_reasoning_level,
                capabilities: ProviderModelCapabilities::default(),
                resolved_model: None,
            }
        })
        .collect()
}

fn parse_claude_model_help(help: &str) -> Vec<ProviderModelDescriptor> {
    help.lines()
        .filter(|line| line.contains("--model"))
        .flat_map(quoted_tokens)
        .filter(|token| !token.trim().is_empty())
        .map(|token| ProviderModelDescriptor {
            id: token.clone(),
            label: token,
            description: Some("Detected from Claude Code help.".to_string()),
            source: ProviderModelSource::CliHelp,
            availability: ProviderModelAvailability::SupportedByBinary,
            confidence: ProviderEvidenceConfidence::Heuristic,
            is_default: false,
            reasoning_efforts: Vec::new(),
            default_reasoning_effort: None,
            capabilities: ProviderModelCapabilities::default(),
            resolved_model: None,
        })
        .collect()
}

fn parse_copilot_config_help(help: &str) -> Vec<ProviderModelDescriptor> {
    let option_models: Vec<_> = help
        .lines()
        .filter(|line| line.contains("--model"))
        .flat_map(quoted_tokens)
        .filter(|model| model == "auto" || model.contains('-'))
        .map(detected_copilot_model)
        .collect();
    if !option_models.is_empty() {
        return option_models;
    }

    let mut in_model_section = false;
    let mut models = Vec::new();

    for line in help.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if starts_model_section(trimmed) {
            in_model_section = true;
            continue;
        }

        if in_model_section && starts_new_config_section(trimmed) {
            break;
        }

        if !in_model_section {
            continue;
        }

        if let Some(model) = copilot_model_from_help_line(trimmed) {
            models.push(detected_copilot_model(model));
        }
    }

    models
}

fn detected_copilot_model(model: String) -> ProviderModelDescriptor {
    ProviderModelDescriptor {
        id: model.clone(),
        label: model,
        description: Some("Detected from GitHub Copilot CLI help.".to_string()),
        source: ProviderModelSource::CliHelp,
        availability: ProviderModelAvailability::SupportedByBinary,
        confidence: ProviderEvidenceConfidence::Heuristic,
        is_default: false,
        reasoning_efforts: Vec::new(),
        default_reasoning_effort: None,
        capabilities: ProviderModelCapabilities::default(),
        resolved_model: None,
    }
}

fn starts_model_section(line: &str) -> bool {
    let normalized = line.trim().to_ascii_lowercase();
    normalized == "model:"
        || normalized == "model"
        || normalized.starts_with("model ")
        || normalized.starts_with("`model`:")
}

fn starts_new_config_section(line: &str) -> bool {
    if line.starts_with('`') && line.contains("`:") && !starts_model_section(line) {
        return true;
    }

    line.ends_with(':')
        && line.trim_end_matches(':').chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

fn copilot_model_from_help_line(line: &str) -> Option<String> {
    let candidate = line
        .trim_start_matches(['-', '*', '•'])
        .split_whitespace()
        .next()?
        .trim_matches(['`', '\'', '"', ',', ';']);
    if candidate.is_empty()
        || !candidate.contains('-')
        || candidate.eq_ignore_ascii_case("default")
        || candidate.contains('<')
        || candidate.contains('>')
    {
        return None;
    }
    Some(candidate.to_string())
}

fn quoted_tokens(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut token_start = None;

    for (index, character) in line.char_indices() {
        if character != '\'' || apostrophe_inside_word(line, index) {
            continue;
        }

        if let Some(start) = token_start.take() {
            let token = line[start..index].trim();
            if !token.is_empty() {
                tokens.push(token.to_string());
            }
        } else {
            token_start = Some(index + character.len_utf8());
        }
    }

    tokens
}

fn apostrophe_inside_word(line: &str, index: usize) -> bool {
    let previous = line[..index].chars().next_back();
    let next = line[index + 1..].chars().next();
    previous.is_some_and(|character| character.is_ascii_alphanumeric())
        && next.is_some_and(|character| character.is_ascii_alphanumeric())
}

pub(super) fn normalize_models(
    models: Vec<ProviderModelDescriptor>,
) -> Vec<ProviderModelDescriptor> {
    let mut seen = HashSet::new();
    let mut normalized: Vec<ProviderModelDescriptor> = Vec::new();
    for model in models
        .into_iter()
        .filter(|model| !model.id.trim().is_empty())
    {
        if seen.insert(model.id.clone()) {
            normalized.push(model);
            continue;
        }
        if let Some(existing) = normalized.iter_mut().find(|entry| entry.id == model.id)
            && model_source_priority(model.source) > model_source_priority(existing.source)
        {
            *existing = model;
        }
    }

    if normalized.is_empty() {
        normalized.push(provider_default_model());
    }

    normalized
}

fn model_source_priority(source: ProviderModelSource) -> u8 {
    match source {
        ProviderModelSource::ProviderDefault => 5,
        ProviderModelSource::Preset => 1,
        ProviderModelSource::Environment | ProviderModelSource::Config => 2,
        ProviderModelSource::Detected | ProviderModelSource::CliHelp => 3,
        ProviderModelSource::CliCatalog => 4,
    }
}

#[cfg(test)]
mod tests;
