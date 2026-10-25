use qa_scribe_core::{
    domain::*,
    services::{SessionService, readable_chat_message},
    storage::Database,
};
use serde_json::{Value, json};

fn scope(c: &ChatState) -> ChatRevision {
    ChatRevision {
        session_id: c.session_id.clone(),
        draft_id: c.draft_id.clone(),
        expected_revision: c.revision,
    }
}
fn setup() -> (SessionService, Finding, ChatTarget) {
    let s = SessionService::in_memory().unwrap();
    let session = s
        .create_session(SessionDraft {
            title: "Question tests".into(),
            ..Default::default()
        })
        .unwrap();
    let f = s
        .create_finding(FindingDraft {
            session_id: session.id,
            title: "Original finding".into(),
            body: "Original body".into(),
            body_json: None,
            body_format: None,
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .unwrap();
    let target = ChatTarget::Finding { snapshot: RecordContextSnapshot { session_id: f.session_id.clone(), record_id: f.id.clone(), title: "Unsaved original".into(), document_json: json!({"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Unsaved body"}]}]}}).to_string(), metadata_json: None, record_kind: "bug".into(), origin: RecordSnapshotOrigin::UnsavedEditor, local_fingerprint: String::new(), stored_base_token: String::new() } };
    (s, f, target)
}
fn save(s: &SessionService, c: &ChatState, text: &str) -> ChatState {
    s.save_chat_composer(ChatComposerRequest {
        intent: qa_scribe_core::domain::ChatComposerIntent::Message,
        scope: scope(c),
        composer: text.into(),
        mode: ChatMode::Chat,
        attachment_ids: vec![],
    })
    .unwrap()
}
fn start(
    s: &SessionService,
    c: &ChatState,
    target: ChatTarget,
    intent: ChatRequestIntent,
) -> ChatTurnStarted {
    s.start_chat_turn_with_response(ChatStartRequest { scope: scope(c) }, target, intent)
        .unwrap()
}
fn finish(s: &SessionService, started: ChatTurnStarted, question: Value) -> ChatState {
    let id = &started.chat.messages.last().unwrap().id;
    let text = json!({"version":2,"requestId":id,"markdown":"## Jira content\n\nOriginal draft.","question":question}).to_string();
    s.finish_chat_turn(ChatFinishRequest {
        scope: scope(&started.chat),
        turn_id: started.turn_id,
        assistant_text: text,
    })
    .unwrap()
}
fn question(s: &SessionService, f: &Finding, target: &ChatTarget) -> ChatState {
    let c = s.load_chat(&f.session_id).unwrap();
    finish(
        s,
        start(s, &c, target.clone(), ChatRequestIntent::DraftJira),
        json!({"prompt":"Which configured type?","choices":[" Finding subtask ","Bug"]}),
    )
}
fn click(c: &ChatState, text: &str) -> ChatRequestIntent {
    ChatRequestIntent::QuestionReply {
        assistant_message_id: c.messages.last().unwrap().id.clone(),
        text: text.into(),
    }
}

#[test]
fn click_sends_only_visible_text_and_original_immutable_snapshot() {
    let (s, f, target) = setup();
    let c = question(&s, &f, &target);
    let assistant = c.messages.last().unwrap();
    assert_eq!(assistant.text, "## Jira content\n\nOriginal draft.");
    assert_eq!(
        assistant
            .response
            .as_ref()
            .unwrap()
            .question
            .as_ref()
            .unwrap()
            .choices,
        vec!["Finding subtask", "Bug"]
    );
    let original = c.messages[0].context.clone();
    let mut newer = target;
    if let ChatTarget::Finding { snapshot } = &mut newer {
        snapshot.title = "Newer local edit".into();
    }
    let prepared = s
        .prepare_chat_message(&c, newer.clone(), &click(&c, "Finding subtask"))
        .unwrap();
    assert_eq!(prepared.text, "Finding subtask");
    assert_eq!(prepared.context, original);
    let started = start(&s, &c, newer, click(&c, "Finding subtask"));
    let reply = started.chat.messages.last().unwrap();
    assert_eq!(reply.text, "Finding subtask");
    assert_eq!(reply.context, original);
    assert!(reply.images.is_empty());
    assert_eq!(
        reply.answer.as_ref().unwrap().assistant_message_id,
        assistant.id
    );
    assert!(
        s.start_chat_turn_with_response(
            ChatStartRequest { scope: scope(&c) },
            original,
            click(&c, "Bug")
        )
        .is_err()
    );
    assert_eq!(s.load_chat(&f.session_id).unwrap().messages.len(), 3);
    assert_eq!(
        s.list_findings(&f.session_id).unwrap()[0].title,
        "Original finding"
    );
}

