use super::*;
use serde_json::Value;

fn offer(f: &Fixture, rows: Value) -> ChatState {
    finish(
        f,
        start(
            f,
            &write(f, &begin(f), "Suggest results"),
            ChatRequestIntent::Message,
        )
        .unwrap(),
        rows,
    )
}

fn finish(f: &Fixture, started: ChatTurnStarted, rows: Value) -> ChatState {
    f.service
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            assistant_text: json!({
                "version": 2, "requestId": started.chat.messages.last().unwrap().id,
                "markdown": "Here are the suggested results.", "testRunSuggestions": rows
            })
            .to_string(),
        })
        .unwrap()
}

fn suggested(case_id: &str) -> Value {
    json!({"caseId": case_id, "result": "failed", "notesMarkdown": "**HTTP 500**", "rationale": "The request failed."})
}

fn offered_count(f: &Fixture) -> i64 {
    f.service
        .database()
        .connection()
        .query_row(
            "SELECT count(*) FROM chat_test_run_suggestions",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn a_valid_suggestion_is_saved_without_changing_the_case() {
    let f = fixture();
    let chat = offer(&f, json!([suggested(&f.run.cases[0].id)]));
    assert_eq!(
        chat.messages
            .last()
            .unwrap()
            .response
            .as_ref()
            .unwrap()
            .warning,
        None
    );
    assert_eq!(offered_count(&f), 1);
    assert_eq!(f.service.get_test_run(&f.run.id).unwrap(), f.run);
}

#[test]
fn an_empty_suggestion_list_keeps_the_clarifying_question() {
    let f = fixture();
    let started = start(
        &f,
        &write(&f, &begin(&f), "What should I record?"),
        ChatRequestIntent::Message,
    )
    .unwrap();
    let chat = f
        .service
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            assistant_text: json!({
                "version": 2, "requestId": started.chat.messages.last().unwrap().id,
                "markdown": "I need the environment.",
                "question": {"prompt": "Which environment?", "choices": ["Staging", "Production"]},
                "testRunSuggestions": []
            })
            .to_string(),
        })
        .unwrap();
    let response = chat.messages.last().unwrap().response.as_ref().unwrap();
    assert_eq!(response.warning, None);
    assert_eq!(
        response.question.as_ref().unwrap().prompt,
        "Which environment?"
    );
    assert_eq!(offered_count(&f), 0);
}

#[test]
fn notes_only_suggestions_accept_missing_or_null_rationale() {
    let f = fixture();
    let chat = offer(
        &f,
        json!([
            {"caseId": f.run.cases[0].id, "notesMarkdown": "Retried on build 4.2."},
            {"caseId": f.run.cases[1].id, "notesMarkdown": "Retried on build 4.3.", "rationale": null}
        ]),
    );
    assert_eq!(
        chat.messages
            .last()
            .unwrap()
            .response
            .as_ref()
            .unwrap()
            .warning,
        None
    );
    assert_eq!(offered_count(&f), 2);
}

#[test]
fn a_foreign_case_is_rejected() {
    let f = fixture();
    let other = f
        .service
        .start_test_run(&f.draft_id, vec![case(None, "Other")])
        .unwrap();
    let chat = offer(&f, json!([suggested(&other.cases[0].id)]));
    assert!(
        chat.messages
            .last()
            .unwrap()
            .response
            .as_ref()
            .unwrap()
            .warning
            .is_some()
    );
    assert_eq!(offered_count(&f), 0);
}

#[test]
fn notes_expanding_past_the_document_limit_are_not_offered() {
    let f = fixture();
    let chat = offer(
        &f,
        json!([{"caseId": f.run.cases[0].id, "notesMarkdown": "- [ ] x\n".repeat(1000)}]),
    );
    assert!(
        chat.messages
            .last()
            .unwrap()
            .response
            .as_ref()
            .unwrap()
            .warning
            .is_some()
    );
    assert_eq!(offered_count(&f), 0);
}

#[test]
fn a_duplicate_case_is_rejected() {
    let f = fixture();
    let row = suggested(&f.run.cases[0].id);
    offer(&f, json!([row, row]));
    assert_eq!(offered_count(&f), 0);
}

