use super::*;
use rusqlite::{Connection, types::Value};
use sha2::{Digest, Sha256};

fn original_columns(connection: &Connection) -> Vec<(String, Vec<String>)> {
    let tables = connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").unwrap().query_map([], |r| r.get::<_, String>(0)).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap();
    tables
        .into_iter()
        .map(|table| {
            let columns = connection
                .prepare(&format!("PRAGMA table_info({table})"))
                .unwrap()
                .query_map([], |r| r.get::<_, String>(1))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap();
            (table, columns)
        })
        .collect()
}
fn snapshot(connection: &Connection, columns: &[(String, Vec<String>)]) -> Vec<Vec<Vec<Value>>> {
    columns
        .iter()
        .map(|(table, fields)| {
            let mut statement = connection
                .prepare(&format!(
                    "SELECT {} FROM {table} ORDER BY rowid",
                    fields.join(",")
                ))
                .unwrap();
            statement
                .query_map([], |r| {
                    fields
                        .iter()
                        .enumerate()
                        .map(|(i, _)| r.get(i))
                        .collect::<rusqlite::Result<Vec<Value>>>()
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        })
        .collect()
}

#[test]
fn genuine_schema18_upgrade_preserves_every_original_cell_and_reopens_twice() {
    let bytes = include_bytes!("../fixtures/ask-ai-schema18/v18.sqlite");
    assert_eq!(
        format!("{:x}", Sha256::digest(bytes)),
        "3f68b6b35dd720c719e9d7a959a2ce5c518155b1aaf72009ff3fd05ab4f38ae0"
    );
    let dir = std::env::temp_dir().join(format!("qa-scribe-v18-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("qa-scribe.sqlite");
    std::fs::write(&path, bytes).unwrap();
    let old = Connection::open(&path).unwrap();
    let columns = original_columns(&old);
    let before = snapshot(&old, &columns);
    assert_eq!(
        old.query_row("PRAGMA user_version", [], |r| r.get::<_, i32>(0))
            .unwrap(),
        18
    );
    drop(old);
    let mut first_metadata = None;
    for _ in 0..3 {
        let database = Database::open(&path).unwrap();
        let c = database.connection();
        assert_eq!(snapshot(c, &columns), before);
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, i32>(0))
                .unwrap(),
            19
        );
        assert_eq!(c.query_row("SELECT COUNT(*) FROM chat_drafts WHERE owner_kind='notes' AND owner_record_id IS NULL AND composer_intent='message'", [], |r| r.get::<_, i64>(0)).unwrap(), 103);
        assert_eq!(
            c.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='idx_chat_active_session'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        let metadata = snapshot(
            c,
            &[(
                "chat_drafts".into(),
                vec![
                    "id".into(),
                    "last_active_at".into(),
                    "last_active_order".into(),
                ],
            )],
        );
        if let Some(first) = &first_metadata {
            assert_eq!(&metadata, first);
        } else {
            first_metadata = Some(metadata);
        }
        assert_eq!(
            c.prepare("PRAGMA foreign_key_check")
                .unwrap()
                .query([])
                .unwrap()
                .next()
                .unwrap()
                .map(|_| ()),
            None
        );
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn failed_backfill_rolls_back_columns_index_triggers_version_and_data() {
    let dir = std::env::temp_dir().join(format!("qa-scribe-rollback-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("qa-scribe.sqlite");
    std::fs::write(
        &path,
        include_bytes!("../fixtures/ask-ai-schema18/v18.sqlite"),
    )
    .unwrap();
    let c = Connection::open(&path).unwrap();
    let columns = original_columns(&c);
    let before = snapshot(&c, &columns);
    c.execute_batch("CREATE TRIGGER fail_ownership_backfill BEFORE UPDATE ON chat_drafts BEGIN SELECT RAISE(ABORT,'injected backfill failure'); END;").unwrap();
    drop(c);
    let error = match Database::open(&path) {
        Ok(_) => panic!("migration must fail"),
        Err(error) => error,
    };
    assert!(
        error.to_string().contains("injected backfill failure"),
        "{error}"
    );
    let c = Connection::open(&path).unwrap();
    assert_eq!(original_columns(&c), columns);
    assert_eq!(snapshot(&c, &columns), before);
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i32>(0))
            .unwrap(),
        18
    );
    assert_eq!(
        c.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='idx_chat_active_session'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        c.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='idx_chat_active_notes'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    c.execute_batch("DROP TRIGGER fail_ownership_backfill")
        .unwrap();
    drop(c);
    assert!(Database::open(&path).is_ok());
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn history_lists_all_legacy_stages_without_binding_deduplication_or_transcript_loading() {
    let (dir, service) = frozen_service();
    let history = service
        .list_chat_history(ChatHistoryScope::Session {
            session_id: "isolation-mixed".into(),
        })
        .unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].reference.draft_id, "isolation-mixed-chat");
    let origins = &history[0].unresolved_stages;
    assert_eq!(origins.len(), 3);
    assert_eq!(
        origins
            .iter()
            .filter(|s| s.record
                == ConversationRecord::Finding {
                    record_id: "isolation-mixed-finding".into()
                })
            .count(),
        2
    );
    assert_eq!(
        origins
            .iter()
            .filter(|s| s.record
                == ConversationRecord::TestCasesDraft {
                    record_id: "isolation-mixed-tests".into()
                })
            .count(),
        1
    );
    assert!(origins.iter().all(|s| s.reference == history[0].reference));
    let read = service.read_chat(&history[0].reference).unwrap();
    assert_eq!(read.messages.len(), 10);
    assert_eq!(read.proposals.len(), 3);
    let notes = service
        .list_chat_history(ChatHistoryScope::Notes {
            session_id: "perf-session".into(),
        })
        .unwrap();
    assert_eq!(notes.len(), 101);
    assert_eq!(notes.iter().filter(|h| h.archived).count(), 100);
    let active = service.load_chat("perf-session").unwrap();
    assert_eq!(active.draft_id, "perf-chat");
    assert_eq!(active.composer, "ISOLATION_ACTIVE_UNSENT_INPUT");
    assert_eq!(active.messages.len(), 100);
    assert_eq!(
        active
            .messages
            .iter()
            .map(|m| m.images.len())
            .sum::<usize>(),
        4
    );
    drop(service);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn failed_notes_index_install_rolls_back_backfill_and_old_index_removal() {
    let dir =
        std::env::temp_dir().join(format!("qa-scribe-index-rollback-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("qa-scribe.sqlite");
    std::fs::write(
        &path,
        include_bytes!("../fixtures/ask-ai-schema18/v18.sqlite"),
    )
    .unwrap();
    let c = Connection::open(&path).unwrap();
    let columns = original_columns(&c);
    let before = snapshot(&c, &columns);
    c.execute_batch("CREATE TABLE idx_chat_active_notes (obstruction TEXT)")
        .unwrap();
    drop(c);
    assert!(Database::open(&path).is_err());
    let c = Connection::open(&path).unwrap();
    assert_eq!(snapshot(&c, &columns), before);
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i32>(0))
            .unwrap(),
        18
    );
    assert_eq!(
        c.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('chat_drafts') WHERE name='owner_kind'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(c.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_chat_active_session'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    c.execute_batch("DROP TABLE idx_chat_active_notes").unwrap();
    drop(c);
    assert!(Database::open(&path).is_ok());
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn summaries_keep_every_stage_across_notes_and_record_conversations() {
    use serde_json::json;
    let (dir, service) = frozen_service();
    let owner = finding(&service, "isolation-mixed");
    let ConversationRecord::Finding { record_id } = &owner else {
        unreachable!()
    };
    let chat = service
        .begin_record_chat(launch("isolation-mixed", &owner))
        .unwrap();
    let chat = service
        .save_chat_composer(composer(
            &chat,
            "Refine this finding",
            ChatComposerIntent::RefineRecord,
        ))
        .unwrap();
    let context = ChatTarget::Finding { snapshot: RecordContextSnapshot {
        session_id: "isolation-mixed".into(), record_id: record_id.clone(), title: "Synthetic finding".into(),
        document_json: json!({"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Original"}]}]}}).to_string(),
        metadata_json: None, record_kind: "bug".into(), origin: RecordSnapshotOrigin::Saved, local_fingerprint: String::new(), stored_base_token: String::new(),
    } };
    let started = service
        .start_chat_turn_with_response(
            ChatStartRequest {
                scope: scope(&chat),
            },
            context,
            ChatRequestIntent::RefineRecord,
        )
        .unwrap();
    let contract = service
        .response_contract(&started.chat.messages[0].id)
        .unwrap()
        .unwrap();
    let chat = service.finish_chat_turn(ChatFinishRequest { scope: scope(&started.chat), turn_id: started.turn_id,
        assistant_text: json!({"version":contract.version(),"requestId":contract.request_id(),"markdown":"Review this local refinement.","refinement":{"kind":"finding","title":"Refined finding"}}).to_string(),
    }).unwrap();
    assert_eq!(chat.proposals.len(), 1);
    let chat = service
        .resolve_refinement(RefinementRequest {
            scope: scope(&chat),
            proposal_id: chat.proposals[0].id.clone(),
            action: RefinementAction::Stage,
        })
        .unwrap();
    let entries = service
        .list_chat_history(ChatHistoryScope::Session {
            session_id: "isolation-mixed".into(),
        })
        .unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(
        entries
            .iter()
            .map(|e| e.unresolved_stages.len())
            .sum::<usize>(),
        4
    );
    assert_eq!(
        entries
            .iter()
            .find(|e| e.reference.draft_id == "isolation-mixed-chat")
            .unwrap()
            .unresolved_stages
            .len(),
        3
    );
    let entry = entries
        .iter()
        .find(|e| e.reference.draft_id == chat.draft_id)
        .unwrap();
    assert_eq!(entry.unresolved_stages.len(), 1);
    assert_eq!(entry.unresolved_stages[0].record, owner.clone());
    assert_eq!(entry.last_turn_status, Some(ChatTurnStatus::Completed));
    let scoped = service
        .list_chat_history(ChatHistoryScope::Record {
            session_id: "isolation-mixed".into(),
            record: owner,
        })
        .unwrap();
    assert_eq!(scoped, vec![entry.clone()]);
    drop(service);
    std::fs::remove_dir_all(dir).unwrap();
}
