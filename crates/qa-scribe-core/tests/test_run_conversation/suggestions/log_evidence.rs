use super::*;

const ID: &str = "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/qa/providers/Microsoft.Insights/components/checkout";
const PROVIDER: AiProvider = AiProvider::CodexCli;

fn target() -> ApplicationLogSource {
    ApplicationLogSource {
        label: "Acceptance".into(),
        resource_id: ID.into(),
    }
}

fn enable(f: &Fixture, enabled: bool) {
    let mut settings = f.service.get_settings().unwrap();
    settings.ask_ai_application_logs = enabled;
    settings.application_log_sources = vec![target()];
    f.service.update_settings(settings).unwrap();
}

fn send(f: &Fixture, chat: &ChatState, provider: AiProvider) -> ChatTurnStarted {
    let mut started = start(
        f,
        &write(f, chat, "Use application log evidence"),
        ChatRequestIntent::Message,
    )
    .unwrap();
    let run = f
        .service
        .create_ai_run(AiRunCreate {
            session_id: f.session_id.clone(),
            generation_context_id: None,
            provider,
            model: "default".into(),
            reasoning_effort: None,
            prompt_version: "test".into(),
        })
        .unwrap();
    started.chat = f
        .service
        .associate_chat_turn_ai_run(ChatAssociateRunRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id.clone(),
            ai_run_id: run.id,
        })
        .unwrap();
    started
}

fn chat_ref(chat: &ChatState) -> ChatRef {
    ChatRef {
        session_id: chat.session_id.clone(),
        draft_id: chat.draft_id.clone(),
    }
}

fn capture(f: &Fixture, started: &ChatTurnStarted) -> Result<String, QaScribeError> {
    let query = ApplicationLogQuery {
        target_id: ID.into(),
        kql: "traces | take 1".into(),
        start: "2026-11-24T00:00:00Z".into(),
        end: "2026-11-24T00:15:00Z".into(),
    }
    .validate(&[target()])
    .unwrap();
    f.service.record_chat_log_capture(&chat_ref(&started.chat), &started.turn_id, PROVIDER, &query, &QueriedApplicationLogs {
        result_json: json!({"tables":[{"name":"PrimaryResult","columns":[{"name":"Message","type":"string"}],"rows":[["scope-sensitive row"]]}]}).to_string(),
        row_count: 1,
        truncated: false,
        portal_url: "https://portal.azure.com/#query".into(),
    })
}

fn offer_capture(f: &Fixture, started: ChatTurnStarted, id: &str) -> ChatState {
    finish(
        f,
        started,
        json!([{"caseId":f.run.cases[1].id,"captureIds":[id]}]),
    )
}

#[test]
fn replay_and_suggestions_admit_only_the_approved_provider_and_conversation() {
    let f = fixture();
    let started = send(&f, &begin(&f), PROVIDER);
    assert!(capture(&f, &started).is_err());
    enable(&f, true);
    let id = capture(&f, &started).unwrap();
    let chat = offer_capture(&f, started, &id);
    let same = send(&f, &chat, PROVIDER);
    let replay = |attempt: &ChatTurnStarted, provider| {
        f.service
            .chat_log_replay(&chat_ref(&attempt.chat), &attempt.turn_id, provider)
            .unwrap()
    };
    assert_eq!(replay(&same, PROVIDER)[0]["captureId"], id);
    assert!(replay(&same, AiProvider::ClaudeCode).is_empty());
    let chat = finish(&f, same, json!([]));
    let another_provider = send(&f, &chat, AiProvider::ClaudeCode);
    assert!(replay(&another_provider, AiProvider::ClaudeCode).is_empty());
    let bad = offer_capture(&f, another_provider, &id);
    assert!(
        bad.messages
            .last()
            .unwrap()
            .response
            .as_ref()
            .unwrap()
            .warning
            .is_some()
    );
    let foreign = send(&f, &begin(&f), PROVIDER);
    assert!(replay(&foreign, PROVIDER).is_empty());
    let chat = offer_capture(&f, foreign, &id);
    assert!(chat.test_run_suggestions.is_empty());
    enable(&f, false);
    let same = send(&f, &bad, PROVIDER);
    assert!(replay(&same, PROVIDER).is_empty());
    assert!(capture(&f, &same).is_err());
}