#[test]
fn empty_rows_and_results_without_rationale_are_rejected() {
    let f = fixture();
    let id = &f.run.cases[0].id;
    for row in [
        json!({"caseId": id, "notesMarkdown": " ", "rationale": "Empty"}),
        json!({"caseId": id, "result": "passed", "rationale": " "}),
        json!({"caseId": id, "result": "passed"}),
    ] {
        let chat = offer(&f, json!([row]));
        assert!(
            chat.messages
                .last()
                .unwrap()
                .response
                .as_ref()
                .unwrap()
                .warning
                .is_some()
        );
    }
    assert_eq!(offered_count(&f), 0);
}

#[test]
fn retry_keeps_the_contract_and_captures_new_base_values() {
    let f = fixture();
    let chat = write(&f, &begin(&f), "Suggest results");
    let original = start(&f, &chat, ChatRequestIntent::Message).unwrap();
    let user = original.chat.messages.last().unwrap();
    let contract = f.service.response_contract(&user.id).unwrap();
    let case_id = &f.run.cases[0].id;
    let source = |turn: &str| -> String {
        f.service.database().connection().query_row(
            "SELECT fingerprint FROM chat_test_run_sources WHERE message_id=?1 AND turn_id=?2 AND case_id=?3",
            [&user.id, turn, case_id],
            |row| row.get(0),
        ).unwrap()
    };
    let first = source(&original.turn_id);
    let failed = f
        .service
        .fail_chat_turn(ChatFailRequest {
            scope: scope(&original.chat),
            turn_id: original.turn_id,
            kind: ChatFailureKind::Failed,
            error_message: "Try again".into(),
        })
        .unwrap();
    f.service
        .set_test_case_result(
            case_id,
            TestCaseResult::Blocked,
            Some("Retried manually".into()),
        )
        .unwrap();
    let retry = f
        .service
        .retry_chat_turn(ChatStartRequest {
            scope: scope(&failed),
        })
        .unwrap();
    let second = source(&retry.turn_id);
    assert_ne!(first, second);
    assert_eq!(f.service.response_contract(&user.id).unwrap(), contract);
    let finished = finish(&f, retry, json!([suggested(case_id)]));
    let saved: String = f
        .service
        .database()
        .connection()
        .query_row(
            "SELECT base_fingerprint FROM chat_test_run_suggestions WHERE assistant_message_id=?1",
            [&finished.messages.last().unwrap().id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(saved, second);
}

#[test]
fn deleting_a_run_cascades_its_attempts_and_suggestions() {
    let f = fixture();
    offer(&f, json!([suggested(&f.run.cases[0].id)]));
    assert_eq!(offered_count(&f), 1);
    f.service.delete_test_run(&f.run.id).unwrap();
    assert_eq!(offered_count(&f), 0);
    let sources: i64 = f
        .service
        .database()
        .connection()
        .query_row("SELECT count(*) FROM chat_test_run_sources", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(sources, 0);
}

#[test]
fn a_schema_25_database_keeps_the_run_and_conversation_on_upgrade() {
    use qa_scribe_core::storage::Database;
    let dir = std::env::temp_dir().join(format!("qa-scribe-phase-five-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let path = dir.join("phase-five.sqlite");
    let f = fixture_with(SessionService::new(Database::open(&path).unwrap()).unwrap());
    let chat = write(&f, &begin(&f), "Retained input");
    let reference = ChatRef {
        session_id: f.session_id.clone(),
        draft_id: chat.draft_id.clone(),
    };
    f.service.database().connection().execute_batch(
        "DROP TABLE IF EXISTS chat_test_run_suggestions; DROP TABLE IF EXISTS chat_test_run_sources; PRAGMA user_version = 25;"
    ).unwrap();
    let expected = f.run.clone();
    drop(f);

    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    assert_eq!(service.get_test_run(&expected.id).unwrap(), expected);
    assert_eq!(service.read_chat(&reference).unwrap(), chat);
    let db = service.database().connection();
    for table in ["chat_test_run_sources", "chat_test_run_suggestions"] {
        let count: i64 = db
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }
    let version: i32 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, 26);
    drop(service);
    std::fs::remove_dir_all(dir).unwrap();
}

mod updates;
