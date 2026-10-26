use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefinementResponseContract {
    pub version: u8,
    pub request_id: String,
    pub record_kind: RefinementRecordKind,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum RefinementRecordKind {
    Finding,
    TestCasesDraft,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RefinementPatch {
    Finding {
        title: Option<String>,
        #[serde(rename = "bodyMarkdown")]
        body_markdown: Option<String>,
        metadata: Option<FindingMetadataRefinement>,
    },
    TestCasesDraft {
        title: Option<String>,
        #[serde(rename = "bodyMarkdown")]
        body_markdown: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct FindingMetadataRefinement {
    pub severity: Option<String>,
    pub status: Option<String>,
    pub component: Option<String>,
    pub reference: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RefinementEditorValue {
    pub title: String,
    pub document_json: String,
    pub metadata_json: Option<String>,
    pub record_kind: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EditorStage {
    pub id: String,
    pub before: RefinementEditorValue,
    pub after: RefinementEditorValue,
    pub stored_base_token: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RefinementState {
    Offered,
    Applied,
    Staged { stage: EditorStage },
    Saved { stage: EditorStage },
    Dismissed,
    Undone { stage: EditorStage },
    Reverted { stage: EditorStage },
    Abandoned { stage: EditorStage },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RefinementProposal {
    pub version: u8,
    pub id: String,
    pub user_message_id: String,
    pub assistant_message_id: String,
    pub target: super::ChatTarget,
    pub patch: RefinementPatch,
    pub before: RefinementEditorValue,
    pub after: RefinementEditorValue,
    pub state: RefinementState,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RefinementRequest {
    pub scope: super::ChatRevision,
    pub proposal_id: String,
    pub action: RefinementAction,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum RefinementAction {
    Stage,
    Dismiss,
    Undo,
    Discard,
    Abandon,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordWriteGuard {
    pub session_id: String,
    pub expected_stored_base: String,
    pub origin: RecordWriteOrigin,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RecordWriteOutcome<T> {
    Saved { record: T },
    Conflict { current: T },
}

impl<T> RecordWriteOutcome<T> {
    pub fn into_saved(self) -> crate::Result<T> {
        match self {
            Self::Saved { record } => Ok(record),
            Self::Conflict { .. } => Err(crate::error::validation("Stored record changed")),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum RecordWriteOrigin {
    Editor,
    Proposal {
        #[serde(rename = "stageId")]
        stage_id: String,
    },
    Compensation {
        #[serde(rename = "stageId")]
        stage_id: Option<String>,
        #[serde(rename = "restoredBase")]
        restored_base: String,
    },
}

impl RecordWriteGuard {
    pub fn stage_id(&self) -> Option<&str> {
        match &self.origin {
            RecordWriteOrigin::Editor => None,
            RecordWriteOrigin::Proposal { stage_id } => Some(stage_id),
            RecordWriteOrigin::Compensation { stage_id, .. } => stage_id.as_deref(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyRefinementRequest {
    pub reference: super::ChatRef,
    pub proposal_id: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RefinedRecord {
    Finding { record: super::Finding },
    TestCasesDraft { record: super::Draft },
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppliedRefinement {
    pub chat: super::ChatState,
    pub updated: RefinedRecord,
}
