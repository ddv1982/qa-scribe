use serde::{Deserialize, Serialize};

use crate::{QaScribeError, Result};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FindingKind {
    Bug,
    Question,
    Risk,
    FollowUp,
    Note,
}

impl FindingKind {
    pub fn as_str(self) -> &'static str {
        match self {
            FindingKind::Bug => "bug",
            FindingKind::Question => "question",
            FindingKind::Risk => "risk",
            FindingKind::FollowUp => "follow_up",
            FindingKind::Note => "note",
        }
    }

    pub fn from_stored(value: &str) -> Result<Self> {
        match value {
            "bug" => Ok(FindingKind::Bug),
            "question" => Ok(FindingKind::Question),
            "risk" => Ok(FindingKind::Risk),
            "follow_up" => Ok(FindingKind::FollowUp),
            "note" => Ok(FindingKind::Note),
            _ => Err(QaScribeError::InvalidStoredValue {
                field: "finding.kind",
                value: value.to_string(),
            }),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub body: String,
    pub body_json: Option<String>,
    pub body_format: Option<String>,
    pub kind: FindingKind,
    pub metadata_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingDraft {
    pub session_id: String,
    pub title: String,
    pub body: String,
    pub body_json: Option<String>,
    pub body_format: Option<String>,
    pub kind: FindingKind,
    pub metadata_json: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingPatch {
    pub title: Option<String>,
    pub body: Option<String>,
    pub body_json: Option<Option<String>>,
    pub body_format: Option<Option<String>>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceLink {
    pub id: String,
    pub finding_id: String,
    pub entry_id: Option<String>,
    pub attachment_id: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceLinkDraft {
    pub finding_id: String,
    pub entry_id: Option<String>,
    pub attachment_id: Option<String>,
}