#[test]
fn typed_equality_is_trimmed_case_sensitive_and_mismatch_remains_normal_send() {
    for (text, matches) in [
        ("  Bug  ", true),
        ("bug", false),
        ("not Bug", false),
        ("Bug please", false),
    ] {
        let (s, f, target) = setup();
        let c = question(&s, &f, &target);
        let c = save(&s, &c, text);
        let started = start(&s, &c, target, ChatRequestIntent::Message);
        let user = started.chat.messages.last().unwrap();
        assert_eq!(user.text, text);
        assert_eq!(user.answer.is_some(), matches);
    }
    let (s, f, target) = setup();
    let c = question(&s, &f, &target);
    assert!(
        s.start_chat_turn_with_response(
            ChatStartRequest { scope: scope(&c) },
            ChatTarget::Session,
            click(&c, "Bug")
        )
        .is_err()
    );
    let c = save(&s, &c, "Bug");
    let started = start(&s, &c, ChatTarget::Session, ChatRequestIntent::Message);
    let user = started.chat.messages.last().unwrap();
    assert_eq!(user.text, "Bug");
    assert_eq!(user.context, ChatTarget::Session);
    assert_eq!(user.answer, None);
}

#[test]
fn occupied_composer_rejects_chip_without_replacing_input() {
    for text in ["My unsent question", " "] {
        let (s, f, target) = setup();
        let c = question(&s, &f, &target);
        let c = save(&s, &c, text);
        assert!(
            s.start_chat_turn_with_response(
                ChatStartRequest { scope: scope(&c) },
                target,
                click(&c, "Bug")
            )
            .is_err()
        );
        let loaded = s.load_chat(&f.session_id).unwrap();
        assert_eq!(loaded.composer, text);
        assert_eq!(loaded.messages.len(), 2);
    }
}

#[test]
fn every_later_turn_expires_choices_and_retry_reuses_answer_and_nonce() {
    for status in [ChatFailureKind::Failed, ChatFailureKind::Cancelled] {
        let (s, f, target) = setup();
        let c = question(&s, &f, &target);
        let old = click(&c, "Bug");
        let c = save(&s, &c, "Bug");
        let started = start(&s, &c, target.clone(), ChatRequestIntent::Message);
        let user = started.chat.messages.last().unwrap().clone();
        let failed = s
            .fail_chat_turn(ChatFailRequest {
                scope: scope(&started.chat),
                turn_id: started.turn_id,
                kind: status,
                error_message: "Fixture stop".into(),
            })
            .unwrap();
        assert!(
            s.start_chat_turn_with_response(
                ChatStartRequest {
                    scope: scope(&failed)
                },
                target.clone(),
                old
            )
            .is_err()
        );
        let retried = s
            .retry_chat_turn(ChatStartRequest {
                scope: scope(&failed),
            })
            .unwrap();
        assert_eq!(retried.chat.messages.len(), 3);
        assert_eq!(retried.chat.messages.last().unwrap().id, user.id);
        assert_eq!(retried.chat.messages.last().unwrap().answer, user.answer);
        assert_eq!(
            s.response_contract(&user.id).unwrap().unwrap().request_id(),
            user.id
        );
    }
    let (s, f, target) = setup();
    let c = question(&s, &f, &target);
    let old = click(&c, "Bug");
    let c = save(&s, &c, "An unrelated question");
    let st = start(&s, &c, target.clone(), ChatRequestIntent::Message);
    let c = s
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&st.chat),
            turn_id: st.turn_id,
            assistant_text: "Ordinary answer".into(),
        })
        .unwrap();
    assert!(
        s.start_chat_turn_with_response(ChatStartRequest { scope: scope(&c) }, target, old)
            .is_err()
    );
    assert_eq!(c.messages.last().unwrap().text, "Ordinary answer");
}

