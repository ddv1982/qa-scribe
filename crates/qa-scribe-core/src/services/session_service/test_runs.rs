use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::{
    QaScribeError, Result,
    domain::{
        DraftKind, TEST_CASE_REMARK_MAX_LENGTH, TEST_RUN_BODY_JSON_MAX_TOTAL_LENGTH,
        TEST_RUN_MAX_CASES, TITLE_MAX_LENGTH, TestCaseResult, TestRun, TestRunCase,
        TestRunCaseDraft, TestRunSummary, validate_body_json, validate_optional_text,
        validate_required_text,
    },
    error::validation,
};

use super::super::session_rows::to_sql_error;
use super::{
    SessionService, drafts::draft_by_id, new_id, now, require_row_in_session, require_session,
};

const CASE_COLUMNS: &str =
    "id, run_id, position, group_title, title, body_json, result, remark, finding_id, updated_at";

impl SessionService {
    /// Copies `cases` into a new test run of the Test cases draft `draft_id`.
    /// The Session and the draft title come from the stored draft, never from
    /// the caller. Cases keep the given order.
    pub fn start_test_run(&self, draft_id: &str, cases: Vec<TestRunCaseDraft>) -> Result<TestRun> {
        let cases = validate_cases(cases)?;
        let run_id = new_id();
        let now = now();
        self.database.with_immediate_tx(|tx| {
            let draft =
                draft_by_id(tx, draft_id)?.ok_or_else(|| QaScribeError::NotFound(draft_id.to_string()))?;
            if draft.kind != DraftKind::Testware {
                return Err(validation("Only a Test cases draft can start a test run"));
            }
            tx.execute(
                "INSERT INTO test_runs (id, session_id, draft_id, draft_title, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![run_id, draft.session_id, draft.id, draft.title, now],
            )?;
            let mut insert = tx.prepare(
                "INSERT INTO test_run_cases (id, run_id, position, group_title, title, body_json, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?;
            for (position, case) in (0_u32..).zip(&cases) {
                insert.execute(params![
                    new_id(),
                    run_id,
                    position,
                    case.group_title,
                    case.title,
                    case.body_json,
                    now
                ])?;
            }
            test_run(tx, &run_id)
        })
    }

    pub fn get_test_run(&self, run_id: &str) -> Result<TestRun> {
        test_run(self.database.connection(), run_id)
    }

    /// The newest test run of each of the Session's Test cases drafts, with
    /// its cases, newest first. Newest is the order `list_test_runs` uses.
    pub fn latest_test_runs(&self, session_id: &str) -> Result<Vec<TestRun>> {
        let connection = self.database.connection();
        let mut statement = connection.prepare(
            "SELECT r.id FROM test_runs r
             WHERE r.session_id = ?1 AND NOT EXISTS (
                 SELECT 1 FROM test_runs newer
                 WHERE newer.draft_id = r.draft_id
                   AND (newer.created_at > r.created_at
                        OR (newer.created_at = r.created_at AND newer.id > r.id)))
             ORDER BY r.created_at DESC, r.id DESC",
        )?;
        let run_ids = statement
            .query_map([session_id], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        run_ids
            .iter()
            .map(|run_id| test_run(connection, run_id))
            .collect()
    }

    /// The Session's test runs, newest first, with how many cases have each Result.
    pub fn list_test_runs(&self, session_id: &str) -> Result<Vec<TestRunSummary>> {
        let connection = self.database.connection();
        require_session(connection, session_id)?;
        let mut statement = connection.prepare(
            "SELECT r.id, r.session_id, r.draft_id, r.draft_title, r.created_at, r.updated_at,
                    COUNT(c.id),
                    COUNT(CASE WHEN c.result = 'passed' THEN 1 END),
                    COUNT(CASE WHEN c.result = 'failed' THEN 1 END),
                    COUNT(CASE WHEN c.result = 'blocked' THEN 1 END),
                    COUNT(CASE WHEN c.result = 'not_run' THEN 1 END)
             FROM test_runs r
             LEFT JOIN test_run_cases c ON c.run_id = r.id
             WHERE r.session_id = ?1
             GROUP BY r.id
             ORDER BY r.created_at DESC, r.id DESC",
        )?;
        let summaries = statement
            .query_map([session_id], |row| {
                Ok(TestRunSummary {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    draft_id: row.get(2)?,
                    draft_title: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    total: row.get(6)?,
                    passed: row.get(7)?,
                    failed: row.get(8)?,
                    blocked: row.get(9)?,
                    not_run: row.get(10)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(summaries)
    }

    /// Records a Result and replaces the Remark: a blank or absent remark
    /// clears it, also when the Result goes back to not run.
    pub fn set_test_case_result(
        &self,
        case_id: &str,
        result: TestCaseResult,
        remark: Option<String>,
    ) -> Result<TestRunCase> {
        let remark = validate_optional_text("Remark", remark, TEST_CASE_REMARK_MAX_LENGTH)?;
        self.update_case(case_id, |tx, _, now| {
            tx.execute(
                "UPDATE test_run_cases SET result = ?1, remark = ?2, updated_at = ?3 WHERE id = ?4",
                params![result.as_str(), remark, now, case_id],
            )?;
            Ok(())
        })
    }

    /// Links the case to a Finding of the same Session, or unlinks it with `None`.
    pub fn link_test_case_finding(
        &self,
        case_id: &str,
        finding_id: Option<String>,
    ) -> Result<TestRunCase> {
        self.update_case(case_id, |tx, session_id, now| {
            if let Some(finding_id) = &finding_id {
                require_row_in_session(
                    tx,
                    "findings",
                    finding_id,
                    session_id,
                    "Test case Finding must belong to the test run's Session",
                )?;
            }
            tx.execute(
                "UPDATE test_run_cases SET finding_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![finding_id, now, case_id],
            )?;
            Ok(())
        })
    }

    pub fn delete_test_run(&self, run_id: &str) -> Result<()> {
        let changed = self
            .database
            .connection()
            .execute("DELETE FROM test_runs WHERE id = ?1", [run_id])?;
        if changed == 0 {
            return Err(QaScribeError::NotFound(run_id.to_string()));
        }
        Ok(())
    }

    /// Runs `change(tx, session_id, now)` on an existing case and bumps its
    /// run's `updated_at` in the same transaction, then returns the stored case.
    fn update_case(
        &self,
        case_id: &str,
        change: impl FnOnce(&Connection, &str, &str) -> Result<()>,
    ) -> Result<TestRunCase> {
        let now = now();
        self.database.with_immediate_tx(|tx| {
            let (run_id, session_id): (String, String) = tx
                .query_row(
                    "SELECT r.id, r.session_id FROM test_run_cases c
                     JOIN test_runs r ON r.id = c.run_id WHERE c.id = ?1",
                    [case_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?
                .ok_or_else(|| QaScribeError::NotFound(case_id.to_string()))?;
            change(tx, &session_id, &now)?;
            tx.execute(
                "UPDATE test_runs SET updated_at = ?1 WHERE id = ?2",
                params![now, run_id],
            )?;
            Ok(tx.query_row(
                &format!("SELECT {CASE_COLUMNS} FROM test_run_cases WHERE id = ?1"),
                [case_id],
                map_case,
            )?)
        })
    }
}

/// Trims and checks every case the way a draft's title and body JSON are
/// checked, and caps the count and the run's total body JSON size.
fn validate_cases(cases: Vec<TestRunCaseDraft>) -> Result<Vec<TestRunCaseDraft>> {
    if cases.is_empty() {
        return Err(validation("A test run needs at least one test case"));
    }
    if cases.len() > TEST_RUN_MAX_CASES {
        return Err(validation(format!(
            "A test run can have at most {TEST_RUN_MAX_CASES} test cases"
        )));
    }
    let mut total_body_length = 0;
    let cases = cases
        .into_iter()
        .enumerate()
        .map(|(index, case)| {
            let in_case = |error: QaScribeError| match error {
                QaScribeError::Validation(message) => {
                    validation(format!("Test case {}: {message}", index + 1))
                }
                other => other,
            };
            let title =
                validate_required_text("Title", &case.title, TITLE_MAX_LENGTH).map_err(in_case)?;
            let group_title =
                validate_optional_text("Group title", case.group_title, TITLE_MAX_LENGTH)
                    .map_err(in_case)?;
            let body_json = validate_body_json(Some(case.body_json))
                .map_err(in_case)?
                .ok_or_else(|| in_case(validation("rich body JSON is required")))?;
            total_body_length += body_json.chars().count();
            Ok(TestRunCaseDraft {
                group_title,
                title,
                body_json,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    if total_body_length > TEST_RUN_BODY_JSON_MAX_TOTAL_LENGTH {
        return Err(validation(format!(
            "A test run's test cases must be at most {TEST_RUN_BODY_JSON_MAX_TOTAL_LENGTH} characters of rich body JSON in total"
        )));
    }
    Ok(cases)
}

fn test_run(connection: &Connection, run_id: &str) -> Result<TestRun> {
    let mut run = connection
        .query_row(
            "SELECT id, session_id, draft_id, draft_title, created_at, updated_at
             FROM test_runs WHERE id = ?1",
            [run_id],
            |row| {
                Ok(TestRun {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    draft_id: row.get(2)?,
                    draft_title: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    cases: Vec::new(),
                })
            },
        )
        .optional()?
        .ok_or_else(|| QaScribeError::NotFound(run_id.to_string()))?;
    let mut statement = connection.prepare(&format!(
        "SELECT {CASE_COLUMNS} FROM test_run_cases WHERE run_id = ?1 ORDER BY position"
    ))?;
    run.cases = statement
        .query_map([run_id], map_case)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(run)
}

fn map_case(row: &Row<'_>) -> rusqlite::Result<TestRunCase> {
    let result: String = row.get(6)?;
    Ok(TestRunCase {
        id: row.get(0)?,
        run_id: row.get(1)?,
        position: row.get(2)?,
        group_title: row.get(3)?,
        title: row.get(4)?,
        body_json: row.get(5)?,
        result: TestCaseResult::from_stored(&result).map_err(to_sql_error)?,
        remark: row.get(7)?,
        finding_id: row.get(8)?,
        updated_at: row.get(9)?,
    })
}
