use crate::{Result, error::validation};

pub const TEXT_BODY_MAX_LENGTH: usize = 100_000;
pub const METADATA_JSON_MAX_LENGTH: usize = 20_000;
pub const DRAFT_BODY_MAX_LENGTH: usize = 250_000;
pub const RICH_BODY_JSON_MAX_LENGTH: usize = 500_000;
pub const TESTWARE_CUSTOM_INSTRUCTIONS_MAX_LENGTH: usize = 4_000;

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
    if trimmed.chars().count() > max_len {
        return Err(validation(format!(
            "{label} must be at most {max_len} characters"
        )));
    }
    Ok(trimmed.to_string())
}

pub fn validate_body_text(label: &str, value: &str, max_len: usize) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.chars().count() > max_len {
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
    if cleaned.chars().count() > max_len {
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

/// A SHA-256 digest rendered as lowercase hex is always exactly this many
/// characters (32 bytes * 2 hex digits per byte).
pub const SHA256_HEX_LENGTH: usize = 64;

/// Validates that `value` is exactly [`SHA256_HEX_LENGTH`] lowercase hex
/// characters, i.e. the shape `hex_sha256` in `attachments/mod.rs` always
/// produces. This is create-time only: rows written before this check
/// existed (e.g. migrated legacy data) are read back as-is and are not
/// re-validated, so they keep working even if their stored digest predates
/// this format.
pub fn validate_sha256_hex(label: &str, value: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.len() != SHA256_HEX_LENGTH
        || !trimmed
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(validation(format!(
            "{label} must be exactly {SHA256_HEX_LENGTH} lowercase hex characters"
        )));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A title of exactly `TITLE_MAX_LENGTH` multibyte (3-byte-in-UTF-8) CJK
    /// characters must pass: these limits are documented and messaged as
    /// character counts, so they must be enforced in characters, not bytes.
    /// (`TITLE_MAX_LENGTH` 3-byte chars is well over the byte length a
    /// bytes-based check would have allowed.)
    #[test]
    fn validate_required_text_allows_exactly_the_char_limit_in_multibyte_text() {
        let title: String = "\u{6d4b}".repeat(TITLE_MAX_LENGTH);
        assert_eq!(title.chars().count(), TITLE_MAX_LENGTH);

        let result = validate_required_text("Title", &title, TITLE_MAX_LENGTH);

        assert_eq!(
            result.expect("title at the limit should be accepted"),
            title
        );
    }

    #[test]
    fn validate_required_text_rejects_one_char_over_the_limit_in_multibyte_text() {
        let title: String = "\u{6d4b}".repeat(TITLE_MAX_LENGTH + 1);

        let result = validate_required_text("Title", &title, TITLE_MAX_LENGTH);

        assert!(
            result.is_err(),
            "a title one character over the limit should be rejected even though it fits \
             comfortably under the limit in bytes"
        );
    }

    #[test]
    fn validate_body_text_counts_characters_not_bytes() {
        let body: String = "\u{6d4b}".repeat(TEXT_BODY_MAX_LENGTH);
        assert_eq!(body.chars().count(), TEXT_BODY_MAX_LENGTH);

        let result = validate_body_text("Body", &body, TEXT_BODY_MAX_LENGTH);

        assert!(result.is_ok(), "body at the char limit should be accepted");

        let too_long: String = "\u{6d4b}".repeat(TEXT_BODY_MAX_LENGTH + 1);
        assert!(validate_body_text("Body", &too_long, TEXT_BODY_MAX_LENGTH).is_err());
    }

    #[test]
    fn validate_optional_text_counts_characters_not_bytes() {
        let value: String = "\u{6d4b}".repeat(SESSION_ENVIRONMENT_MAX_LENGTH);
        assert_eq!(value.chars().count(), SESSION_ENVIRONMENT_MAX_LENGTH);

        let result = validate_optional_text(
            "Environment",
            Some(value.clone()),
            SESSION_ENVIRONMENT_MAX_LENGTH,
        );
        assert_eq!(
            result.expect("value at the limit should be accepted"),
            Some(value)
        );

        let too_long: String = "\u{6d4b}".repeat(SESSION_ENVIRONMENT_MAX_LENGTH + 1);
        assert!(
            validate_optional_text(
                "Environment",
                Some(too_long),
                SESSION_ENVIRONMENT_MAX_LENGTH
            )
            .is_err()
        );
    }

    #[test]
    fn ascii_boundary_still_enforced_at_exactly_the_limit() {
        let at_limit = "a".repeat(TITLE_MAX_LENGTH);
        assert!(validate_required_text("Title", &at_limit, TITLE_MAX_LENGTH).is_ok());

        let over_limit = "a".repeat(TITLE_MAX_LENGTH + 1);
        assert!(validate_required_text("Title", &over_limit, TITLE_MAX_LENGTH).is_err());
    }
}
