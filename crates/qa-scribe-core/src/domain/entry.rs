use serde::{Deserialize, Serialize};

use crate::{QaScribeError, Result};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum EntryType {
    Note,
    Observation,
    ApiResponse,
    Log,
    Screenshot,
    FindingCandidate,
}

impl EntryType {
    pub fn as_str(self) -> &'static str {
        match self {
            EntryType::Note => "note",
            EntryType::Observation => "observation",
            EntryType::ApiResponse => "api_response",
            EntryType::Log => "log",
            EntryType::Screenshot => "screenshot",
            EntryType::FindingCandidate => "finding_candidate",
        }
    }

    pub fn from_stored(value: &str) -> Result<Self> {
        match value {
            "note" => Ok(EntryType::Note),
            "observation" => Ok(EntryType::Observation),
            "api_response" => Ok(EntryType::ApiResponse),
            "log" => Ok(EntryType::Log),
            "screenshot" => Ok(EntryType::Screenshot),
            "finding_candidate" => Ok(EntryType::FindingCandidate),
            _ => Err(QaScribeError::InvalidStoredValue {
                field: "entry.type",
                value: value.to_string(),
            }),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub session_id: String,
    pub entry_type: EntryType,
    pub title: Option<String>,
    pub body: String,
    pub body_json: Option<String>,
    pub body_format: Option<String>,
    pub metadata_json: Option<String>,
    pub excluded_from_generation: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EntryDraft {
    pub session_id: String,
    pub entry_type: EntryType,
    #[specta(optional)]
    pub title: Option<String>,
    pub body: String,
    #[specta(optional)]
    pub body_json: Option<String>,
    #[specta(optional)]
    pub body_format: Option<String>,
    #[specta(optional)]
    pub metadata_json: Option<String>,
    pub excluded_from_generation: bool,
}

/// Partial update for an `Entry`. Absent field = no change. `body` and
/// `excluded_from_generation` are non-clearable (typed `?: string` /
/// `?: boolean`, no `null`); clearable rich text fields use
/// `Option<Option<String>>` (`?: string | null`). `body_format` is non-null in
/// storage, so `null` resets it to the default `html` format.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EntryPatch {
    #[specta(optional)]
    pub title: Option<Option<String>>,
    #[specta(optional, type = String)]
    pub body: Option<String>,
    #[specta(optional)]
    pub body_json: Option<Option<String>>,
    #[specta(optional)]
    pub body_format: Option<Option<String>>,
    #[specta(optional)]
    pub metadata_json: Option<Option<String>>,
    #[specta(optional, type = bool)]
    pub excluded_from_generation: Option<bool>,
}
