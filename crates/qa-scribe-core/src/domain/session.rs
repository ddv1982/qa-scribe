use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: String,
    pub session_context: Option<String>,
    pub objective_notes: Option<String>,
    pub environment: Option<String>,
    pub build_version: Option<String>,
    pub related_reference: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDraft {
    pub title: String,
    pub session_context: Option<String>,
    pub objective_notes: Option<String>,
    pub environment: Option<String>,
    pub build_version: Option<String>,
    pub related_reference: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPatch {
    pub title: Option<String>,
    pub session_context: Option<Option<String>>,
    pub objective_notes: Option<Option<String>>,
    pub environment: Option<Option<String>>,
    pub build_version: Option<Option<String>>,
    pub related_reference: Option<Option<String>>,
}
