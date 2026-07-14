use std::{collections::HashSet, env, fs, path::PathBuf};

use crate::commands::providers::{
    ProviderDiscoveryError, ProviderDiscoveryErrorCode, ProviderEvidenceConfidence,
    ProviderModelAvailability, ProviderModelCapabilities, ProviderModelDescriptor,
    ProviderModelSource, ProviderWarning, ProviderWarningSeverity,
};

pub(super) fn parse_claude_structured_models(
    models: &[serde_json::Value],
) -> Vec<ProviderModelDescriptor> {
    models
        .iter()
        .filter_map(|model| {
            let id = value_string(model, &["id", "value"])?;
            let reasoning_efforts =
                value_string_array(model, &["reasoningEfforts", "supportedEffortLevels"]);
            Some(ProviderModelDescriptor {
                label: value_string(model, &["label", "displayName"]).unwrap_or_else(|| id.clone()),
                description: value_string(model, &["description"]),
                source: ProviderModelSource::CliCatalog,
                availability: ProviderModelAvailability::Available,
                confidence: ProviderEvidenceConfidence::Authoritative,
                is_default: id.eq_ignore_ascii_case("default"),
                default_reasoning_effort: value_string(
                    model,
                    &["defaultReasoningEffort", "defaultEffortLevel"],
                ),
                capabilities: ProviderModelCapabilities {
                    reasoning: value_bool(model, &["supportsEffort"])
                        .or_else(|| (!reasoning_efforts.is_empty()).then_some(true)),
                    adaptive_thinking: value_bool(
                        model,
                        &["supportsAdaptiveThinking", "adaptiveThinking"],
                    ),
                    fast_mode: value_bool(model, &["supportsFastMode", "fastMode"]),
                    auto_mode: value_bool(model, &["supportsAutoMode", "autoMode"]),
                    ..ProviderModelCapabilities::default()
                },
                resolved_model: value_string(model, &["resolvedModel"]),
                id,
                reasoning_efforts,
            })
        })
        .collect()
}

pub(super) fn parse_copilot_structured_models(
    models: &[serde_json::Value],
) -> Vec<ProviderModelDescriptor> {
    models
        .iter()
        .filter_map(|model| {
            let id = value_string(model, &["id"])?;
            let provider_managed_auto = id.eq_ignore_ascii_case("auto");
            let policy_state = value_string(model, &["policyState"]).or_else(|| {
                model
                    .get("policy")?
                    .get("state")?
                    .as_str()
                    .map(str::to_string)
            });
            let availability = match policy_state.as_deref() {
                Some("disabled") => ProviderModelAvailability::PolicyDisabled,
                Some("unconfigured") => ProviderModelAvailability::Unconfigured,
                _ => ProviderModelAvailability::Available,
            };
            let reasoning_efforts =
                value_string_array(model, &["reasoningEfforts", "supportedReasoningEfforts"]);
            let capabilities = model.get("capabilities");
            let supports = capabilities.and_then(|value| value.get("supports"));
            let limits = capabilities.and_then(|value| value.get("limits"));
            Some(ProviderModelDescriptor {
                label: value_string(model, &["label", "name"]).unwrap_or_else(|| id.clone()),
                description: value_string(model, &["description"]),
                source: if provider_managed_auto {
                    ProviderModelSource::ProviderDefault
                } else {
                    ProviderModelSource::CliCatalog
                },
                availability,
                confidence: ProviderEvidenceConfidence::Authoritative,
                is_default: false,
                default_reasoning_effort: value_string(model, &["defaultReasoningEffort"]),
                capabilities: ProviderModelCapabilities {
                    vision: value_bool(model, &["vision"]).or_else(|| {
                        supports
                            .and_then(|value| value.get("vision"))
                            .and_then(serde_json::Value::as_bool)
                    }),
                    reasoning: value_bool(model, &["reasoning"]).or_else(|| {
                        supports
                            .and_then(|value| value.get("reasoningEffort"))
                            .and_then(serde_json::Value::as_bool)
                    }),
                    adaptive_thinking: value_bool(model, &["adaptiveThinking"]),
                    fast_mode: None,
                    auto_mode: provider_managed_auto.then_some(true),
                    context_window_tokens: value_u64(model, &["contextWindowTokens"]).or_else(
                        || {
                            limits
                                .and_then(|value| value.get("maxContextWindowTokens"))
                                .and_then(serde_json::Value::as_u64)
                        },
                    ),
                    max_output_tokens: value_u64(model, &["maxOutputTokens"]).or_else(|| {
                        limits
                            .and_then(|value| value.get("maxOutputTokens"))
                            .and_then(serde_json::Value::as_u64)
                    }),
                },
                resolved_model: None,
                id,
                reasoning_efforts,
            })
        })
        .collect()
}

fn value_string(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(serde_json::Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn value_string_array(value: &serde_json::Value, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(serde_json::Value::as_array))
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

fn value_bool(value: &serde_json::Value, keys: &[&str]) -> Option<bool> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(serde_json::Value::as_bool))
}

