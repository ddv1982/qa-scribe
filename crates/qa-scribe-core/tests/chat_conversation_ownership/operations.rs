use super::*;

#[test]
fn fresh_record_launches_and_replay_leave_notes_unchanged() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let notes = service.load_chat(&id).unwrap();
    let notes = service
        .save_chat_composer(composer(
            &notes,
            "Keep Notes input",
            ChatComposerIntent::Message,
        ))
        .unwrap();
    let record = finding(&service, &id);
    let request = launch(&id, &record);
    let first = service.begin_record_chat(request.clone()).unwrap();
    assert_eq!(
        first.owner,
        ConversationOwner::Record {
            session_id: id.clone(),
            record: record.clone()
        }
    );
    assert_eq!(first.draft_id, request.draft_id);
    assert_eq!(
        (
            first.composer.as_str(),
            first.mode,
            first.revision,
            first.messages.len(),
            first.composer_images.len()
        ),
        ("", ChatMode::Chat, 0, 0, 0)
    );
    let first = service
        .save_chat_composer(composer(
            &first,
            "Refine later",
            ChatComposerIntent::RefineRecord,
        ))
        .unwrap();
    let second = service.begin_record_chat(launch(&id, &record)).unwrap();
    assert_ne!(first.draft_id, second.draft_id);
    assert_eq!(service.begin_record_chat(request).unwrap(), first);
    assert_eq!(service.load_chat(&id).unwrap(), notes);
    let history = service
        .list_chat_history(ChatHistoryScope::Record {
            session_id: id,
            record,
        })
        .unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(
        history
            .iter()
            .filter(|h| h.has_content)
            .map(|h| h.reference.draft_id.clone())
            .collect::<Vec<_>>(),
        vec![first.draft_id]
    );
}

#[test]
fn replay_precedes_live_source_validation_and_never_activates() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let record = finding(&service, &id);
    let request = launch(&id, &record);
    let chat = service.begin_record_chat(request.clone()).unwrap();
    let ConversationRecord::Finding { record_id } = &record else {
        unreachable!()
    };
    service
        .database()
        .connection()
        .execute("DELETE FROM findings WHERE id=?1", [record_id])
        .unwrap();
    assert_eq!(service.begin_record_chat(request.clone()).unwrap(), chat);
    assert_eq!(service.read_chat(&reference(&chat)).unwrap(), chat);
    assert!(service.begin_record_chat(launch(&id, &record)).is_err());
    let history = service
        .list_chat_history(ChatHistoryScope::Record {
            session_id: id.clone(),
            record,
        })
        .unwrap();
    assert_eq!(history[0].reference, reference(&chat));
    assert_eq!(history[0].last_active_order, chat.last_active_order);
    let other = finding(&service, &id);
    assert!(
        service
            .begin_record_chat(BeginRecordChatRequest {
                record: other,
                ..request.clone()
            })
            .is_err()
    );
    let foreign = session(&service);
    assert!(
        service
            .begin_record_chat(BeginRecordChatRequest {
                session_id: foreign.clone(),
                ..request
            })
            .is_err()
    );
    assert!(
        service
            .read_chat(&ChatRef {
                session_id: foreign,
                draft_id: chat.draft_id.clone()
            })
            .is_err()
    );
    assert_eq!(service.read_chat(&reference(&chat)).unwrap(), chat);
}

#[test]
fn new_launch_rejects_foreign_missing_wrong_kind_and_invalid_ids_without_rows() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let foreign = session(&service);
    let record = finding(&service, &foreign);
    assert!(service.begin_record_chat(launch(&id, &record)).is_err());
    assert!(
        service
            .begin_record_chat(launch(
                &id,
                &ConversationRecord::Finding {
                    record_id: "missing".into()
                }
            ))
            .is_err()
    );
    let record = finding(&service, &id);
    let ConversationRecord::Finding { record_id } = &record else {
        unreachable!()
    };
    assert!(
        service
            .begin_record_chat(launch(
                &id,
                &ConversationRecord::TestCasesDraft {
                    record_id: record_id.clone()
                }
            ))
            .is_err()
    );
    service.database().connection().execute("INSERT INTO drafts(id,session_id,kind,title,body,created_at,updated_at) VALUES ('report',?1,'session_report','Report','','t','t')", [&id]).unwrap();
    assert!(
        service
            .begin_record_chat(launch(
                &id,
                &ConversationRecord::TestCasesDraft {
                    record_id: "report".into()
                }
            ))
            .is_err()
    );
    assert!(
        service
            .begin_record_chat(BeginRecordChatRequest {
                draft_id: "invalid".into(),
                ..launch(&id, &record)
            })
            .is_err()
    );
    assert_eq!(
        service
            .list_chat_history(ChatHistoryScope::Session { session_id: id })
            .unwrap(),
        vec![]
    );
}

#[test]
fn explicit_activation_orders_history_without_revision_changes_or_background_activity() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let record = finding(&service, &id);
    let first = service.begin_record_chat(launch(&id, &record)).unwrap();
    let first = service
        .save_chat_composer(composer(&first, "First", ChatComposerIntent::Message))
        .unwrap();
    let second = service.begin_record_chat(launch(&id, &record)).unwrap();
    let activated = service.activate_chat(&reference(&first)).unwrap();
    assert_eq!(activated.revision, first.revision);
    assert_eq!(activated.composer, "First");
    assert!(activated.last_active_order > second.last_active_order);
    assert_eq!(service.read_chat(&reference(&second)).unwrap(), second);
    let history = service
        .list_chat_history(ChatHistoryScope::Session { session_id: id })
        .unwrap();
    assert_eq!(
        history
            .iter()
            .map(|h| h.reference.draft_id.as_str())
            .collect::<Vec<_>>(),
        vec![first.draft_id.as_str(), second.draft_id.as_str()]
    );
    let started = service
        .start_chat_turn_with_context(
            ChatStartRequest {
                scope: scope(&activated),
            },
            owned_context(&activated),
        )
        .unwrap();
    let order = started.chat.last_active_order;
    let finished = service
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            assistant_text: "Background completion".into(),
        })
        .unwrap();
    assert_eq!(finished.last_active_order, order);
}

