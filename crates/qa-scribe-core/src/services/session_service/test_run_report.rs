//! Saved test run context for Ask AI.

use std::collections::BTreeMap;

use rusqlite::{Connection, OptionalExtension};

use super::{SessionService, test_runs::test_run};
use crate::{
    Result,
    chat::{MAX_CHAT_TEST_RUN_REPORT_BYTES, test_run::bound_report},
    domain::{ChatState, ConversationOwner, TestCaseResult, TestRun, TestRunCase},
    error::validation,
};

/// Every Result once, in the order the totals line names them.
const RESULT_ORDER: [TestCaseResult; 4] = [
    TestCaseResult::Passed,
    TestCaseResult::Failed,
    TestCaseResult::Blocked,
    TestCaseResult::NotRun,
];

#[derive(PartialEq, Eq)]
pub struct TestRunChatSnapshot {
    pub report: String,
    pub sources: BTreeMap<String, String>,
}

impl SessionService {
    /// The report of the stored test run `run_id` of the Session, with its
    /// current results. Fails when the run no longer exists.
    pub fn test_run_report(&self, session_id: &str, run_id: &str) -> Result<String> {
        self.test_run_report_for_case(session_id, run_id, None)
    }

    pub fn test_run_report_for_case(
        &self,
        session_id: &str,
        run_id: &str,
        case_id: Option<&str>,
    ) -> Result<String> {
        self.test_run_chat_snapshot(session_id, run_id, case_id)
            .map(|snapshot| snapshot.report)
    }

    pub fn test_run_chat_snapshot(
        &self,
        session_id: &str,
        run_id: &str,
        case_id: Option<&str>,
    ) -> Result<TestRunChatSnapshot> {
        self.database.with_immediate_tx(|tx| {
            require_run(tx, session_id, run_id)?;
            let run = test_run(tx, run_id)?;
            let report = report(&run, case_id)?;
            let sources = run
                .cases
                .into_iter()
                .map(|case| (case.id, case.suggestion_fingerprint))
                .collect();
            Ok(TestRunChatSnapshot { report, sources })
        })
    }
}

/// Fails unless `run_id` is a stored test run of the Session.
pub(super) fn require_run(connection: &Connection, session_id: &str, run_id: &str) -> Result<()> {
    let owner: Option<String> = connection
        .query_row(
            "SELECT session_id FROM test_runs WHERE id = ?1",
            [run_id],
            |row| row.get(0),
        )
        .optional()?;
    match owner {
        Some(owner) if owner == session_id => Ok(()),
        Some(_) => Err(validation("The test run must belong to the Session")),
        None => Err(validation("This test run no longer exists.")),
    }
}

/// Fails when the conversation belongs to a test run that no longer exists.
pub(super) fn require_owner_run(connection: &Connection, chat: &ChatState) -> Result<()> {
    match &chat.owner {
        ConversationOwner::TestRun { session_id, run_id } => {
            require_run(connection, session_id, run_id)
        }
        _ => Ok(()),
    }
}

fn label(result: TestCaseResult) -> &'static str {
    match result {
        TestCaseResult::Passed => "Passed",
        TestCaseResult::Failed => "Failed",
        TestCaseResult::Blocked => "Blocked",
        TestCaseResult::NotRun => "Not run",
    }
}

/// When the run started, in UTC; the stored text when it does not parse.
fn started(created_at: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(created_at).map_or_else(
        |_| created_at.to_string(),
        |time| {
            time.with_timezone(&chrono::Utc)
                .format("%Y-%m-%d %H:%M UTC")
                .to_string()
        },
    )
}

/// The title, start, totals and every case with its Result, Remark and linked
/// Finding title. Cases without a group come first; the others follow under
/// their group title in the order the groups first appear.
fn report(run: &TestRun, focused_id: Option<&str>) -> Result<String> {
    let totals = RESULT_ORDER
        .iter()
        .map(|result| {
            let count = run
                .cases
                .iter()
                .filter(|case| case.result == *result)
                .count();
            format!("{count} {}", label(*result).to_lowercase())
        })
        .collect::<Vec<_>>()
        .join(", ");
    let case_lines = |case: &TestRunCase| {
        let mut lines = vec![format!(
            "- {}: {} (TC {} [{}])",
            label(case.result),
            case.title,
            case.position + 1,
            case.id
        )];
        if let Some(notes) = &case.notes {
            if !notes.text.is_empty() {
                lines.push("  Result notes:".into());
                lines.extend(notes.text.split('\n').map(|line| format!("    {line}")));
            }
            if notes.image_count > 0 {
                let label = if notes.image_count == 1 {
                    "image"
                } else {
                    "images"
                };
                lines.push(format!("  Evidence: {} {label}", notes.image_count));
            }
        } else if let Some(remark) = case.remark.as_deref().filter(|remark| !remark.is_empty()) {
            lines.push(format!("  Remark: {remark}"));
        }
        if let Some(title) = &case.finding_title {
            lines.push(format!("  Finding: {title}"));
        }
        lines
    };
    let mut groups: Vec<(&str, Vec<&TestRunCase>)> = Vec::new();
    let mut ungrouped = Vec::new();
    let focused = focused_id
        .map(|id| {
            run.cases.iter().find(|case| case.id == id).ok_or_else(|| {
                validation("The focused test case does not belong to this test run.")
            })
        })
        .transpose()?;
    for case in run
        .cases
        .iter()
        .filter(|case| Some(case.id.as_str()) != focused_id)
    {
        match case
            .group_title
            .as_deref()
            .filter(|group| !group.is_empty())
        {
            None => ungrouped.push(case),
            Some(group) => match groups.iter_mut().find(|(title, _)| *title == group) {
                Some((_, cases)) => cases.push(case),
                None => groups.push((group, vec![case])),
            },
        }
    }
    let mut sections = vec![
        format!(
            "## Test run: {}\n{}",
            run.draft_title,
            started(&run.created_at)
        ),
        totals,
    ];
    if !ungrouped.is_empty() {
        sections.push(
            ungrouped
                .into_iter()
                .flat_map(case_lines)
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }
    for (group, cases) in groups {
        let mut lines = vec![format!("### {group}")];
        lines.extend(cases.into_iter().flat_map(case_lines));
        sections.push(lines.join("\n"));
    }
    let rest = sections.join("\n\n");
    let Some(case) = focused else {
        return Ok(bound_report(&rest, MAX_CHAT_TEST_RUN_REPORT_BYTES));
    };
    let instructions = super::test_run_notes::project_body(&case.body_json)?;
    let focused = format!(
        "## Focused test case\n{}\n  Case instructions (including steps and expected results):\n{}\n\n",
        case_lines(case).join("\n"),
        instructions
    );
    const FOCUSED_CASE_BYTES: usize = MAX_CHAT_TEST_RUN_REPORT_BYTES / 2;
    if focused.len() > FOCUSED_CASE_BYTES {
        return Err(validation(
            "The focused test case is too long to send to Ask AI. Open Ask AI for the whole test run or shorten its Result notes.",
        ));
    }
    let rest = bound_report(&rest, MAX_CHAT_TEST_RUN_REPORT_BYTES - focused.len());
    Ok(focused + &rest)
}
