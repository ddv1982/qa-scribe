use std::collections::HashSet;

use serde_json::{Map, Value};

use crate::commands::providers::{ProviderDiscoveryError, ProviderDiscoveryErrorCode};

use super::{discovery_error, invalid_response};

pub(super) fn parse_models(
    result: Value,
    model_limit: usize,
) -> Result<Vec<Value>, ProviderDiscoveryError> {
    let raw_models = result
        .as_object()
        .and_then(|result| result.get("models"))
        .and_then(Value::as_array)
        .ok_or_else(invalid_response)?;
    if raw_models.len() > model_limit {
        return Err(discovery_error(
            ProviderDiscoveryErrorCode::OutputLimit,
            "GitHub Copilot model discovery exceeded the model limit.",
        ));
    }

    let mut seen = HashSet::with_capacity(raw_models.len());
    let mut models = Vec::with_capacity(raw_models.len());
    for raw in raw_models {
        let model = normalize_model(raw)?;
        let id = model
            .get("id")
            .and_then(Value::as_str)
            .expect("normalized Copilot models always have an id");
        if seen.insert(id.to_string()) {
            models.push(model);
        }
    }
    Ok(models)
}

fn normalize_model(raw: &Value) -> Result<Value, ProviderDiscoveryError> {
    let raw = raw.as_object().ok_or_else(invalid_response)?;
    let id = required_nonempty_string(raw.get("id"))?;
    let name = required_nonempty_string(raw.get("name"))?;

    let mut normalized = Map::new();
    normalized.insert("id".to_string(), Value::String(id.to_string()));
    normalized.insert("label".to_string(), Value::String(name.to_string()));
    copy_string(raw, "description", &mut normalized, "description");
    copy_string(
        raw,
        "defaultReasoningEffort",
        &mut normalized,
        "defaultReasoningEffort",
    );
    copy_reasoning_efforts(raw, &mut normalized);
    copy_capabilities(raw, &mut normalized);
    copy_policy_state(raw, &mut normalized);

    Ok(Value::Object(normalized))
}

fn copy_reasoning_efforts(raw: &Map<String, Value>, normalized: &mut Map<String, Value>) {
    if let Some(efforts) = raw
        .get("supportedReasoningEfforts")
        .and_then(Value::as_array)
    {
        let efforts = efforts
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|effort| !effort.is_empty())
            .map(|effort| Value::String(effort.to_string()))
            .collect();
        normalized.insert("reasoningEfforts".to_string(), Value::Array(efforts));
    }
}

fn copy_capabilities(raw: &Map<String, Value>, normalized: &mut Map<String, Value>) {
    let capabilities = raw.get("capabilities").and_then(Value::as_object);
    if let Some(supports) = capabilities
        .and_then(|capabilities| capabilities.get("supports"))
        .and_then(Value::as_object)
    {
        copy_bool(supports, "vision", normalized, "vision");
        if let Some(reasoning) = supports
            .get("reasoning")
            .or_else(|| supports.get("reasoningEffort"))
            .and_then(Value::as_bool)
        {
            normalized.insert("reasoning".to_string(), Value::Bool(reasoning));
        }
        if let Some(adaptive) = supports.get("adaptive_thinking").and_then(Value::as_str) {
            let supported = match adaptive {
                "unsupported" => Some(false),
                "optional" | "required" => Some(true),
                _ => None,
            };
            if let Some(supported) = supported {
                normalized.insert("adaptiveThinking".to_string(), Value::Bool(supported));
            }
        }
    }

    if let Some(limits) = capabilities
        .and_then(|capabilities| capabilities.get("limits"))
        .and_then(Value::as_object)
    {
        copy_u64(
            limits,
            "max_context_window_tokens",
            normalized,
            "contextWindowTokens",
        );
        copy_u64(limits, "max_output_tokens", normalized, "maxOutputTokens");
    }
}

fn copy_policy_state(raw: &Map<String, Value>, normalized: &mut Map<String, Value>) {
    if let Some(state) = raw
        .get("policy")
        .and_then(Value::as_object)
        .and_then(|policy| policy.get("state"))
        .and_then(Value::as_str)
        .filter(|state| matches!(*state, "enabled" | "disabled" | "unconfigured"))
    {
        normalized.insert("policyState".to_string(), Value::String(state.to_string()));
    }
}

fn required_nonempty_string(value: Option<&Value>) -> Result<&str, ProviderDiscoveryError> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(invalid_response)
}

pub(super) fn optional_nonempty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn copy_string(
    raw: &Map<String, Value>,
    raw_key: &str,
    normalized: &mut Map<String, Value>,
    normalized_key: &str,
) {
    if let Some(value) = optional_nonempty_string(raw.get(raw_key)) {
        normalized.insert(normalized_key.to_string(), Value::String(value));
    }
}

fn copy_bool(
    raw: &Map<String, Value>,
    raw_key: &str,
    normalized: &mut Map<String, Value>,
    normalized_key: &str,
) {
    if let Some(value) = raw.get(raw_key).and_then(Value::as_bool) {
        normalized.insert(normalized_key.to_string(), Value::Bool(value));
    }
}

fn copy_u64(
    raw: &Map<String, Value>,
    raw_key: &str,
    normalized: &mut Map<String, Value>,
    normalized_key: &str,
) {
    if let Some(value) = raw.get(raw_key).and_then(Value::as_u64) {
        normalized.insert(normalized_key.to_string(), Value::from(value));
    }
}
