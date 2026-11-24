use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};

use crate::{Result, domain::*, error::validation};

use super::{SessionService, new_id, now};

const REPLAY_BYTES: usize = 32 * 1024;
const ACTIVITY_KQL_BYTES: usize = 32 * 1024;

impl SessionService {
    pub fn chat_log_sources(
        &self,
        reference: &ChatRef,
        turn_id: &str,
        provider: AiProvider,
    ) -> Result<Vec<ApplicationLogSource>> {
        let settings = self.get_settings()?;
        if !settings.ask_ai_application_logs
            || running_test_run(self.database.connection(), reference, turn_id, provider)?.is_none()
        {
            return Ok(Vec::new());
        }
        Ok(settings.application_log_sources)
    }

    pub fn record_chat_log_capture(
        &self,
        reference: &ChatRef,
        turn_id: &str,
        provider: AiProvider,
        query: &ValidatedApplicationLogQuery,
        output: &QueriedApplicationLogs,
    ) -> Result<String> {
        if output.row_count > CHAT_LOG_RESULT_MAX_ROWS
            || output.result_json.len() > CHAT_LOG_RESULT_MAX_BYTES
        {
            return Err(validation(
                "The log results exceed the Ask AI capture limit.",
            ));
        }
        let sources = self.chat_log_sources(reference, turn_id, provider)?;
        if !sources.contains(&query.target) {
            return Err(validation(
                "Application log access changed. Ask for a new query.",
            ));
        }
        let id = new_id();
        let sources_json = serde_json::to_string(&[&query.target]).expect("serializable target");
        self.database.with_immediate_tx(|tx| {
            let run_id = running_test_run(tx, reference, turn_id, provider)?
                .ok_or_else(|| validation("This test run conversation has ended."))?;
            tx.execute(
                "INSERT INTO test_run_log_captures
                 (id, session_id, run_id, conversation_id, origin, sources_json, kql, starts_at, ends_at,
                  executed_at, row_count, truncated, result_json, portal_url)
                 VALUES (?1, ?2, ?3, ?4, 'ask_ai', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    id, reference.session_id, run_id, reference.draft_id, sources_json, query.kql,
                    query.start, query.end, now(), output.row_count, output.truncated,
                    output.result_json, output.portal_url,
                ],
            )?;
            tx.execute(
                "INSERT INTO chat_log_capture_shares (capture_id, provider) VALUES (?1, ?2)",
                params![id, provider.as_str()],
            )?;
            Ok(id)
        })
    }

    pub fn chat_log_replay(
        &self,
        reference: &ChatRef,
        turn_id: &str,
        provider: AiProvider,
    ) -> Result<Vec<Value>> {
        let sources = self.chat_log_sources(reference, turn_id, provider)?;
        if sources.is_empty() {
            return Ok(Vec::new());
        }
        let mut stmt = self.database.connection().prepare(
            "SELECT c.id, c.sources_json, c.starts_at, c.ends_at, c.row_count, c.truncated,
                    c.result_json, c.portal_url
             FROM test_run_log_captures c JOIN chat_log_capture_shares sh ON sh.capture_id = c.id
             WHERE c.conversation_id = ?1 AND c.session_id = ?2 AND sh.provider = ?3
             ORDER BY c.executed_at DESC, c.id DESC LIMIT 30",
        )?;
        let mut rows = stmt.query(params![
            reference.draft_id,
            reference.session_id,
            provider.as_str()
        ])?;
        let mut replay = Vec::new();
        let mut remaining = REPLAY_BYTES - 2;
        while let Some(row) = rows.next()? {
            let target: String = row.get(1)?;
            let Ok(targets) = serde_json::from_str::<Vec<ApplicationLogSource>>(&target) else {
                continue;
            };
            if targets.len() != 1 || !sources.contains(&targets[0]) {
                continue;
            }
            let data: String = row.get(6)?;
            let (Ok(data), label) = (serde_json::from_str::<Value>(&data), &targets[0].label)
            else {
                continue;
            };
            let mut entry = json!({
                "captureId": row.get::<_, String>(0)?,
                "target": label,
                "start": row.get::<_, String>(2)?,
                "end": row.get::<_, String>(3)?,
                "rowCount": row.get::<_, u32>(4)?,
                "truncated": row.get::<_, bool>(5)?,
                "result": data,
                "portalUrl": row.get::<_, String>(7)?,
            });
            let mut bytes = entry.to_string().len() + 1;
            if bytes > remaining {
                let object = entry.as_object_mut().expect("object");
                object.remove("portalUrl");
                object.remove("result");
                object.insert("replayOmitted".into(), Value::Bool(true));
                bytes = entry.to_string().len() + 1;
                if bytes > remaining {
                    break;
                }
            }
            remaining -= bytes;
            replay.push(entry);
        }
        Ok(replay)
    }

    pub fn sweep_unattached_chat_log_captures(&self) -> Result<()> {
        self.database.connection().execute(
            "DELETE FROM test_run_log_captures
             WHERE origin = 'ask_ai' AND case_id IS NULL
               AND julianday(executed_at) < julianday('now', '-30 days')
               AND NOT EXISTS (SELECT 1 FROM chat_suggestion_log_captures l
                 JOIN chat_test_run_suggestions s ON s.id = l.suggestion_id
                 WHERE l.capture_id = test_run_log_captures.id AND s.applied_fingerprint IS NULL)",
            [],
        )?;
        Ok(())
    }
}

pub(super) fn activity(
    connection: &rusqlite::Connection,
    chat_id: &str,
) -> Result<Vec<ChatLogCapture>> {
    let mut statement = connection.prepare(
        "SELECT c.id, json_extract(c.sources_json, '$[0].label'), c.kql, c.starts_at, c.ends_at,
                c.row_count, c.truncated, share.provider
         FROM test_run_log_captures c JOIN chat_log_capture_shares share ON share.capture_id = c.id
         WHERE c.conversation_id = ?1 ORDER BY c.executed_at DESC, c.id DESC LIMIT 20",
    )?;
    let mut rows = statement.query([chat_id])?;
    let mut activity = Vec::new();
    let mut remaining = ACTIVITY_KQL_BYTES;
    while let Some(row) = rows.next()? {
        let kql: String = row.get(2)?;
        if kql.len() > remaining {
            break;
        }
        remaining -= kql.len();
        activity.push(ChatLogCapture {
            id: row.get(0)?,
            target_label: row.get(1)?,
            kql,
            start: row.get(3)?,
            end: row.get(4)?,
            row_count: row.get(5)?,
            truncated: row.get(6)?,
            provider: AiProvider::from_stored(&row.get::<_, String>(7)?)?,
        });
    }
    Ok(activity)
}

fn running_test_run(
    connection: &rusqlite::Connection,
    reference: &ChatRef,
    turn_id: &str,
    provider: AiProvider,
) -> Result<Option<String>> {
    Ok(connection
        .query_row(
            "SELECT d.owner_record_id FROM chat_drafts d
         JOIN chat_messages m ON m.draft_id = d.id AND m.turn_id = ?3
         JOIN ai_runs a ON a.id = m.ai_run_id AND a.session_id = d.session_id AND a.provider = ?4
         WHERE d.id = ?1 AND d.session_id = ?2 AND d.owner_kind = 'test_run' AND d.archived = 0
           AND m.role = 'user' AND m.status = 'running' AND a.status = 'running'",
            params![
                reference.draft_id,
                reference.session_id,
                turn_id,
                provider.as_str()
            ],
            |row| row.get(0),
        )
        .optional()?)
}
