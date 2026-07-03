//! The serializable error shape every `#[tauri::command]` rejects with.
//!
//! Tauri serializes a command's `Err` payload as the JS promise's rejection
//! value, so `CommandError` (rather than a bare `String`) lets the frontend
//! distinguish user-facing validation copy from opaque internal failures and
//! provider-CLI failures without parsing prose. Classification happens at the
//! error's source (see [`CommandError::from`] for [`QaScribeError`] and the
//! `provider`/`internal` constructors used by the AI command modules), never
//! by pattern-matching message text after the fact.

use qa_scribe_core::QaScribeError;
use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CommandErrorKind {
    Validation,
    NotFound,
    // Provider-CLI failures (readiness, command construction, process
    // failure) currently surface only through `GenerationJobEvent::Failed`,
    // not a `#[tauri::command]` `Result`, so nothing constructs this variant
    // today. It stays part of the public shape so a command that reports
    // provider failures directly (e.g. a future synchronous readiness check)
    // can classify at the source instead of falling back to `internal`.
    #[allow(dead_code)]
    Provider,
    Internal,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CommandError {
    pub kind: CommandErrorKind,
    pub message: String,
}

impl CommandError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self {
            kind: CommandErrorKind::Validation,
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self {
            kind: CommandErrorKind::NotFound,
            message: message.into(),
        }
    }

    #[allow(dead_code)]
    pub fn provider(message: impl Into<String>) -> Self {
        Self {
            kind: CommandErrorKind::Provider,
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            kind: CommandErrorKind::Internal,
            message: message.into(),
        }
    }
}

impl From<QaScribeError> for CommandError {
    fn from(error: QaScribeError) -> Self {
        match error {
            QaScribeError::Validation(message) => CommandError::validation(message),
            QaScribeError::NotFound(ref id) => CommandError::not_found(error_message(&error, id)),
            QaScribeError::InvalidStoredValue { .. }
            | QaScribeError::Sqlite(_)
            | QaScribeError::Io(_) => CommandError::internal(error.to_string()),
        }
    }
}

/// `QaScribeError::NotFound`'s `Display` renders `"not found: {id}"`; reuse
/// it rather than duplicating the format string here.
fn error_message(error: &QaScribeError, _id: &str) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation_error_maps_to_validation_kind_with_unprefixed_message() {
        let error = CommandError::from(QaScribeError::Validation("title is required".into()));

        assert_eq!(error.kind, CommandErrorKind::Validation);
        assert_eq!(error.message, "title is required");
    }

    #[test]
    fn not_found_error_maps_to_not_found_kind() {
        let error = CommandError::from(QaScribeError::NotFound("session-1".into()));

        assert_eq!(error.kind, CommandErrorKind::NotFound);
        assert_eq!(error.message, "not found: session-1");
    }

    #[test]
    fn invalid_stored_value_maps_to_internal_kind() {
        let error = CommandError::from(QaScribeError::InvalidStoredValue {
            field: "status",
            value: "bogus".into(),
        });

        assert_eq!(error.kind, CommandErrorKind::Internal);
        assert_eq!(error.message, "invalid stored value for status: bogus");
    }

    #[test]
    fn sqlite_error_maps_to_internal_kind() {
        let sqlite_error = rusqlite::Error::InvalidQuery;
        let error = CommandError::from(QaScribeError::Sqlite(sqlite_error));

        assert_eq!(error.kind, CommandErrorKind::Internal);
    }

    #[test]
    fn io_error_maps_to_internal_kind() {
        let io_error = std::io::Error::other("disk full");
        let error = CommandError::from(QaScribeError::Io(io_error));

        assert_eq!(error.kind, CommandErrorKind::Internal);
        assert_eq!(error.message, "disk full");
    }

    #[test]
    fn provider_constructor_sets_provider_kind() {
        let error = CommandError::provider("GitHub Copilot CLI is not ready.");

        assert_eq!(error.kind, CommandErrorKind::Provider);
        assert_eq!(error.message, "GitHub Copilot CLI is not ready.");
    }

    #[test]
    fn internal_constructor_sets_internal_kind() {
        let error = CommandError::internal("Session service lock was poisoned");

        assert_eq!(error.kind, CommandErrorKind::Internal);
    }

    #[test]
    fn serializes_kind_as_camel_case_over_the_boundary() {
        let error = CommandError::not_found("not found: session-1");

        let json = serde_json::to_value(&error).expect("serializes");

        assert_eq!(json["kind"], "notFound");
        assert_eq!(json["message"], "not found: session-1");
    }
}
