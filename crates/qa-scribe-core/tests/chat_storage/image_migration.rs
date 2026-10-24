use super::*;

fn legacy(path: &std::path::Path) -> rusqlite::Connection {
    let c = rusqlite::Connection::open(path).unwrap();
    c.execute_batch(include_str!("../fixtures/schema_v13.sql"))
        .unwrap();
    c.execute_batch("INSERT INTO sessions (id,title,created_at,updated_at,last_opened_at) VALUES ('s','Legacy','time','time','time');
        INSERT INTO chat_drafts (id,session_id,revision,composer,mode,archived,created_at) VALUES ('d','s',7,' exact composer ','chat',1,'time');
        INSERT INTO ai_runs (id,session_id,provider,model,prompt_version,status,created_at) VALUES ('run','s','codex_cli','model','old','completed','time');
        INSERT INTO chat_messages (id,draft_id,turn_id,sequence,role,text,status,ai_run_id,created_at) VALUES ('u','d','turn',0,'user',' exact user ','completed','run','time'), ('a','d','turn',1,'assistant','exact assistant','completed','run','time');
        UPDATE chat_drafts SET submitted_note_id='note', submitted_at='submitted' WHERE id='d';").unwrap();
    c
}

#[test]
fn schema13_rebuild_preserves_identity_receipt_revisions_indexes_and_constraints() {
    let dir = helpers::unique_temp_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("legacy.sqlite");
    drop(legacy(&path));
    let database = Database::open(&path).unwrap();
    let c = database.connection();
    let version: i32 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, 16);
    let draft: (i32,String,String,i32,String,String) = c.query_row("SELECT revision,composer,mode,archived,submitted_note_id,submitted_at FROM chat_drafts WHERE id='d'", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).unwrap();
    assert_eq!(
        draft,
        (
            7,
            " exact composer ".into(),
            "chat".into(),
            1,
            "note".into(),
            "submitted".into()
        )
    );
    let rows = c.prepare("SELECT id,turn_id,sequence,role,text,status,ai_run_id,created_at FROM chat_messages ORDER BY sequence").unwrap().query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i32>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?,r.get::<_,String>(7)?))).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap();
    assert_eq!(
        rows,
        vec![
            (
                "u".into(),
                "turn".into(),
                0,
                "user".into(),
                " exact user ".into(),
                "completed".into(),
                "run".into(),
                "time".into()
            ),
            (
                "a".into(),
                "turn".into(),
                1,
                "assistant".into(),
                "exact assistant".into(),
                "completed".into(),
                "run".into(),
                "time".into()
            )
        ]
    );
    for name in [
        "idx_chat_one_running_turn",
        "idx_chat_messages_ai_run",
        "idx_chat_run_user",
    ] {
        let count: i32 = c
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='index' AND name=?1",
                [name],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
    for table in ["chat_composer_images", "chat_message_images"] {
        assert_eq!(helpers::count_rows(c, table), 0);
    }
    assert!(
        c.execute("UPDATE chat_messages SET text='changed' WHERE id='u'", [])
            .is_err()
    );
    c.execute(
        "INSERT INTO chat_drafts (id,session_id,created_at) VALUES ('new','s','time')",
        [],
    )
    .unwrap();
    c.execute("INSERT INTO chat_messages (id,draft_id,turn_id,sequence,role,text,status,created_at) VALUES ('empty-user','new','t',0,'user','','running','time')", []).unwrap();
    assert!(c.execute("INSERT INTO chat_messages (id,draft_id,turn_id,sequence,role,text,status,created_at) VALUES ('empty-assistant','new','t',1,'assistant','','completed','time')", []).is_err());
    helpers::assert_no_foreign_key_violations(c);
    drop(database);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn schema13_failed_copy_rolls_back_schema_and_version_and_future_is_untouched() {
    let dir = helpers::unique_temp_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("legacy.sqlite");
    let c = legacy(&path);
    c.execute_batch("DROP TRIGGER chat_submitted_messages_no_update; PRAGMA ignore_check_constraints=ON; UPDATE chat_messages SET text='' WHERE id='a'; PRAGMA ignore_check_constraints=OFF;").unwrap();
    let before: Vec<(String, String)> = c
        .prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    drop(c);
    assert!(Database::open(&path).is_err());
    let c = rusqlite::Connection::open(&path).unwrap();
    let after: Vec<(String, String)> = c
        .prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(after, before);
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i32>(0))
            .unwrap(),
        13
    );
    c.execute_batch("PRAGMA user_version=99;").unwrap();
    drop(c);
    let before = std::fs::read(&path).unwrap();
    validation(Database::open(&path).map(|_| ()));
    assert_eq!(std::fs::read(&path).unwrap(), before);
    std::fs::remove_dir_all(dir).unwrap();
}
