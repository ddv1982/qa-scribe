use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatRef {
    pub session_id: String,
    pub draft_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ConversationRecord {
    Finding { record_id: String },
    TestCasesDraft { record_id: String },
}

impl ConversationRecord {
    pub(crate) fn stored(&self) -> (&'static str, &str) {
        match self {
            Self::Finding { record_id } => ("finding", record_id),
            Self::TestCasesDraft { record_id } => ("test_cases_draft", record_id),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ConversationOwner {
    Notes {
        session_id: String,
    },
    Record {
        session_id: String,
        record: ConversationRecord,
    },
}

impl ConversationOwner {
    pub(crate) fn from_stored(
        session_id: String,
        kind: &str,
        id: Option<String>,
    ) -> crate::Result<Self> {
        let record = match (kind, id) {
            ("notes", None) => return Ok(Self::Notes { session_id }),
            ("finding", Some(record_id)) if !record_id.trim().is_empty() => {
                ConversationRecord::Finding { record_id }
            }
            ("test_cases_draft", Some(record_id)) if !record_id.trim().is_empty() => {
                ConversationRecord::TestCasesDraft { record_id }
            }
            _ => {
                return Err(crate::error::validation(
                    "Invalid stored conversation owner",
                ));
            }
        };
        Ok(Self::Record { session_id, record })
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ChatComposerIntent {
    #[default]
    Message,
    RefineRecord,
    DraftJira,
}

impl ChatComposerIntent {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Message => "message",
            Self::RefineRecord => "refine_record",
            Self::DraftJira => "draft_jira",
        }
    }
    pub fn from_stored(value: &str) -> crate::Result<Self> {
        match value {
            "message" => Ok(Self::Message),
            "refine_record" => Ok(Self::RefineRecord),
            "draft_jira" => Ok(Self::DraftJira),
            _ => Err(crate::error::validation("Invalid stored composer intent")),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BeginRecordChatRequest {
    pub session_id: String,
    pub draft_id: String,
    pub record: ConversationRecord,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ChatHistoryScope {
    Notes {
        session_id: String,
    },
    Record {
        session_id: String,
        record: ConversationRecord,
    },
    Session {
        session_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StageOrigin {
    pub reference: ChatRef,
    pub proposal_id: String,
    pub stage_id: String,
    pub record: ConversationRecord,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryEntry {
    pub reference: ChatRef,
    pub owner: ConversationOwner,
    pub created_at: String,
    pub last_active_at: String,
    pub last_active_order: i64,
    pub preview: String,
    pub archived: bool,
    pub submission: Option<super::ChatSubmissionReceipt>,
    pub has_content: bool,
    pub last_turn_status: Option<super::ChatTurnStatus>,
    pub unresolved_stages: Vec<StageOrigin>,
}