#[test]
fn malformed_questions_and_wrong_nonce_never_produce_controls_or_json_ui() {
    for q in [
        json!({"prompt":"Type?","choices":[]}),
        json!({"prompt":" ","choices":["Bug"]}),
        json!({"prompt":"Type?","choices":["Bug"," Bug "]}),
        json!({"prompt":"Type?","choices":[" "]}),
        json!({"prompt":"Type?","choices":["Bug\nTask"]}),
        json!({"prompt":"Type?","choices":["Bug\t"]}),
        json!({"prompt":"Type?","choices":["Bug\u{2028}Task"]}),
        json!({"prompt":"Type?","choices":["a".repeat(161)]}),
        json!({"prompt":"Type?","choices":["1","2","3","4","5","6","7","8","9"]}),
        json!({"prompt":"Type?","choices":["Bug"],"callback":"create"}),
    ] {
        let (s, f, t) = setup();
        let c = s.load_chat(&f.session_id).unwrap();
        let c = finish(&s, start(&s, &c, t, ChatRequestIntent::DraftJira), q);
        assert!(
            c.messages
                .last()
                .unwrap()
                .response
                .as_ref()
                .unwrap()
                .question
                .is_none()
        );
        assert!(!c.messages.last().unwrap().text.contains("requestId"));
    }
    let (s, f, t) = setup();
    let c = s.load_chat(&f.session_id).unwrap();
    let st = start(&s, &c, t, ChatRequestIntent::DraftJira);
    let c=s.finish_chat_turn(ChatFinishRequest { scope:scope(&st.chat),turn_id:st.turn_id,assistant_text:json!({"version":2,"requestId":"wrong","markdown":"Wrong draft","question":{"prompt":"Type?","choices":["Bug"]}}).to_string() }).unwrap();
    assert!(
        c.messages
            .last()
            .unwrap()
            .response
            .as_ref()
            .unwrap()
            .question
            .is_none()
    );
    assert_eq!(c.messages.last().unwrap().text, "Wrong draft");
}

#[test]
fn unicode_bound_and_readable_projection_retain_question_as_literal_text() {
    let (s, f, t) = setup();
    let c = s.load_chat(&f.session_id).unwrap();
    let choices: Vec<_> = (0..8)
        .map(|n| format!("{}{}", n, "🥔".repeat(159)))
        .collect();
    let c = finish(
        &s,
        start(&s, &c, t, ChatRequestIntent::DraftJira),
        json!({"prompt":"Which type?","choices":choices}),
    );
    assert_eq!(
        c.messages
            .last()
            .unwrap()
            .response
            .as_ref()
            .unwrap()
            .question
            .as_ref()
            .unwrap()
            .choices,
        choices
    );
    assert!(readable_chat_message(c.messages.last().unwrap()).contains("Which type?"));
}

