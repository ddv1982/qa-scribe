use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChatTarget {
    #[default]
    Session,
    Finding {
        snapshot: RecordContextSnapshot,
    },
    TestCasesDraft {
        snapshot: RecordContextSnapshot,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum RecordSnapshotOrigin {
    Saved,
    UnsavedEditor,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordContextSnapshot {
    pub session_id: String,
    pub record_id: String,
    pub title: String,
    pub document_json: String,
    pub metadata_json: Option<String>,
    pub record_kind: String,
    pub origin: RecordSnapshotOrigin,
    #[serde(default)]
    pub local_fingerprint: String,
    #[serde(default)]
    pub stored_base_token: String,
}

impl ChatTarget {
    pub fn snapshot(&self) -> Option<&RecordContextSnapshot> {
        match self {
            Self::Session => None,
            Self::Finding { snapshot } | Self::TestCasesDraft { snapshot } => Some(snapshot),
        }
    }

    pub fn label(&self) -> String {
        match self {
            Self::Session => "Session context".into(),
            Self::Finding { snapshot } | Self::TestCasesDraft { snapshot } => format!(
                "{} context: {} ({})",
                if matches!(self, Self::Finding { .. }) {
                    "Finding"
                } else {
                    "Test cases"
                },
                snapshot.title,
                match snapshot.origin {
                    RecordSnapshotOrigin::Saved => "saved snapshot",
                    RecordSnapshotOrigin::UnsavedEditor => "unsaved editor snapshot",
                }
            ),
        }
    }
}
