//! A test run as plain text, for the read-only conversation the run owns. Its
//! sections and labels follow `frontend/src/testware/testRunReport.ts`, the
//! report the tester copies; change both together.

use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension};

use super::{SessionService, test_runs::test_run};
use crate::{
    Result,
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

impl SessionService {
    /// The report of the stored test run `run_id` of the Session, with its
    /// current results. Fails when the run no longer exists.
    pub fn test_run_report(&self, session_id: &str, run_id: &str) -> Result<String> {
        let connection = self.database.connection();
        require_run(connection, session_id, run_id)?;
        let run = test_run(connection, run_id)?;
        Ok(report(&run, &finding_titles(connection, &run)?))
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

// After the finding_title change lands, read case.finding_title instead.
fn finding_titles(connection: &Connection, run: &TestRun) -> Result<HashMap<String, String>> {
    let mut titles = HashMap::new();
    let mut statement =
        connection.prepare("SELECT title FROM findings WHERE id = ?1 AND session_id = ?2")?;
    for id in run.cases.iter().filter_map(|case| case.finding_id.as_ref()) {
        if let Some(title) = statement
            .query_row([id, &run.session_id], |row| row.get::<_, String>(0))
            .optional()?
        {
            titles.insert(id.clone(), title);
        }
    }
    Ok(titles)
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
fn report(run: &TestRun, finding_titles: &HashMap<String, String>) -> String {
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
        let mut lines = vec![format!("- {}: {}", label(case.result), case.title)];
        if let Some(remark) = case.remark.as_deref().filter(|remark| !remark.is_empty()) {
            lines.push(format!("  Remark: {remark}"));
        }
        if let Some(title) = case
            .finding_id
            .as_ref()
            .and_then(|id| finding_titles.get(id))
        {
            lines.push(format!("  Finding: {title}"));
        }
        lines
    };
    let mut groups: Vec<(&str, Vec<&TestRunCase>)> = Vec::new();
    let mut ungrouped = Vec::new();
    for case in &run.cases {
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
    sections.join("\n\n")
}
