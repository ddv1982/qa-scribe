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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[specta(optional)]
    pub capture_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TestRunSuggestionRequest {
    pub reference: super::ChatRef,
    pub suggestion_id: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TestRunSuggestionsRequest {
    pub reference: super::ChatRef,
    pub assistant_message_id: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum TestRunSuggestionOutcome {
    Saved {
        #[serde(skip_serializing_if = "Option::is_none")]
        #[specta(optional)]
        log_evidence: Option<Vec<super::LogEvidenceSummary>>,
        test_case: Box<super::TestRunCase>,
        suggestion: TestRunSuggestion,
    },
    OutOfDate {
        test_case: Box<super::TestRunCase>,
        suggestion: TestRunSuggestion,
    },
    Failed {
        case_id: String,
        message: String,
    },
}
