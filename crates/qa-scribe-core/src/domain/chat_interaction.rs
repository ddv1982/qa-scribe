use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ChatRequestIntent {
    Message,
    RefineRecord,
    SuggestEdit {
        #[serde(rename = "assistantMessageId")]
        assistant_message_id: Option<String>,
    },
    DraftJira,
    QuestionReply {
        #[serde(rename = "assistantMessageId")]
        assistant_message_id: String,
        text: String,
    },
    Retry,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ChatResponsePurpose {
    Conversation,
    Refinement {
        #[serde(rename = "recordKind")]
        record_kind: super::RefinementRecordKind,
    },
    JiraDrafting,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatQuestion {
    pub prompt: String,
    pub choices: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponseInfo {
    pub source_user_message_id: String,
    pub purpose: ChatResponsePurpose,
    pub question: Option<ChatQuestion>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub local_edit: bool,
    pub warning: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatAnswer {
    pub assistant_message_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(untagged)]
pub enum ChatResponseContract {
    Current(ChatResponseContractV2),
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatResponseContractV2 {
    pub version: u8,
    pub request_id: String,
    pub purpose: ChatResponsePurpose,
    /// Fingerprint of the saved Note content used for the suggestion.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_source: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub local_edit: bool,
}
impl ChatResponseContract {
    pub fn local_edit(&self) -> bool {
        let Self::Current(contract) = self;
        contract.local_edit
    }

    pub fn request_id(&self) -> &str {
        match self {
            Self::Current(c) => &c.request_id,
        }
    }
    pub fn version(&self) -> u8 {
        match self {
            Self::Current(c) => c.version,
        }
    }
    pub fn purpose(&self) -> ChatResponsePurpose {
        match self {
            Self::Current(c) => c.purpose.clone(),
        }
    }
}

impl<'de> Deserialize<'de> for ChatResponseContract {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        match value.get("version").and_then(serde_json::Value::as_u64) {
            Some(2 | 3) => serde_json::from_value(value).map(Self::Current),
            _ => {
                return Err(serde::de::Error::custom(
                    "Unsupported response contract version",
                ));
            }
        }
        .map_err(serde::de::Error::custom)
    }
}
