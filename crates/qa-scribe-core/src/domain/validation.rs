use crate::{Result, error::validation};

pub const TEXT_BODY_MAX_LENGTH: usize = 100_000;
pub const METADATA_JSON_MAX_LENGTH: usize = 20_000;
pub const DRAFT_BODY_MAX_LENGTH: usize = 250_000;
pub const RICH_BODY_JSON_MAX_LENGTH: usize = 500_000;

/// Maximum length for a title: Sessions, Findings, Drafts, and Entries all
/// share this limit.
pub const TITLE_MAX_LENGTH: usize = 160;

/// Maximum length for the `body_format` field stored alongside a rich-text
/// body (Entries, Findings, and Drafts).
pub const BODY_FORMAT_MAX_LENGTH: usize = 40;

/// Maximum length for a Session's `session_context` and `objective_notes`.
pub const SESSION_NOTES_MAX_LENGTH: usize = 2_000;

/// Maximum length for a Session's `environment` field.
pub const SESSION_ENVIRONMENT_MAX_LENGTH: usize = 240;

/// Maximum length for a Session's `build_version` field.
pub const SESSION_BUILD_VERSION_MAX_LENGTH: usize = 120;

/// Maximum length for a Session's `related_reference` field.
pub const SESSION_RELATED_REFERENCE_MAX_LENGTH: usize = 500;

pub fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub fn validate_required_text(label: &str, value: &str, max_len: usize) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(validation(format!("{label} is required")));
    }
    if trimmed.len() > max_len {
        return Err(validation(format!(
            "{label} must be at most {max_len} characters"
        )));
    }
    Ok(trimmed.to_string())
}

pub fn validate_body_text(label: &str, value: &str, max_len: usize) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.len() > max_len {
        return Err(validation(format!(
            "{label} must be at most {max_len} characters"
        )));
    }
    Ok(trimmed.to_string())
}

pub fn validate_optional_text(
    label: &str,
    value: Option<String>,
    max_len: usize,
) -> Result<Option<String>> {
    let Some(cleaned) = clean_optional(value) else {
        return Ok(None);
    };
    if cleaned.len() > max_len {
        return Err(validation(format!(
            "{label} must be at most {max_len} characters"
        )));
    }
    Ok(Some(cleaned))
}

pub fn validate_metadata_json(value: Option<String>) -> Result<Option<String>> {
    let Some(cleaned) = validate_optional_text("metadata JSON", value, METADATA_JSON_MAX_LENGTH)?
    else {
        return Ok(None);
    };
    let parsed: serde_json::Value = serde_json::from_str(&cleaned)
        .map_err(|_| validation("metadata JSON must be a JSON object"))?;
    if !parsed.is_object() {
        return Err(validation("metadata JSON must be a JSON object"));
    }
    Ok(Some(cleaned))
}

pub fn validate_body_json(value: Option<String>) -> Result<Option<String>> {
    let Some(value) = validate_optional_text("rich body JSON", value, RICH_BODY_JSON_MAX_LENGTH)?
    else {
        return Ok(None);
    };
    serde_json::from_str::<serde_json::Value>(&value)
        .map_err(|_| validation("rich body JSON must be valid JSON"))?;
    Ok(Some(value))
}
