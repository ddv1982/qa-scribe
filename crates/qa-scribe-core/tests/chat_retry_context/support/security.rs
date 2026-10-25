use super::*;

pub fn forged_snapshot(kind: Kind) -> (SessionService, ChatState) {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let foreign = session(&service);
    let record = Record::create(&service, &foreign, kind);
    let context = record.target();
    record.delete(&service);
    let chat = service.load_chat(&id).unwrap();
    let user_id = uuid::Uuid::new_v4().to_string();
    let turn_id = uuid::Uuid::new_v4().to_string();
    service.database().connection().execute(
        "INSERT INTO chat_messages (id, draft_id, turn_id, sequence, role, text, status, created_at) VALUES (?1, ?2, ?3, 0, 'user', 'Untrusted context', 'running', 'fixture')",
        rusqlite::params![user_id, chat.draft_id, turn_id],
    ).unwrap();
    service.database().connection().execute(
        "INSERT INTO chat_message_contexts (message_id, version, context_json) VALUES (?1, 1, ?2)", rusqlite::params![user_id, serde_json::to_string(&context).unwrap()],
    ).unwrap();
    let failed = service
        .fail_chat_turn(ChatFailRequest {
            scope: scope(&chat),
            turn_id,
            kind: ChatFailureKind::Failed,
            error_message: "Fixture failure".into(),
        })
        .unwrap();
    (service, failed)
}

pub fn replace_source(f: &Fixture, foreign: bool, wrong_kind: bool) {
    let (table, id) = f.record.row();
    let owner = if foreign {
        session(&f.service)
    } else {
        f.chat.session_id.clone()
    };
    let columns: Vec<String> = {
        let mut statement = f
            .service
            .database()
            .connection()
            .prepare(&format!("PRAGMA table_info({table})"))
            .unwrap();
        statement
            .query_map([], |r| r.get(1))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    };
    let saved: Vec<rusqlite::types::Value> = f
        .service
        .database()
        .connection()
        .query_row(&format!("SELECT * FROM {table} WHERE id = ?1"), [id], |r| {
            (0..columns.len()).map(|i| r.get(i)).collect()
        })
        .unwrap();
    f.record.delete(&f.service);
    let mut replacement = saved;
    for (column, value) in columns.iter().zip(&mut replacement) {
        if column == "session_id" {
            *value = owner.clone().into();
        }
        if column == "title" {
            *value = "Replacement title must not replay".to_string().into();
        }
        if column == "kind" && wrong_kind {
            *value = "session_report".to_string().into();
        }
    }
    let placeholders = (0..columns.len())
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");
    f.service
        .database()
        .connection()
        .execute(
            &format!("INSERT INTO {table} VALUES ({placeholders})"),
            rusqlite::params_from_iter(replacement),
        )
        .unwrap();
}
