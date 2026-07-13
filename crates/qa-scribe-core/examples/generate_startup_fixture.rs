use std::{env, path::PathBuf};

use chrono::{Duration, TimeZone, Utc};
use qa_scribe_core::storage::Database;
use rusqlite::{OptionalExtension, params};
use serde_json::json;

const SESSION_COUNT: usize = 1_000;
const ACTIVE_DRAFT_COUNT: usize = 250;
const ACTIVE_FINDING_COUNT: usize = 250;
const AI_RUN_COUNT: usize = 2_000;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: generate_startup_fixture <database-path>")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    for suffix in ["", "-shm", "-wal"] {
        let _ = std::fs::remove_file(format!("{}{}", path.display(), suffix));
    }

    let database = Database::open(&path)?;
    let active_session_id = format!("session-{:04}", SESSION_COUNT - 1);
    let active_entry_id = format!("entry-{:04}", SESSION_COUNT - 1);
    let base = Utc
        .with_ymd_and_hms(2026, 1, 1, 0, 0, 0)
        .single()
        .ok_or("fixture base timestamp is invalid")?;
    let regular_body = "<p>Deterministic startup fixture note.</p>";
    let large_body = format!("<p>{}</p>", "Large active Note Entry. ".repeat(3_200));
    let record_body = format!("<p>{}</p>", "Deterministic generated content. ".repeat(32));

    database.with_immediate_tx(|tx| {
        for index in 0..SESSION_COUNT {
            let session_id = format!("session-{index:04}");
            let entry_id = format!("entry-{index:04}");
            let timestamp = (base + Duration::seconds(index as i64)).to_rfc3339();
            tx.execute(
                "INSERT INTO sessions (
                    id, title, session_context, objective_notes, environment, build_version,
                    related_reference, created_at, updated_at, last_opened_at
                 ) VALUES (?1, ?2, NULL, NULL, 'E2E', 'fixture', NULL, ?3, ?3, ?3)",
                params![
                    session_id,
                    format!("Startup fixture Session {index:04}"),
                    timestamp
                ],
            )?;
            tx.execute(
                "INSERT INTO entries (
                    id, session_id, type, title, body, body_json, body_format, metadata_json,
                    excluded_from_generation, created_at, updated_at
                 ) VALUES (?1, ?2, 'note', NULL, ?3, NULL, 'html', NULL, 0, ?4, ?4)",
                params![
                    entry_id,
                    session_id,
                    if index + 1 == SESSION_COUNT {
                        large_body.as_str()
                    } else {
                        regular_body
                    },
                    timestamp
                ],
            )?;
        }

        for index in 0..AI_RUN_COUNT {
            let timestamp = (base + Duration::seconds((SESSION_COUNT + index) as i64)).to_rfc3339();
            tx.execute(
                "INSERT INTO ai_runs (
                    id, session_id, generation_context_id, provider, model, reasoning_effort,
                    prompt_version, status, error_message, created_at, completed_at
                 ) VALUES (?1, ?2, NULL, 'codex_cli', 'fixture-model', NULL,
                    'startup-fixture-v1', 'completed', NULL, ?3, ?3)",
                params![format!("ai-run-{index:04}"), active_session_id, timestamp],
            )?;
        }

        for index in 0..ACTIVE_DRAFT_COUNT {
            let timestamp = (base + Duration::seconds((4_000 + index) as i64)).to_rfc3339();
            tx.execute(
                "INSERT INTO drafts (
                    id, session_id, ai_run_id, kind, title, body, body_json, body_format,
                    metadata_json, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 'testware', ?4, ?5, NULL, 'html', NULL, ?6, ?6)",
                params![
                    format!("draft-{index:04}"),
                    active_session_id,
                    format!("ai-run-{index:04}"),
                    format!("Startup fixture Testware {index:04}"),
                    record_body,
                    timestamp
                ],
            )?;
        }

        for index in 0..ACTIVE_FINDING_COUNT {
            let timestamp = (base + Duration::seconds((5_000 + index) as i64)).to_rfc3339();
            tx.execute(
                "INSERT INTO findings (
                    id, session_id, title, body, body_json, body_format, kind, metadata_json,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, NULL, 'html', 'bug', NULL, ?5, ?5)",
                params![
                    format!("finding-{index:04}"),
                    active_session_id,
                    format!("Startup fixture Finding {index:04}"),
                    record_body,
                    timestamp
                ],
            )?;
        }
        Ok(())
    })?;

    let violation: Option<String> = database
        .connection()
        .query_row("PRAGMA foreign_key_check", [], |row| row.get(0))
        .optional()?;
    if violation.is_some() {
        return Err("startup fixture has a foreign-key violation".into());
    }
    database
        .connection()
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;

    println!(
        "{}",
        json!({
            "schema": "qa-scribe-startup-fixture-v1",
            "sessions": SESSION_COUNT,
            "entries": SESSION_COUNT,
            "activeSessionId": active_session_id,
            "activeEntryId": active_entry_id,
            "activeDrafts": ACTIVE_DRAFT_COUNT,
            "activeFindings": ACTIVE_FINDING_COUNT,
            "aiRuns": AI_RUN_COUNT,
            "databasePath": path,
        })
    );
    Ok(())
}
