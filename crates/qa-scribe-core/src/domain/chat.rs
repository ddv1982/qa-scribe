use serde::{Deserialize, Serialize};

macro_rules! chat_enum {
    ($name:ident { $($variant:ident => $stored:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
        #[serde(rename_all = "snake_case")]
        pub enum $name { $($variant),+ }
        impl $name {
            pub fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $stored),+ }
            }
            pub fn from_stored(value: &str) -> crate::Result<Self> {
                match value {
                    $($stored => Ok(Self::$variant),)+
                    _ => Err(crate::QaScribeError::InvalidStoredValue {
                        field: stringify!($name), value: value.into(),
                    }),
                }
            }
        }
    };
}

chat_enum!(ChatMode { WriteNote => "write_note", Chat => "chat" });
chat_enum!(ChatRole { User => "user", Assistant => "assistant" });
chat_enum!(ChatTurnStatus {
    Running => "running", Completed => "completed", Failed => "failed",
    Cancelled => "cancelled", Interrupted => "interrupted",
});
chat_enum!(ChatFailureKind { Failed => "failed", Cancelled => "cancelled" });

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatImage {
    pub attachment_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    #[serde(default)]
    #[specta(optional)]
    pub response: Option<super::ChatResponseInfo>,
    #[serde(default)]
    #[specta(optional)]
    pub answer: Option<super::ChatAnswer>,
    pub id: String,
    pub turn_id: String,
    pub role: ChatRole,
    pub text: String,
    pub images: Vec<ChatImage>,
    #[serde(default)]
    #[specta(optional)]
    pub context: super::ChatTarget,
    pub status: ChatTurnStatus,
    pub error_message: Option<String>,
    pub ai_run_id: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatSubmissionReceipt {
    pub draft_id: String,
    pub note_id: String,
    pub submitted_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatState {
    pub owner: super::ConversationOwner,
    pub archived: bool,
    pub composer_intent: super::ChatComposerIntent,
    pub last_active_order: i64,
    pub last_active_at: String,
    #[serde(default)]
    #[specta(optional)]
    pub pending_response: Option<super::ChatResponsePurpose>,
    #[serde(default)]
    #[specta(optional)]
    pub proposals: Vec<super::RefinementProposal>,
    pub session_id: String,
    pub draft_id: String,
    pub revision: i32,
    pub composer: String,
    pub composer_images: Vec<ChatImage>,
    pub mode: ChatMode,
    pub messages: Vec<ChatMessage>,
    pub ai_runs: Vec<super::AiRun>,
    pub submission: Option<ChatSubmissionReceipt>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatRevision {
    pub session_id: String,
    pub draft_id: String,
    pub expected_revision: i32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatComposerRequest {
    #[serde(default)]
    pub intent: super::ChatComposerIntent,
    #[serde(default)]
    pub attachment_ids: Vec<String>,
    pub scope: ChatRevision,
    pub composer: String,
    pub mode: ChatMode,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatStartRequest {
    pub scope: ChatRevision,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatAssociateRunRequest {
    pub scope: ChatRevision,
    pub turn_id: String,
    pub ai_run_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatRestartRequest {
    pub scope: ChatRevision,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnStarted {
    pub chat: ChatState,
    pub turn_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatFinishRequest {
    pub scope: ChatRevision,
    pub turn_id: String,
    pub assistant_text: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatFailRequest {
    pub scope: ChatRevision,
    pub turn_id: String,
    pub kind: ChatFailureKind,
    pub error_message: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatSubmitRequest {
    pub scope: ChatRevision,
    pub note_id: String,
    pub expected_note_body: String,
    pub expected_note_body_json: Option<String>,
    pub expected_note_body_format: Option<String>,
}
