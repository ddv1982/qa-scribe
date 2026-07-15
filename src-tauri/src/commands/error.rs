//! The serializable error shape every `#[tauri::command]` rejects with.
//!
//! Tauri serializes a command's `Err` payload as the JS promise's rejection
//! value, so `CommandError` (rather than a bare `String`) lets the frontend
//! distinguish user-facing validation copy from opaque internal failures
//! without parsing prose. Classification happens at the error's source (see
//! [`CommandError::from`] for [`QaScribeError`]), never by pattern-matching
//! message text after the fact.

use qa_scribe_core::QaScribeError;
use serde::Serialize;

use crate::jobs::JobStoreError;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum CommandErrorKind {
    Validation,
    NotFound,
    Internal,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
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
            QaScribeError::NotFound(_) => CommandError::not_found(error.to_string()),
            QaScribeError::InvalidStoredValue { .. }
            | QaScribeError::Sqlite(_)
            | QaScribeError::Io(_) => CommandError::internal(error.to_string()),
        }
    }
}

impl From<JobStoreError> for CommandError {
    fn from(error: JobStoreError) -> Self {
        let message = error.to_string();
        match error {
            JobStoreError::Capacity { .. } => CommandError::validation(message),
            JobStoreError::NotFound { .. } => CommandError::not_found(message),
            JobStoreError::Internal(_) => CommandError::internal(message),
        }
    }
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
    fn internal_constructor_sets_internal_kind() {
        let error = CommandError::internal("Session service lock was poisoned");

        assert_eq!(error.kind, CommandErrorKind::Internal);
    }

    #[test]
    fn job_capacity_maps_to_validation_and_missing_job_maps_to_not_found() {
        let capacity = CommandError::from(JobStoreError::Capacity { limit: 3 });
        let missing = CommandError::from(JobStoreError::NotFound {
            job_id: "job-1".to_string(),
        });

        assert_eq!(capacity.kind, CommandErrorKind::Validation);
        assert!(capacity.message.contains("At most 3"));
        assert_eq!(missing.kind, CommandErrorKind::NotFound);
        assert_eq!(missing.message, "Generation job job-1 was not found.");
    }

    #[test]
    fn serializes_kind_as_camel_case_over_the_boundary() {
        let error = CommandError::not_found("not found: session-1");

        let json = serde_json::to_value(&error).expect("serializes");

        assert_eq!(json["kind"], "notFound");
        assert_eq!(json["message"], "not found: session-1");
    }
}
