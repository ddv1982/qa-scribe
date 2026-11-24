use std::collections::BTreeMap;

use rusqlite::{Connection, OptionalExtension, Row, params};
use sha2::{Digest, Sha256};

use super::{SessionService, TestRunChatSnapshot, new_id};
use crate::{Result, chat::test_run::SuggestionDraft, domain::*, error::validation};

pub(super) fn fingerprint(result: &str, notes_json: Option<&str>, remark: Option<&str>) -> String {
    let bytes = serde_json::to_vec(&(result, notes_json, remark)).expect("serializable fields");
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn capture_sources(
    connection: &Connection,
    owner: &ConversationOwner,
    message_id: &str,
    turn_id: &str,
) -> Result<()> {
    let ConversationOwner::TestRun { run_id, .. } = owner else {
        return Ok(());
    };
    let mut select = connection
        .prepare("SELECT id, result, notes_json, remark FROM test_run_cases WHERE run_id = ?1")?;
    let cases = select.query_map([run_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;
    let mut insert = connection.prepare("INSERT INTO chat_test_run_sources (message_id, turn_id, case_id, fingerprint) VALUES (?1, ?2, ?3, ?4)")?;
    for case in cases {
        let (id, result, notes, remark) = case?;
        insert.execute(params![
            message_id,
            turn_id,
            id,
            fingerprint(&result, notes.as_deref(), remark.as_deref())
        ])?;
    }
    Ok(())
}

impl SessionService {
    pub fn focused_test_run_case(&self, user: &ChatMessage) -> Result<Option<String>> {
        Ok(self.database.connection().query_row(
            "SELECT case_id FROM chat_test_run_sources WHERE message_id = ?1 AND turn_id = ?2 AND focused = 1",
            params![user.id, user.turn_id],
            |row| row.get(0),
        ).optional()?)
    }

    pub fn bind_test_run_turn_snapshot(
        &self,
        user: &ChatMessage,
        snapshot: &TestRunChatSnapshot,
    ) -> Result<()> {
        self.database.with_immediate_tx(|tx| {
            if sources(tx, user)? != snapshot.sources {
                return Err(validation("The test run changed while Ask AI was preparing. Try again."));
            }
            if let Some(case_id) = &snapshot.focused_case_id {
                tx.execute(
                    "UPDATE chat_test_run_sources SET focused = 1 WHERE message_id = ?1 AND turn_id = ?2 AND case_id = ?3",
                    params![user.id, user.turn_id, case_id],
                )?;
            }
            Ok(())
        })
    }
}

fn sources(connection: &Connection, user: &ChatMessage) -> Result<BTreeMap<String, String>> {
    Ok(connection
        .prepare("SELECT case_id, fingerprint FROM chat_test_run_sources WHERE message_id = ?1 AND turn_id = ?2")?
        .query_map(params![user.id, user.turn_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?)
}

pub(super) fn validate_cases(
    connection: &Connection,
    user: &ChatMessage,
    drafts: &[SuggestionDraft],
) -> Result<()> {
    if !drafts.is_empty() {
        let cases = sources(connection, user)?;
        if drafts
            .iter()
            .any(|draft| !cases.contains_key(&draft.case_id))
        {
            return Err(validation(
                "A suggested case does not belong to this test run",
            ));
        }
        for id in drafts.iter().flat_map(|draft| &draft.capture_ids) {
            let belongs: bool = connection.query_row(
                "SELECT EXISTS (SELECT 1 FROM test_run_log_captures c
                 JOIN chat_log_capture_shares share ON share.capture_id = c.id
                 JOIN chat_messages u ON u.id = ?1 AND u.draft_id = c.conversation_id
                 JOIN ai_runs a ON a.id = u.ai_run_id AND a.provider = share.provider
                 WHERE c.id = ?2 AND c.origin = 'ask_ai')",
                params![user.id, id],
                |row| row.get(0),
            )?;
            if !belongs {
                return Err(validation(
                    "A suggested log capture was not shared in this conversation",
                ));
            }
        }
    }
    Ok(())
}

pub(super) fn insert(
    connection: &Connection,
    chat_id: &str,
    user: &ChatMessage,
    drafts: Vec<SuggestionDraft>,
) -> Result<()> {
    if drafts.is_empty() {
        return Ok(());
    }
    let cases = sources(connection, user)?;
    let assistant_id: String = connection.query_row(
        "SELECT id FROM chat_messages WHERE draft_id = ?1 AND turn_id = ?2 AND role = 'assistant'",
        params![chat_id, user.turn_id],
        |row| row.get(0),
    )?;
    let mut insert = connection.prepare(
        "INSERT INTO chat_test_run_suggestions (id, assistant_message_id, case_id, result, notes_json, rationale, base_fingerprint, has_log_evidence)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
    )?;
    for draft in drafts {
        let suggestion_id = new_id();
        insert.execute(params![
            suggestion_id,
            assistant_id,
            draft.case_id,
            draft.result.map(TestCaseResult::as_str),
            draft.notes_json,
            draft.rationale,
            cases.get(&draft.case_id),
            !draft.capture_ids.is_empty(),
        ])?;
        for capture_id in &draft.capture_ids {
            connection.execute(
                "INSERT INTO chat_suggestion_log_captures (suggestion_id, capture_id) VALUES (?1, ?2)",
                params![suggestion_id, capture_id],
            )?;
        }
    }
    Ok(())
}

pub(super) const SUGGESTION_COLUMNS: &str = "s.id, s.assistant_message_id, s.case_id, s.result, s.notes_json, s.rationale, s.base_fingerprint, s.applied_fingerprint,
    (SELECT json_group_array(capture_id) FROM (
      SELECT capture_id FROM chat_suggestion_log_captures WHERE suggestion_id = s.id ORDER BY capture_id
    ))";

pub(super) fn read(connection: &Connection, chat_id: &str) -> Result<Vec<TestRunSuggestion>> {
    Ok(connection
        .prepare(&format!(
            "SELECT {SUGGESTION_COLUMNS}
         FROM chat_messages a JOIN chat_test_run_suggestions s ON s.assistant_message_id = a.id
         JOIN test_run_cases c ON c.id = s.case_id
         WHERE a.draft_id = ?1 ORDER BY a.created_at, a.id, c.position"
        ))?
        .query_map([chat_id], map_suggestion)?
        .collect::<rusqlite::Result<_>>()?)
}

pub(super) fn map_suggestion(row: &Row<'_>) -> rusqlite::Result<TestRunSuggestion> {
    let result: Option<String> = row.get(3)?;
    Ok(TestRunSuggestion {
        id: row.get(0)?,
        assistant_message_id: row.get(1)?,
        case_id: row.get(2)?,
        result: result
            .as_deref()
            .map(TestCaseResult::from_stored)
            .transpose()
            .map_err(super::super::session_rows::to_sql_error)?,
        notes_json: row.get(4)?,
        rationale: row.get(5)?,
        base_fingerprint: row.get(6)?,
        applied_fingerprint: row.get(7)?,
        capture_ids: serde_json::from_str(&row.get::<_, String>(8)?).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                8,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
    })
}
