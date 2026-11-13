use serde::{Deserialize, Serialize};

use super::RICH_BODY_JSON_MAX_LENGTH;
use crate::{QaScribeError, Result};

/// Most test cases one test run can copy. Far above what a Test cases draft
/// holds in practice, and low enough that one run stays a single quick write.
pub const TEST_RUN_MAX_CASES: usize = 500;

/// Most characters of rich body JSON, summed over all cases, one test run can
/// copy. A run copies the cases of one draft, whose body JSON is capped at
/// [`RICH_BODY_JSON_MAX_LENGTH`]; splitting it only wraps each case in its own
/// document, so twice that cap leaves room for the wrappers and for
/// re-serialization while still bounding a run to about a megabyte.
pub const TEST_RUN_BODY_JSON_MAX_TOTAL_LENGTH: usize = 2 * RICH_BODY_JSON_MAX_LENGTH;

/// Maximum length for a test case's Remark.
pub const TEST_CASE_REMARK_MAX_LENGTH: usize = 500;

/// The Result a tester records for one test case in a test run.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum TestCaseResult {
    NotRun,
    Passed,
    Failed,
    Blocked,
}

impl TestCaseResult {
    pub fn as_str(self) -> &'static str {
        match self {
            TestCaseResult::NotRun => "not_run",
            TestCaseResult::Passed => "passed",
            TestCaseResult::Failed => "failed",
            TestCaseResult::Blocked => "blocked",
        }
    }

    pub fn from_stored(value: &str) -> Result<Self> {
        match value {
            "not_run" => Ok(TestCaseResult::NotRun),
            "passed" => Ok(TestCaseResult::Passed),
            "failed" => Ok(TestCaseResult::Failed),
            "blocked" => Ok(TestCaseResult::Blocked),
            _ => Err(QaScribeError::InvalidStoredValue {
                field: "test_run_case.result",
                value: value.to_string(),
            }),
        }
    }
}

/// One copied test case of a test run. Its group title, title and body never
/// change after the run starts.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TestRunCase {
    pub id: String,
    pub run_id: String,
    pub position: u32,
    pub group_title: Option<String>,
    pub title: String,
    /// The case's content as a TipTap document JSON.
    pub body_json: String,
    pub result: TestCaseResult,
    pub remark: Option<String>,
    pub finding_id: Option<String>,
    /// The linked Finding's current title, read with the case and never
    /// stored on it. `None` without a linked Finding.
    pub finding_title: Option<String>,
    pub updated_at: String,
}

/// A frozen copy of a saved Test cases draft's test cases (ADR 0012).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TestRun {
    pub id: String,
    pub session_id: String,
    pub draft_id: String,
    /// The draft's title when the run started.
    pub draft_title: String,
    pub created_at: String,
    /// Changes whenever a case of the run changes.
    pub updated_at: String,
    /// Ordered by position.
    pub cases: Vec<TestRunCase>,
}

/// A test run without its cases, with how many cases have each Result.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TestRunSummary {
    pub id: String,
    pub session_id: String,
    pub draft_id: String,
    pub draft_title: String,
    pub created_at: String,
    pub updated_at: String,
    pub total: u32,
    pub passed: u32,
    pub failed: u32,
    pub blocked: u32,
    pub not_run: u32,
}

/// One test case to copy when a test run starts, as the frontend split it.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TestRunCaseDraft {
    #[specta(optional)]
    pub group_title: Option<String>,
    pub title: String,
    /// The case's content as a TipTap document JSON.
    pub body_json: String,
}
