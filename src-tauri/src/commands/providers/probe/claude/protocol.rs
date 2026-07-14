use serde_json::{Map, Value};

use crate::commands::providers::{ProviderDiscoveryError, ProviderDiscoveryErrorCode};

use super::{ClaudeCatalogResult, INITIALIZE_REQUEST_ID, discovery_error};

pub(super) fn parse_frame(
    frame: &[u8],
    model_limit: usize,
) -> Result<Option<ClaudeCatalogResult>, ProviderDiscoveryError> {
    let value: Value = serde_json::from_slice(frame).map_err(|_| {
        discovery_error(
            ProviderDiscoveryErrorCode::InvalidResponse,
            "Claude model discovery returned malformed JSON",
        )
    })?;

    if value.get("type").and_then(Value::as_str) != Some("control_response") {
        return Ok(None);
    }
    let Some(response) = value.get("response").and_then(Value::as_object) else {
        return Ok(None);
    };
    if response.get("request_id").and_then(Value::as_str) != Some(INITIALIZE_REQUEST_ID) {
        return Ok(None);
    }
    if response.get("subtype").and_then(Value::as_str) != Some("success") {
        let code = response
            .get("error")
            .and_then(Value::as_object)
            .and_then(|error| error.get("code"))
            .or_else(|| response.get("errorCode"))
            .and_then(Value::as_str);
        let error_code = match code {
            Some("authentication_required" | "unauthorized" | "not_authenticated") => {
                ProviderDiscoveryErrorCode::AuthRequired
            }
            Some("permission_denied" | "policy_denied") => ProviderDiscoveryErrorCode::PolicyDenied,
            _ => ProviderDiscoveryErrorCode::Unavailable,
        };
        return Err(discovery_error(
            error_code,
            "Claude model discovery was rejected",
        ));
    }

    let raw_models = response
        .get("response")
        .and_then(Value::as_object)
        .and_then(|payload| payload.get("models"))
        .and_then(Value::as_array)
        .ok_or_else(|| {
            discovery_error(
                ProviderDiscoveryErrorCode::InvalidResponse,
                "Claude model discovery response did not include a model array",
            )
        })?;
    if raw_models.len() > model_limit {
        return Err(discovery_error(
            ProviderDiscoveryErrorCode::OutputLimit,
            "Claude model discovery returned too many model entries",
        ));
    }

    let models = raw_models.iter().filter_map(normalize_model).collect();
    Ok(Some(ClaudeCatalogResult { models }))
}

fn normalize_model(raw: &Value) -> Option<Value> {
    let raw = raw.as_object()?;
    let id = nonempty_string(raw.get("value")?)?;
    let mut normalized = Map::new();
    normalized.insert("id".to_string(), Value::String(id.to_string()));

    copy_string(raw, "displayName", &mut normalized, "label");
    copy_string(raw, "description", &mut normalized, "description");
    copy_string(
        raw,
        "defaultReasoningEffort",
        &mut normalized,
        "defaultReasoningEffort",
    );
    copy_string(raw, "resolvedModel", &mut normalized, "resolvedModel");
    copy_bool(raw, "supportsEffort", &mut normalized, "supportsEffort");
    copy_bool(
        raw,
        "supportsAdaptiveThinking",
        &mut normalized,
        "supportsAdaptiveThinking",
    );
    copy_bool(raw, "supportsFastMode", &mut normalized, "supportsFastMode");
    copy_bool(raw, "supportsAutoMode", &mut normalized, "supportsAutoMode");

    if let Some(levels) = raw.get("supportedEffortLevels").and_then(Value::as_array) {
        let levels = levels
            .iter()
            .filter_map(Value::as_str)
            .filter(|level| !level.trim().is_empty())
            .map(|level| Value::String(level.to_string()))
            .collect();
        normalized.insert("reasoningEfforts".to_string(), Value::Array(levels));
    }

    Some(Value::Object(normalized))
}

fn nonempty_string(value: &Value) -> Option<&str> {
    value.as_str().filter(|value| !value.trim().is_empty())
}

fn copy_string(
    raw: &Map<String, Value>,
    raw_key: &str,
    normalized: &mut Map<String, Value>,
    normalized_key: &str,
) {
    if let Some(value) = raw.get(raw_key).and_then(nonempty_string) {
        normalized.insert(normalized_key.to_string(), Value::String(value.to_string()));
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
