use std::{collections::HashSet, env, fs, path::PathBuf};

use serde::Deserialize;

use super::{ProbeRunner, ProviderModelDescriptor, ProviderModelSource};

pub(super) fn provider_default_model() -> ProviderModelDescriptor {
    ProviderModelDescriptor {
        id: "default".to_string(),
        label: "Provider default".to_string(),
        description: Some("Use the model configured by the local provider CLI.".to_string()),
        source: ProviderModelSource::ProviderDefault,
        is_default: true,
        reasoning_efforts: Vec::new(),
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
        is_default: false,
        reasoning_efforts: Vec::new(),
    })
}

fn copilot_settings_model() -> Option<ProviderModelDescriptor> {
    let path = copilot_settings_path()?;
    let settings = fs::read_to_string(path).ok()?;
    let settings = serde_json::from_str::<CopilotSettings>(&settings).ok()?;
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
        source: ProviderModelSource::Detected,
        is_default: false,
        reasoning_efforts: Vec::new(),
    })
}

fn copilot_settings_path() -> Option<PathBuf> {
    if let Some(home) = env::var_os("COPILOT_HOME").filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(home).join("settings.json"));
    }

    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .map(|home| home.join(".copilot").join("settings.json"))
}

#[derive(Debug, Deserialize)]
struct CopilotSettings {
    model: Option<String>,
}

pub(super) fn codex_static_models() -> Vec<ProviderModelDescriptor> {
    let mut models = vec![provider_default_model()];
    if let Some(model) = environment_model("CODEX_MODEL") {
        models.push(model);
    }
    models.extend(preset_models(&CODEX_PRESET_MODELS));
    normalize_models(models)
}

pub(super) fn codex_models(runner: &impl ProbeRunner) -> Vec<ProviderModelDescriptor> {
    let mut models = codex_static_models();

    let catalog = runner.run("codex", &["debug", "models"]);
    if catalog.success {
        models.extend(parse_codex_models(&catalog.stdout));
    }

    normalize_models(models)
}

pub(super) fn claude_static_models() -> Vec<ProviderModelDescriptor> {
    let mut models = vec![provider_default_model()];
    if let Some(model) = environment_model("CLAUDE_MODEL") {
        models.push(model);
    }
    models.extend(preset_models(&CLAUDE_PRESET_MODELS));
    normalize_models(models)
}

pub(super) fn claude_models(runner: &impl ProbeRunner) -> Vec<ProviderModelDescriptor> {
    let mut models = claude_static_models();

    let help = runner.run("claude", &["--help"]);
    if help.success {
        models.extend(parse_claude_model_help(&help.stdout));
    }

    normalize_models(models)
}

pub(super) fn copilot_models() -> Vec<ProviderModelDescriptor> {
    let mut models = copilot_base_models();
    models.extend(preset_models(&COPILOT_PRESET_MODELS));
    normalize_models(models)
}

pub(super) fn copilot_models_with_config_help(
    runner: &impl ProbeRunner,
) -> Vec<ProviderModelDescriptor> {
    let mut models = copilot_base_models();

    let help = runner.run("copilot", &["help", "config"]);
    if help.success {
        let detected_models = parse_copilot_config_help(&help.stdout);
        if detected_models.is_empty() {
            models.extend(preset_models(&COPILOT_PRESET_MODELS));
        } else {
            models.extend(detected_models);
        }
    } else {
        models.extend(preset_models(&COPILOT_PRESET_MODELS));
    }

    normalize_models(models)
}

fn copilot_base_models() -> Vec<ProviderModelDescriptor> {
    let mut models = vec![provider_default_model()];
    models.extend(preset_models(&["auto"]));
    if let Some(model) = environment_model("COPILOT_MODEL") {
        models.push(model);
    }
    if let Some(model) = copilot_settings_model() {
        models.push(model);
    }

    models
}

const CODEX_PRESET_MODELS: [&str; 5] = [
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.2",
    "gpt-5-mini",
];

const CLAUDE_PRESET_MODELS: [&str; 9] = [
    "sonnet",
    "haiku",
    "claude-sonnet-4-6",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-opus-4-5",
];

const COPILOT_PRESET_MODELS: [&str; 15] = [
    "auto",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.2",
    "gpt-5.4-mini",
    "gpt-5-mini",
    "claude-sonnet-4.6",
    "claude-sonnet-4.5",
    "claude-haiku-4.5",
    "claude-opus-4.8",
    "claude-opus-4.7",
    "claude-opus-4.6",
    "claude-opus-4.5",
    "gemini-3.1-pro-preview",
    "gemini-3.5-flash",
];

fn preset_models(models: &[&str]) -> Vec<ProviderModelDescriptor> {
    models
        .iter()
        .filter(|model| curated_static_model_allowed(model))
        .map(|model| ProviderModelDescriptor {
            id: (*model).to_string(),
            label: (*model).to_string(),
            description: Some("Curated QA Scribe preset.".to_string()),
            source: ProviderModelSource::Preset,
            is_default: false,
            reasoning_efforts: Vec::new(),
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
                source: ProviderModelSource::Detected,
                is_default: false,
                reasoning_efforts,
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
            source: ProviderModelSource::Detected,
            is_default: false,
            reasoning_efforts: Vec::new(),
        })
        .collect()
}

fn parse_copilot_config_help(help: &str) -> Vec<ProviderModelDescriptor> {
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
            models.push(ProviderModelDescriptor {
                id: model.clone(),
                label: model,
                description: Some("Detected from GitHub Copilot CLI config help.".to_string()),
                source: ProviderModelSource::Detected,
                is_default: false,
                reasoning_efforts: Vec::new(),
            });
        }
    }

    models
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
    let mut normalized: Vec<ProviderModelDescriptor> = models
        .into_iter()
        .filter(|model| !model.id.trim().is_empty())
        .filter(|model| seen.insert(model.id.clone()))
        .collect();

    if normalized.is_empty() {
        normalized.push(provider_default_model());
    }

    normalized
}