#[test]
fn apply_and_undo_attach_only_the_suggested_capture_and_keep_it_on_conversation_deletion() {
    let f = fixture();
    enable(&f, true);
    let started = send(&f, &begin(&f), PROVIDER);
    let id = capture(&f, &started).unwrap();
    let unattached = capture(&f, &started).unwrap();
    let chat = offer_capture(&f, started, &id);
    let suggestion = &chat.test_run_suggestions[0];
    assert_eq!(suggestion.capture_ids, std::slice::from_ref(&id));
    let request = TestRunSuggestionRequest {
        reference: chat_ref(&chat),
        suggestion_id: suggestion.id.clone(),
    };
    let run = || f.service.get_test_run(&f.run.id).unwrap();
    assert!(run().log_evidence.is_empty());
    f.service
        .apply_test_run_suggestion(request.clone())
        .unwrap();
    assert_eq!(run().log_evidence[0].id, id);
    assert_eq!(run().log_evidence[0].case_id, f.run.cases[1].id);
    assert_eq!(run().cases[1].result, TestCaseResult::NotRun);
    f.service.undo_test_run_suggestion(request.clone()).unwrap();
    assert!(run().log_evidence.is_empty());
    f.service.apply_test_run_suggestion(request).unwrap();
    let db = f.service.database().connection();
    db.execute("DELETE FROM chat_drafts WHERE id = ?1", [&chat.draft_id])
        .unwrap();
    assert_eq!(run().log_evidence[0].id, id);
    let exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM test_run_log_captures WHERE id = ?1)",
            [&unattached],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!exists);
}

fn manual_capture(f: &Fixture) -> LogEvidenceSummary {
    let query = ApplicationLogQuery {
        target_id: ID.into(),
        kql: "print manual_only".into(),
        start: "2026-11-24T00:00:00Z".into(),
        end: "2026-11-24T00:15:00Z".into(),
    }
    .validate(&[target()])
    .unwrap();
    f.service
        .attach_application_logs(
            &f.run.cases[2].id,
            query,
            QueriedApplicationLogs {
                result_json: r#"{"tables":[]}"#.into(),
                row_count: 0,
                truncated: false,
                portal_url: "https://portal.azure.com/#manual".into(),
            },
        )
        .unwrap()
}