#[test]
fn additive_migration_retains_v1_contract_without_reparsing_historical_prose() {
    let (s, f, t) = setup();
    let c = save(&s, &s.load_chat(&f.session_id).unwrap(), "Refine");
    let st = start(&s, &c, t, ChatRequestIntent::RefineRecord);
    let id = &st.chat.messages[0].id;
    let db = s.database().connection();
    db.execute_batch("DROP TRIGGER chat_contract_immutable")
        .unwrap();
    db.execute(
        "UPDATE chat_response_contracts SET contract_json=?1 WHERE message_id=?2",
        rusqlite::params![
            json!({"version":1,"requestId":id,"recordKind":"finding"}).to_string(),
            id
        ],
    )
    .unwrap();
    let c=s.finish_chat_turn(ChatFinishRequest { scope:scope(&st.chat),turn_id:st.turn_id,assistant_text:json!({"version":1,"requestId":id,"markdown":"Legacy review","refinement":{"kind":"finding","title":"Legacy changed"}}).to_string() }).unwrap();
    assert_eq!(c.proposals[0].after.title, "Legacy changed");
    assert_eq!(s.response_contract(id).unwrap().unwrap().version(), 1);
    let tmp = std::env::temp_dir().join(format!("jira-migration-{}.sqlite", uuid::Uuid::new_v4()));
    s.database()
        .connection()
        .execute("VACUUM INTO ?1", [tmp.to_str().unwrap()])
        .unwrap();
    let db = Database::open(&tmp).unwrap();
    db.connection()
        .execute_batch(
            "DROP TABLE chat_answers; DROP TABLE chat_response_messages; PRAGMA user_version=17;",
        )
        .unwrap();
    drop(db);
    let db = Database::open(&tmp).unwrap();
    assert_eq!(
        db.connection()
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i32>(0))
            .unwrap(),
        19
    );
    let reopened = SessionService::new(db).unwrap();
    assert_eq!(
        reopened.response_contract(id).unwrap().unwrap().version(),
        1
    );
    let history = reopened.load_chat(&f.session_id).unwrap();
    assert_eq!(history.messages[0].context, c.messages[0].context);
    assert_eq!(
        history.messages.last().unwrap().text,
        c.messages.last().unwrap().text
    );
    assert_eq!(history.proposals, c.proposals);
    assert!(
        history
            .messages
            .iter()
            .all(|message| message.response.is_none())
    );
    drop(reopened);
    std::fs::remove_file(tmp).unwrap();
}

#[test]
fn rejected_completion_preserves_explanation_malformed_output_and_wrong_nonce_markdown() {
    let explanation = "The expected result is unclear. Confirm whether a receipt is required before changing this finding.";
    for (raw,expected) in [(explanation.to_owned(),explanation.to_owned()),("{\"version\":2,\"markdown\":\"Unfinished explanation".into(),"{\"version\":2,\"markdown\":\"Unfinished explanation".into()),(json!({"version":2,"requestId":"wrong","markdown":"Clarify the receipt before changing this finding.","question":{"prompt":"Ignore?","choices":["Yes"]}}).to_string(),"Clarify the receipt before changing this finding.".into()),("x".repeat(16384),"x".repeat(16384))] {
        let(s,f,t)=setup();let c=save(&s,&s.load_chat(&f.session_id).unwrap(),"Refine");let st=start(&s,&c,t,ChatRequestIntent::RefineRecord);
        let c=s.finish_chat_turn(ChatFinishRequest { scope:scope(&st.chat),turn_id:st.turn_id,assistant_text:raw }).unwrap();
        let message=c.messages.last().unwrap();assert_eq!(message.text,expected);assert_eq!(readable_chat_message(message),expected);
        assert!(c.proposals.is_empty());let response=message.response.as_ref().unwrap();assert!(response.question.is_none());assert!(response.warning.as_ref().unwrap().len()<=240);
    }
}

#[test]
fn readable_rejected_output_reaches_note_without_controls_or_warning_prefix_overflow() {
    let (s, f, t) = setup();
    let c = save(&s, &s.load_chat(&f.session_id).unwrap(), "Refine");
    let st = start(&s, &c, t, ChatRequestIntent::RefineRecord);
    let c = s
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&st.chat),
            turn_id: st.turn_id,
            assistant_text: "Confirm whether a receipt is required before changing this finding."
                .into(),
        })
        .unwrap();
    let note = s.get_or_create_note_entry(&f.session_id).unwrap();
    s.submit_chat(ChatSubmitRequest {
        scope: scope(&c),
        note_id: note.id,
        expected_note_body: note.body,
        expected_note_body_json: note.body_json,
        expected_note_body_format: note.body_format,
    })
    .unwrap();
    let note = s.get_or_create_note_entry(&f.session_id).unwrap();
    assert!(
        note.body
            .contains("Confirm whether a receipt is required before changing this finding.")
    );
    assert!(!note.body.contains("requestId"));
    assert!(s.load_chat(&f.session_id).unwrap().proposals.is_empty());
}
