use std::collections::BTreeMap;

use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};

use super::{SessionService, new_id};
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
    pub fn test_run_turn_sources(&self, user: &ChatMessage) -> Result<BTreeMap<String, String>> {
        sources(self.database.connection(), user)
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
        "INSERT INTO chat_test_run_suggestions (id, assistant_message_id, case_id, result, notes_json, rationale, base_fingerprint)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
    )?;
    for draft in drafts {
        insert.execute(params![
            new_id(),
            assistant_id,
            draft.case_id,
            draft.result.map(TestCaseResult::as_str),
            draft.notes_json,
            draft.rationale,
            cases.get(&draft.case_id)
        ])?;
    }
    Ok(())
}

pub(super) fn read(connection: &Connection, chat_id: &str) -> Result<Vec<TestRunSuggestion>> {
    Ok(connection.prepare(
        "SELECT s.id, s.assistant_message_id, s.case_id, s.result, s.notes_json, s.rationale, s.base_fingerprint, s.applied_fingerprint
         FROM chat_messages a JOIN chat_test_run_suggestions s ON s.assistant_message_id = a.id
         JOIN test_run_cases c ON c.id = s.case_id
         WHERE a.draft_id = ?1 ORDER BY a.created_at, a.id, c.position"
    )?.query_map([chat_id], |row| {
        let result: Option<String> = row.get(3)?;
        Ok(TestRunSuggestion {
            id: row.get(0)?,
            assistant_message_id: row.get(1)?,
            case_id: row.get(2)?,
            result: result.as_deref().map(TestCaseResult::from_stored).transpose().map_err(super::super::session_rows::to_sql_error)?,
            notes_json: row.get(4)?,
            rationale: row.get(5)?,
            base_fingerprint: row.get(6)?,
            applied_fingerprint: row.get(7)?,
        })
    })?.collect::<rusqlite::Result<_>>()?)
}