#[test]
fn intent_survives_edits_clearing_and_reopen_until_explicit_reset_or_committed_turn() {
    let (dir, service) = frozen_service();
    let chat = service.load_chat("perf-session").unwrap();
    let chat = service
        .save_chat_composer(composer(&chat, "Prepared", ChatComposerIntent::DraftJira))
        .unwrap();
    let chat = service
        .save_chat_composer(composer(&chat, "", ChatComposerIntent::DraftJira))
        .unwrap();
    let r = reference(&chat);
    drop(service);
    let service =
        SessionService::new(Database::open(dir.join("qa-scribe.sqlite")).unwrap()).unwrap();
    assert_eq!(service.read_chat(&r).unwrap(), chat);
    let reset = service
        .save_chat_composer(composer(&chat, "", ChatComposerIntent::Message))
        .unwrap();
    assert_eq!(reset.composer_intent, ChatComposerIntent::Message);
    let ready = service
        .save_chat_composer(composer(
            &reset,
            "Send once",
            ChatComposerIntent::RefineRecord,
        ))
        .unwrap();
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&ready),
        })
        .unwrap();
    assert_eq!(started.chat.composer_intent, ChatComposerIntent::Message);
    assert_eq!(started.chat.composer, "");
    assert_eq!(started.chat.messages.last().unwrap().text, "Send once");
    drop(service);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn old_requests_default_to_message_and_correlated_operations_cannot_be_prepared() {
    let raw = serde_json::json!({"scope":{"sessionId":"s","draftId":"d","expectedRevision":0},"composer":"text","mode":"chat"});
    let parsed: ChatComposerRequest = serde_json::from_value(raw.clone()).unwrap();
    assert_eq!(parsed.intent, ChatComposerIntent::Message);
    for kind in ["retry", "question_reply"] {
        let mut raw = raw.clone();
        raw["intent"] = serde_json::json!({"kind":kind});
        assert!(serde_json::from_value::<ChatComposerRequest>(raw).is_err());
    }
}

#[test]
fn record_only_session_still_gets_its_own_notes_singleton_and_launch_rollback_is_atomic() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let record = finding(&service, &id);
    let first = service.begin_record_chat(launch(&id, &record)).unwrap();
    let notes = service.load_chat(&id).unwrap();
    assert_ne!(notes.draft_id, first.draft_id);
    assert_eq!(
        notes.owner,
        ConversationOwner::Notes {
            session_id: id.clone()
        }
    );
    assert_eq!(notes.mode, ChatMode::WriteNote);
    assert_eq!(service.load_chat(&id).unwrap(), notes);
    let request = launch(&id, &record);
    let connection = service.database().connection();
    connection.execute_batch("CREATE TRIGGER fail_launch_activity BEFORE UPDATE OF last_active_at ON chat_drafts BEGIN SELECT RAISE(ABORT,'injected launch failure'); END").unwrap();
    let error = service.begin_record_chat(request.clone()).unwrap_err();
    assert!(error.to_string().contains("injected launch failure"));
    assert!(
        service
            .read_chat(&ChatRef {
                session_id: id.clone(),
                draft_id: request.draft_id.clone()
            })
            .is_err()
    );
    assert_eq!(service.load_chat(&id).unwrap(), notes);
    assert_eq!(service.read_chat(&reference(&first)).unwrap(), first);
    connection
        .execute_batch("DROP TRIGGER fail_launch_activity")
        .unwrap();
    let committed = service.begin_record_chat(request).unwrap();
    assert_eq!(committed.last_active_order, notes.last_active_order + 1);
}

#[test]
fn test_cases_owner_is_typed_and_archived_launch_replay_is_an_exact_read() {
    let (dir, service) = frozen_service();
    let record = ConversationRecord::TestCasesDraft {
        record_id: "isolation-mixed-tests".into(),
    };
    let request = launch("isolation-mixed", &record);
    let chat = service.begin_record_chat(request.clone()).unwrap();
    assert_eq!(
        chat.owner,
        ConversationOwner::Record {
            session_id: "isolation-mixed".into(),
            record: record.clone()
        }
    );
    let c = service.database().connection();
    c.execute(
        "UPDATE chat_drafts SET archived=1 WHERE id=?1",
        [&chat.draft_id],
    )
    .unwrap();
    c.execute("DELETE FROM drafts WHERE id='isolation-mixed-tests'", [])
        .unwrap();
    let archived = service.read_chat(&reference(&chat)).unwrap();
    assert!(archived.archived);
    assert_eq!(service.begin_record_chat(request).unwrap(), archived);
    assert!(
        service
            .begin_record_chat(launch("isolation-mixed", &record))
            .is_err()
    );
    assert_eq!(
        service.load_chat("isolation-mixed").unwrap().draft_id,
        "isolation-mixed-chat"
    );
    drop(service);
    std::fs::remove_dir_all(dir).unwrap();
}
