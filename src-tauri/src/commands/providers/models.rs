use std::{collections::HashSet, env};

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

pub(super) fn codex_models(runner: &impl ProbeRunner) -> Vec<ProviderModelDescriptor> {
    let mut models = vec![provider_default_model()];
    if let Some(model) = environment_model("CODEX_MODEL") {
        models.push(model);
    }

    let catalog = runner.run("codex", &["debug", "models"]);
    if catalog.success {
        models.extend(parse_codex_models(&catalog.stdout));
    }

    normalize_models(models)
}

pub(super) fn claude_models(runner: &impl ProbeRunner) -> Vec<ProviderModelDescriptor> {
    let mut models = vec![provider_default_model()];
    if let Some(model) = environment_model("CLAUDE_MODEL") {
        models.push(model);
    }

    let help = runner.run("claude", &["--help"]);
    if help.success {
        models.extend(parse_claude_model_help(&help.stdout));
    }

    normalize_models(models)
}

pub(super) fn copilot_models() -> Vec<ProviderModelDescriptor> {
    let mut models = vec![provider_default_model()];
    if let Some(model) = environment_model("COPILOT_MODEL") {
        models.push(model);
    }
    normalize_models(models)
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
