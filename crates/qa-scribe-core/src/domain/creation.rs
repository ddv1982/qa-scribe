use serde::{Deserialize, Serialize};

use super::{Draft, Entry, Finding, FindingKind};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum CreationKind {
    Finding,
    Testware,
}

impl CreationKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Finding => "finding",
            Self::Testware => "testware",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationImageDescriptor {
    pub local_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: u32,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PrepareCreationSave {
    pub attempt_id: String,
    pub session_id: String,
    pub kind: CreationKind,
    pub images: Vec<CreationImageDescriptor>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedCreationImage {
    pub local_id: String,
    pub attachment_id: String,
    pub filename: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreparedCreation {
    pub attempt_id: String,
    pub images: Vec<PreparedCreationImage>,
    pub outcome: CreationOutcome,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CreationRecordInput {
    Finding {
        title: String,
        body: String,
        body_json: Option<String>,
        body_format: Option<String>,
        metadata_json: Option<String>,
        finding_kind: FindingKind,
    },
    Testware {
        title: String,
        body: String,
        body_json: Option<String>,
        body_format: Option<String>,
        metadata_json: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CreationImageInput {
    pub local_id: String,
    pub data_url: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitCreationSave {
    pub attempt_id: String,
    pub record: CreationRecordInput,
    pub images: Vec<CreationImageInput>,
    pub shared_attachment_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(tag = "kind", content = "record", rename_all = "camelCase")]
pub enum CreatedRecord {
    Finding(Finding),
    Testware(Draft),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CreationOutcome {
    Preparing,
    Committed { record: Box<CreatedRecord> },
    CommittedDeleted { record_id: String },
    Aborted,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteSource {
    pub entry: Entry,
    pub revision: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreationRecoveryStatus {
    pub pending_attempts: u32,
}
