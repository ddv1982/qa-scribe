use serde::{Deserialize, Serialize};

use super::TestCaseResult;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TestRunSuggestion {
    pub id: String,
    pub assistant_message_id: String,
    pub case_id: String,
    pub result: Option<TestCaseResult>,
    pub notes_json: Option<String>,
    pub rationale: String,
    pub base_fingerprint: String,
    pub applied_fingerprint: Option<String>,
}
