use rusqlite::{Connection, OptionalExtension, params};

use crate::{
    QaScribeError, Result,
    domain::{
        ApplicationLogSource, LogEvidenceDetails, LogEvidenceSummary, QueriedApplicationLogs,
        ValidatedApplicationLogQuery,
    },
    error::validation,
};

use super::{SessionService, new_id, now};

impl SessionService {
    pub fn require_log_evidence_capacity(&self, case_id: &str) -> Result<()> {
        evidence_owner(self.database.connection(), case_id)?;
        require_capacity(self.database.connection(), case_id)
    }

    pub fn attach_application_logs(
        &self,
        case_id: &str,
        query: ValidatedApplicationLogQuery,
        output: QueriedApplicationLogs,
    ) -> Result<LogEvidenceSummary> {
        let id = new_id();
        let executed_at = now();
        let sources_json = serde_json::to_string(&[&query.target])
            .map_err(|_| validation("Could not record the log query sources."))?;
        self.database.with_immediate_tx(|tx| {
            let (run_id, session_id) = evidence_owner(tx, case_id)?;
            require_capacity(tx, case_id)?;
            tx.execute(
                "INSERT INTO test_run_log_captures
                (id, session_id, run_id, origin, sources_json, kql, starts_at, ends_at,
                 executed_at, row_count, truncated, result_json, portal_url, case_id)
                 VALUES (?1, ?2, ?3, 'tester', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    id,
                    session_id,
                    run_id,
                    sources_json,
                    query.kql,
                    query.start,
                    query.end,
                    executed_at,
                    output.row_count,
                    output.truncated,
                    output.result_json,
                    output.portal_url,
                    case_id
                ],
            )?;
            Ok(LogEvidenceSummary {
                id,
                case_id: case_id.to_owned(),
                source_labels: vec![query.target.label],
                start: query.start,
                end: query.end,
                executed_at,
                row_count: output.row_count,
                truncated: output.truncated,
                portal_url: output.portal_url,
            })
        })
    }

    pub fn application_log_details(&self, case_id: &str, id: &str) -> Result<LogEvidenceDetails> {
        self.database
            .connection()
            .query_row(
                "SELECT kql, result_json FROM test_run_log_captures WHERE case_id = ?1 AND id = ?2",
                [case_id, id],
                |row| {
                    Ok(LogEvidenceDetails {
                        kql: row.get(0)?,
                        result_json: row.get(1)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| QaScribeError::NotFound(id.to_owned()))
    }

    pub fn detach_application_logs(&self, case_id: &str, id: &str) -> Result<()> {
        let updated = self.database.connection().execute(
            "UPDATE test_run_log_captures SET case_id = NULL WHERE case_id = ?1 AND id = ?2",
            [case_id, id],
        )?;
        if updated == 0 {
            return Err(QaScribeError::NotFound(id.to_owned()));
        }
        Ok(())
    }

    pub fn recent_application_log_queries(
        &self,
        case_id: &str,
        source_id: &str,
    ) -> Result<Vec<String>> {
        let connection = self.database.connection();
        let (_, session_id) = evidence_owner(connection, case_id)?;
        let mut statement = connection.prepare(
            "SELECT c.kql FROM test_run_log_captures c
             WHERE c.session_id = ?1 AND c.origin = 'tester'
               AND EXISTS (SELECT 1 FROM json_each(c.sources_json)
                           WHERE json_extract(value, '$.resourceId') = ?2 COLLATE NOCASE)
             GROUP BY c.kql ORDER BY MAX(c.executed_at) DESC, c.kql LIMIT 5",
        )?;
        Ok(statement
            .query_map([session_id.as_str(), source_id], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?)
    }
}

fn evidence_owner(connection: &Connection, case_id: &str) -> Result<(String, String)> {
    connection
        .query_row(
            "SELECT r.id, r.session_id FROM test_run_cases c JOIN test_runs r ON r.id = c.run_id
         WHERE c.id = ?1",
            [case_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| QaScribeError::NotFound(case_id.to_owned()))
}

fn require_capacity(connection: &Connection, case_id: &str) -> Result<()> {
    let count: u32 = connection.query_row(
        "SELECT COUNT(*) FROM test_run_log_captures WHERE case_id = ?1",
        [case_id],
        |row| row.get(0),
    )?;
    if count >= 10 {
        return Err(validation(
            "At most 10 log captures can be attached to a test case.",
        ));
    }
    Ok(())
}

pub(super) fn attached_log_evidence(
    connection: &Connection,
    run_id: &str,
) -> Result<Vec<LogEvidenceSummary>> {
    let mut statement = connection.prepare(
        "SELECT id, case_id, sources_json, starts_at, ends_at, executed_at, row_count, truncated, portal_url
         FROM test_run_log_captures WHERE run_id = ?1 AND case_id IS NOT NULL
         ORDER BY executed_at, id",
    )?;
    Ok(statement
        .query_map([run_id], |row| {
            let sources: String = row.get(2)?;
            let sources: Vec<ApplicationLogSource> =
                serde_json::from_str(&sources).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        2,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?;
            Ok(LogEvidenceSummary {
                id: row.get(0)?,
                case_id: row.get(1)?,
                source_labels: sources.into_iter().map(|source| source.label).collect(),
                start: row.get(3)?,
                end: row.get(4)?,
                executed_at: row.get(5)?,
                row_count: row.get(6)?,
                truncated: row.get(7)?,
                portal_url: row.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}
