use serde::{Deserialize, Serialize};

use crate::{QaScribeError, Result};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum DraftKind {
    SessionReport,
    Testware,
}

impl DraftKind {
    pub fn as_str(self) -> &'static str {
        match self {
            DraftKind::SessionReport => "session_report",
            DraftKind::Testware => "testware",
        }
    }

    pub fn from_stored(value: &str) -> Result<Self> {
        match value {
            "session_report" => Ok(DraftKind::SessionReport),
            "testware" => Ok(DraftKind::Testware),
            _ => Err(QaScribeError::InvalidStoredValue {
                field: "draft.kind",
                value: value.to_string(),
            }),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub id: String,
    pub session_id: String,
    pub ai_run_id: Option<String>,
    pub kind: DraftKind,
    pub title: String,
    pub body: String,
    pub body_json: Option<String>,
    pub body_format: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DraftCreate {
    pub session_id: String,
    pub ai_run_id: Option<String>,
    pub kind: DraftKind,
    pub title: String,
    pub body: String,
    #[specta(optional)]
    pub body_json: Option<String>,
    #[specta(optional)]
    pub body_format: Option<String>,
    #[specta(optional)]
    pub metadata_json: Option<String>,
}

/// Partial update for a `Draft`. Absent field = no change. `title`/`body` are
/// non-clearable (`?: string`, no `null`); the `Option<Option<String>>` fields
/// are clearable (`?: string | null`). See `SessionPatch` for the two-tier
/// null rationale.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DraftPatch {
    #[specta(optional, type = String)]
    pub title: Option<String>,
    #[specta(optional, type = String)]
    pub body: Option<String>,
    #[specta(optional)]
    pub body_json: Option<Option<String>>,
    #[specta(optional)]
    pub body_format: Option<Option<String>>,
    #[specta(optional)]
    pub metadata_json: Option<Option<String>>,
}
