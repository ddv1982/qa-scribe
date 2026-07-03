use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
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

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionDraft {
    pub title: String,
    // Optional inputs: serde already treats a missing `Option` field as `None`,
    // so `#[specta(optional)]` describes that in the generated type (`field?:`)
    // to match the historical hand-written contract.
    #[specta(optional)]
    pub session_context: Option<String>,
    #[specta(optional)]
    pub objective_notes: Option<String>,
    #[specta(optional)]
    pub environment: Option<String>,
    #[specta(optional)]
    pub build_version: Option<String>,
    #[specta(optional)]
    pub related_reference: Option<String>,
}

/// Partial update for a `Session`. Every field is optional on the wire
/// (`#[serde(default, skip_serializing_if)]` → generated `field?:`): an absent
/// field means "no change".
///
/// Two distinct null contracts, made explicit in the generated TypeScript:
/// - `title` is required on a Session and cannot be cleared, so it is typed
///   `title?: string` (`#[specta(type = String)]` drops the `| null`): the
///   frontend can only set it or omit it, never send `null`. This kills the
///   prior defect where a `title: null` silently no-oped.
/// - the `Option<Option<String>>` fields are clearable: absent = no change,
///   `null` = clear to NULL, a string = set. specta renders them
///   `field?: string | null`, matching that three-state contract.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionPatch {
    #[specta(optional, type = String)]
    pub title: Option<String>,
    #[specta(optional)]
    pub session_context: Option<Option<String>>,
    #[specta(optional)]
    pub objective_notes: Option<Option<String>>,
    #[specta(optional)]
    pub environment: Option<Option<String>>,
    #[specta(optional)]
    pub build_version: Option<Option<String>>,
    #[specta(optional)]
    pub related_reference: Option<Option<String>>,
}