#[test]
fn version_27_upgrade_preserves_offered_rows_applied_undo_and_manual_evidence() {
    use qa_scribe_core::storage::Database;
    let dir = std::env::temp_dir().join(format!("qa-log-evidence-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let path = dir.join("state.sqlite");
    let open = || SessionService::new(Database::open(&path).unwrap()).unwrap();
    let f = fixture_with(open());
    let chat = offer(
        &f,
        json!([suggested(&f.run.cases[0].id), suggested(&f.run.cases[1].id)]),
    );
    let request = TestRunSuggestionRequest {
        reference: chat_ref(&chat),
        suggestion_id: chat.test_run_suggestions[0].id.clone(),
    };
    f.service
        .apply_test_run_suggestion(request.clone())
        .unwrap();
    let manual = manual_capture(&f);
    let db = f.service.database().connection();
    db.execute_batch(
        "DROP TRIGGER chat_log_attachment_detached;
         DROP TRIGGER chat_log_unattached_delete;
         DROP TRIGGER chat_log_capture_owner;
         DROP TABLE chat_suggestion_log_captures;
         DROP TABLE chat_log_capture_shares;
         DROP TRIGGER chat_test_run_suggestion_owner;
         DROP INDEX idx_chat_test_run_suggestions_case;
         ALTER TABLE chat_test_run_suggestions RENAME TO version_28_suggestions;",
    )
    .unwrap();
    db.execute_batch(include_str!("../../fixtures/test_run_suggestions_v27.sql"))
        .unwrap();
    db.execute_batch(
        "INSERT INTO chat_test_run_suggestions
         SELECT id, assistant_message_id, case_id, result, notes_json, rationale, base_fingerprint, applied_fingerprint,
                previous_result, previous_notes_json, previous_remark FROM version_28_suggestions;
         DROP TABLE version_28_suggestions;
         PRAGMA user_version = 27;"
    ).unwrap();
    let run_id = f.run.id.clone();
    drop(f);
    let service = open();
    let db = service.database().connection();
    let count: u32 = db
        .query_row(
            "SELECT COUNT(*) FROM chat_test_run_suggestions WHERE applied_fingerprint IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
    assert_eq!(
        service.get_test_run(&run_id).unwrap().log_evidence,
        [manual]
    );
    service.undo_test_run_suggestion(request).unwrap();
    assert_eq!(
        service.get_test_run(&run_id).unwrap().cases[0].result,
        TestCaseResult::NotRun
    );
    drop(service);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn sweep_keeps_manual_attached_recent_and_still_offered_captures() {
    let f = fixture();
    enable(&f, true);
    let started = send(&f, &begin(&f), PROVIDER);
    let [attached, offered, recent, stale] =
        std::array::from_fn(|_| capture(&f, &started).unwrap());
    let manual = manual_capture(&f);
    let replay = f
        .service
        .chat_log_replay(&chat_ref(&started.chat), &started.turn_id, PROVIDER)
        .unwrap();
    assert!(replay.iter().all(|entry| entry["captureId"] != manual.id));
    let chat = finish(
        &f,
        started,
        json!([
            {"caseId":f.run.cases[0].id,"captureIds":[attached]},
            {"caseId":f.run.cases[1].id,"captureIds":[offered]},
        ]),
    );
    let row = chat
        .test_run_suggestions
        .iter()
        .find(|s| s.case_id == f.run.cases[0].id)
        .unwrap();
    f.service
        .apply_test_run_suggestion(TestRunSuggestionRequest {
            reference: chat_ref(&chat),
            suggestion_id: row.id.clone(),
        })
        .unwrap();
    assert!(
        chat.application_log_captures
            .iter()
            .all(|entry| entry.id != manual.id)
    );
    let db = f.service.database().connection();
    db.execute_batch("DROP TRIGGER log_capture_immutable")
        .unwrap();
    db.execute(
        "UPDATE test_run_log_captures SET executed_at = datetime('now', '-31 days') WHERE id != ?1",
        [&recent],
    )
    .unwrap();
    f.service.sweep_unattached_chat_log_captures().unwrap();
    let exists = |id: &str| {
        db.query_row(
            "SELECT EXISTS(SELECT 1 FROM test_run_log_captures WHERE id = ?1)",
            [id],
            |r| r.get::<_, bool>(0),
        )
        .unwrap()
    };
    assert!(!exists(&stale));
    for keep in [&attached, &offered, &recent, &manual.id] {
        assert!(exists(keep));
    }
}

#[test]
fn oversized_replays_keep_the_capture_id_and_activity_limits_full_kql() {
    let f = fixture();
    enable(&f, true);
    let started = send(&f, &begin(&f), PROVIDER);
    let kql = format!("print 1 // {}", "q".repeat(15_000));
    let query = ApplicationLogQuery {
        target_id: ID.into(),
        kql: kql.clone(),
        start: "2026-11-24T00:00:00Z".into(),
        end: "2026-11-24T00:15:00Z".into(),
    }
    .validate(&[target()])
    .unwrap();
    let mut ids = Vec::new();
    for _ in 0..3 {
        ids.push(
            f.service
                .record_chat_log_capture(
                    &chat_ref(&started.chat),
                    &started.turn_id,
                    PROVIDER,
                    &query,
                    &QueriedApplicationLogs {
                        result_json: json!({"tables":[{"rows":[["x".repeat(32_500)]]}]})
                            .to_string(),
                        row_count: 1,
                        truncated: false,
                        portal_url: format!("https://portal.azure.com/#{}", "q".repeat(500)),
                    },
                )
                .unwrap(),
        );
    }
    let replay = f
        .service
        .chat_log_replay(&chat_ref(&started.chat), &started.turn_id, PROVIDER)
        .unwrap();
    assert_eq!(replay.len(), 3);
    assert!(json!(replay).to_string().len() <= 32 * 1024);
    for id in ids {
        assert!(replay.iter().any(|entry| entry["captureId"] == id
            && entry["replayOmitted"] == true
            && entry.get("result").is_none()));
    }
    let manual = manual_capture(&f);
    let chat = offer_capture(&f, started, &manual.id);
    assert!(chat.test_run_suggestions.is_empty());
    assert_eq!(chat.application_log_captures.len(), 2);
    assert!(
        chat.application_log_captures
            .iter()
            .all(|capture| capture.kql == kql)
    );
}
