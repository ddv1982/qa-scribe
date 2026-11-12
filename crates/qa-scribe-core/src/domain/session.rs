use serde::{Deserialize, Deserializer, Serialize};

use super::Entry;

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
    /// Session sheet: the planned length of the Session, in minutes.
    pub timebox_minutes: Option<i64>,
    /// Session sheet: what the tester covered, what is left, what got in the way.
    pub debrief_notes: Option<String>,
    /// Session sheet: the debrief time split. All three are set or none is.
    pub testing_percent: Option<i64>,
    pub bug_percent: Option<i64>,
    pub setup_percent: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionNoteState {
    pub session: Session,
    pub note_entry: Entry,
    pub testware_draft_count: i64,
    pub finding_count: i64,
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
/// (generated `field?:`): an absent field means "no change".
///
/// Two distinct null contracts, made explicit in the generated TypeScript:
/// - `title` is required on a Session and cannot be cleared, so it is typed
///   `title?: string` (`#[specta(type = String)]` drops the `| null`): the
///   frontend can only set it or omit it, never send `null`. This kills the
///   prior defect where a `title: null` silently no-oped.
/// - the `Option<Option<_>>` fields are clearable: absent = no change,
///   `null` = clear to NULL, a value = set. specta renders them
///   `field?: string | null` (or `number | null`), matching that three-state
///   contract. `clearable` keeps an explicit `null` apart from an absent
///   field; that custom deserializer is why the bindings show a
///   `SessionPatch_Deserialize` phase.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionPatch {
    #[specta(optional, type = String)]
    pub title: Option<String>,
    #[specta(optional, type = Option<String>)]
    #[serde(default, deserialize_with = "clearable")]
    pub session_context: Option<Option<String>>,
    #[specta(optional, type = Option<String>)]
    #[serde(default, deserialize_with = "clearable")]
    pub objective_notes: Option<Option<String>>,
    #[specta(optional, type = Option<String>)]
    #[serde(default, deserialize_with = "clearable")]
    pub environment: Option<Option<String>>,
    #[specta(optional, type = Option<String>)]
    #[serde(default, deserialize_with = "clearable")]
    pub build_version: Option<Option<String>>,
    #[specta(optional, type = Option<String>)]
    #[serde(default, deserialize_with = "clearable")]
    pub related_reference: Option<Option<String>>,
    #[specta(optional, type = Option<i64>)]
    #[serde(default, deserialize_with = "clearable")]
    pub timebox_minutes: Option<Option<i64>>,
    #[specta(optional, type = Option<String>)]
    #[serde(default, deserialize_with = "clearable")]
    pub debrief_notes: Option<Option<String>>,
    #[specta(optional, type = Option<i64>)]
    #[serde(default, deserialize_with = "clearable")]
    pub testing_percent: Option<Option<i64>>,
    #[specta(optional, type = Option<i64>)]
    #[serde(default, deserialize_with = "clearable")]
    pub bug_percent: Option<Option<i64>>,
    #[specta(optional, type = Option<i64>)]
    #[serde(default, deserialize_with = "clearable")]
    pub setup_percent: Option<Option<i64>>,
}

/// Deserializes a present field into `Some`, so an explicit JSON `null`
/// becomes `Some(None)` ("clear") instead of collapsing into `None`
/// ("no change"), which is what serde does for a bare `Option<Option<T>>`.
fn clearable<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[cfg(test)]
mod tests {
    use super::SessionPatch;

    #[test]
    fn patch_distinguishes_absent_null_and_value() {
        let patch: SessionPatch = serde_json::from_str(
            r#"{"objectiveNotes":null,"timeboxMinutes":45,"debriefNotes":"Done"}"#,
        )
        .expect("patch should deserialize");
        assert_eq!(patch.objective_notes, Some(None));
        assert_eq!(patch.timebox_minutes, Some(Some(45)));
        assert_eq!(patch.debrief_notes, Some(Some("Done".to_string())));
        assert_eq!(patch.related_reference, None);
        assert_eq!(patch.testing_percent, None);
    }
}