fn value_u64(value: &serde_json::Value, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(serde_json::Value::as_u64))
}

pub(super) fn apply_claude_declarative_allowlist(
    models: Vec<ProviderModelDescriptor>,
) -> Vec<ProviderModelDescriptor> {
    filter_claude_models(models, claude_available_models())
}

fn filter_claude_models(
    models: Vec<ProviderModelDescriptor>,
    allowed: Option<HashSet<String>>,
) -> Vec<ProviderModelDescriptor> {
    let Some(allowed) = allowed else {
        return models;
    };
    models
        .into_iter()
        .filter(|model| {
            model.id.eq_ignore_ascii_case("default") || claude_model_is_allowed(model, &allowed)
        })
        .collect()
}

fn claude_model_is_allowed(model: &ProviderModelDescriptor, allowed: &HashSet<String>) -> bool {
    let model_ids = [
        &model.id,
        model.resolved_model.as_ref().unwrap_or(&model.id),
    ];
    if allowed.iter().any(|candidate| {
        model_ids
            .iter()
            .any(|model_id| claude_exact_or_prefix_match(candidate, model_id))
    }) {
        return true;
    }

    let Some(family) = claude_model_family(&model.id) else {
        return false;
    };
    if ["opus", "sonnet", "haiku", "fable"].contains(&model.id.to_ascii_lowercase().as_str()) {
        return allowed
            .iter()
            .any(|candidate| claude_model_family(candidate) == Some(family));
    }
    allowed
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(family))
        && !allowed.iter().any(|candidate| {
            claude_model_family(candidate) == Some(family)
                && !candidate.eq_ignore_ascii_case(family)
        })
}

fn claude_exact_or_prefix_match(candidate: &str, model_id: &str) -> bool {
    let candidate = candidate.to_ascii_lowercase();
    let model_id = model_id.to_ascii_lowercase();
    model_id == candidate || model_id.starts_with(&format!("{candidate}-"))
}

fn claude_model_family(value: &str) -> Option<&'static str> {
    let value = value.to_ascii_lowercase();
    ["opus", "sonnet", "haiku", "fable"]
        .into_iter()
        .find(|family| value == *family || value.starts_with(&format!("claude-{family}-")))
}

fn claude_available_models() -> Option<HashSet<String>> {
    let mut policy = ClaudeModelPolicy::Unspecified;
    for path in claude_model_settings_paths() {
        let Ok(settings) = fs::read_to_string(path) else {
            continue;
        };
        let Ok(settings) = serde_json::from_str::<serde_json::Value>(&settings) else {
            continue;
        };
        let next = claude_model_policy(&settings);
        if next != ClaudeModelPolicy::Unspecified {
            // Paths are ordered from user to managed settings, matching the
            // default resolver. A managed policy therefore wins without ever
            // executing settings hooks.
            policy = next;
        }
    }

    match policy {
        ClaudeModelPolicy::Allowed(models) => Some(models),
        ClaudeModelPolicy::Unspecified => None,
    }
}

#[derive(Debug, Eq, PartialEq)]
enum ClaudeModelPolicy {
    Unspecified,
    Allowed(HashSet<String>),
}

fn claude_model_policy(settings: &serde_json::Value) -> ClaudeModelPolicy {
    let Some(models) = settings
        .get("availableModels")
        .and_then(serde_json::Value::as_array)
    else {
        return ClaudeModelPolicy::Unspecified;
    };
    ClaudeModelPolicy::Allowed(
        models
            .iter()
            .filter_map(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|model| !model.is_empty())
            .map(str::to_string)
            .collect(),
    )
}

fn claude_model_settings_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(config_dir) = env::var_os("CLAUDE_CONFIG_DIR").filter(|value| !value.is_empty()) {
        paths.push(PathBuf::from(config_dir).join("settings.json"));
    } else if let Some(home) = env::var_os("HOME").filter(|value| !value.is_empty()) {
        paths.push(PathBuf::from(home).join(".claude/settings.json"));
    }
    if cfg!(target_os = "macos") {
        paths.push(PathBuf::from(
            "/Library/Application Support/ClaudeCode/managed-settings.json",
        ));
    } else if cfg!(windows) {
        paths.extend(
            env::var_os("PROGRAMDATA")
                .map(PathBuf::from)
                .map(|path| path.join("ClaudeCode/managed-settings.json")),
        );
    } else {
        paths.push(PathBuf::from("/etc/claude-code/managed-settings.json"));
    }
    paths
}

pub(super) fn claude_auth_scope_warnings() -> Vec<ProviderWarning> {
    let alternate_provider = [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
    ]
    .into_iter()
    .any(|key| env::var_os(key).is_some_and(|value| !value.is_empty()));
    alternate_provider
        .then(|| ProviderWarning {
            code: "alternate-auth-scope".to_string(),
            severity: ProviderWarningSeverity::Advisory,
            message:
                "The catalog reflects the Anthropic provider mode configured in this environment."
                    .to_string(),
        })
        .into_iter()
        .collect()
}

pub(super) fn fallback_warning(label: &str) -> ProviderWarning {
    ProviderWarning {
        code: "lower-authority-catalog".to_string(),
        severity: ProviderWarningSeverity::Advisory,
        message: format!(
            "{label} was unavailable. Showing lower-confidence compatibility choices instead."
        ),
    }
}

pub(super) fn catalog_error(
    code: ProviderDiscoveryErrorCode,
    message: impl Into<String>,
) -> ProviderDiscoveryError {
    ProviderDiscoveryError {
        code,
        message: message.into(),
        retryable: true,
    }
}

pub(super) fn sanitize_catalog_error(error: ProviderDiscoveryError) -> ProviderDiscoveryError {
    let message = match error.code {
        ProviderDiscoveryErrorCode::SpawnFailed => "Could not start the provider catalog service.",
        ProviderDiscoveryErrorCode::HandshakeFailed => "The provider catalog handshake failed.",
        ProviderDiscoveryErrorCode::TimedOut => "Provider catalog discovery timed out.",
        ProviderDiscoveryErrorCode::Cancelled => "Provider catalog discovery was cancelled.",
        ProviderDiscoveryErrorCode::Unsupported
        | ProviderDiscoveryErrorCode::ProtocolIncompatible => {
            "This CLI version does not support structured model discovery."
        }
        ProviderDiscoveryErrorCode::InvalidResponse => {
            "The provider returned an invalid model catalog response."
        }
        ProviderDiscoveryErrorCode::OutputLimit => {
            "The provider catalog response exceeded QA Scribe's safety limit."
        }
        ProviderDiscoveryErrorCode::AuthRequired => {
            "Sign in with the provider CLI, then retry model discovery."
        }
        ProviderDiscoveryErrorCode::PolicyDenied => {
            "Provider policy does not allow model catalog discovery."
        }
        ProviderDiscoveryErrorCode::Network => {
            "The provider catalog could not be reached. Check the network or proxy and retry."
        }
        ProviderDiscoveryErrorCode::RateLimited => {
            "Provider catalog discovery was rate limited. Retry shortly."
        }
        ProviderDiscoveryErrorCode::Unavailable => "Provider catalog discovery is unavailable.",
    };
    ProviderDiscoveryError {
        code: error.code,
        message: message.to_string(),
        retryable: error.retryable,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use serde_json::json;

    use super::{
        ClaudeModelPolicy, claude_model_policy, filter_claude_models,
        parse_claude_structured_models,
    };

    #[test]
    fn claude_declarative_model_policy_is_parsed_without_executing_settings() {
        assert_eq!(
            claude_model_policy(&json!({
                "availableModels": ["sonnet", " opus ", "", 42],
                "hooks": {"SessionStart": [{"command": "must-not-run"}]}
            })),
            ClaudeModelPolicy::Allowed(
                ["sonnet".to_string(), "opus".to_string()]
                    .into_iter()
                    .collect()
            )
        );
        assert_eq!(
            claude_model_policy(&json!({
                "availableModels": ["sonnet"],
                "enforceAvailableModels": false
            })),
            ClaudeModelPolicy::Allowed(["sonnet".to_string()].into_iter().collect())
        );
        assert_eq!(
            claude_model_policy(&json!({"availableModels": []})),
            ClaudeModelPolicy::Allowed(HashSet::new())
        );
        assert_eq!(
            claude_model_policy(&json!({"model": "default"})),
            ClaudeModelPolicy::Unspecified
        );
    }

    #[test]
    fn claude_allowlist_keeps_default_and_supports_family_and_version_prefixes() {
        let models = parse_claude_structured_models(&[
            json!({"value": "default"}),
            json!({"value": "claude-sonnet-4-5"}),
            json!({"value": "claude-opus-4-6-20250514"}),
            json!({"value": "haiku"}),
        ]);
        let allowed = ["sonnet".to_string(), "claude-opus-4-6".to_string()]
            .into_iter()
            .collect();

        let filtered = filter_claude_models(models.clone(), Some(allowed));
        assert_eq!(
            filtered
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            ["default", "claude-sonnet-4-5", "claude-opus-4-6-20250514"]
        );
        assert_eq!(
            filter_claude_models(models, Some(HashSet::new()))
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            ["default"]
        );
    }

    #[test]
    fn claude_specific_version_disables_a_same_family_wildcard() {
        let models = parse_claude_structured_models(&[
            json!({"value": "sonnet"}),
            json!({"value": "claude-sonnet-4-5-20250929"}),
            json!({"value": "claude-sonnet-4-6-20260101"}),
        ]);
        let allowed = ["sonnet".to_string(), "claude-sonnet-4-5".to_string()]
            .into_iter()
            .collect();

        assert_eq!(
            filter_claude_models(models, Some(allowed))
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            ["sonnet", "claude-sonnet-4-5-20250929"]
        );
    }
}
