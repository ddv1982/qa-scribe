use super::*;

#[test]
fn composer_and_mode_are_durable_and_stale_or_cross_session_mutations_fail() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let initial = service.load_chat(&id).unwrap();
    assert_eq!(initial.mode, ChatMode::WriteNote);
    assert!(initial.messages.is_empty());
    let saved = save(&service, &initial, "  exact composer\n");
    assert_eq!(saved.composer, "  exact composer\n");
    assert_eq!(saved.mode, ChatMode::Chat);
    assert_eq!(service.load_chat(&id).unwrap(), saved);
    assert!(saved.revision > initial.revision);
    validation(service.save_chat_composer(ChatComposerRequest {
        scope: scope(&initial),
        composer: "stale".into(),
        mode: ChatMode::WriteNote,
    }));
    let mut foreign = scope(&saved);
    foreign.session_id = session(&service);
    validation(service.start_chat_turn(ChatStartRequest { scope: foreign }));
    assert!(matches!(
        service.load_chat("missing"),
        Err(QaScribeError::NotFound(_))
    ));
    assert_eq!(service.load_chat(&id).unwrap(), saved);
}

#[test]
fn start_persists_user_before_execution_and_guards_one_active_turn_and_completion() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let chat = save(&service, &service.load_chat(&id).unwrap(), "User question");
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&chat),
        })
        .unwrap();
    let running = service.load_chat(&id).unwrap();
    assert_eq!(running, started.chat);
    assert_eq!(running.messages.len(), 1);
    assert_eq!(running.messages[0].role, ChatRole::User);
    assert_eq!(running.messages[0].text, "User question");
    assert_eq!(running.messages[0].turn_id, started.turn_id);
    assert_eq!(running.messages[0].status, ChatTurnStatus::Running);
    assert!(running.composer.is_empty());
    validation(service.start_chat_turn(ChatStartRequest {
        scope: scope(&running),
    }));
    validation(service.finish_chat_turn(ChatFinishRequest {
        scope: scope(&running),
        turn_id: "not-this-turn".into(),
        assistant_text: "Ignored".into(),
    }));
    validation(service.finish_chat_turn(ChatFinishRequest {
        scope: scope(&running),
        turn_id: started.turn_id.clone(),
        assistant_text: "   ".into(),
    }));
    let done = service
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&running),
            turn_id: started.turn_id.clone(),
            assistant_text: "Answer\nSecond line".into(),
        })
        .unwrap();
    assert_eq!(done.messages.len(), 2);
    assert_eq!(done.messages[1].role, ChatRole::Assistant);
    assert_eq!(done.messages[1].text, "Answer\nSecond line");
    assert!(
        done.messages
            .iter()
            .all(|m| m.status == ChatTurnStatus::Completed)
    );
    validation(service.finish_chat_turn(ChatFinishRequest {
        scope: scope(&done),
        turn_id: started.turn_id,
        assistant_text: "Duplicate".into(),
    }));
    assert_eq!(service.load_chat(&id).unwrap(), done);
}

#[test]
fn cancellation_and_failure_keep_user_history_and_reject_late_assistant() {
    for (kind, status) in [
        (ChatFailureKind::Cancelled, ChatTurnStatus::Cancelled),
        (ChatFailureKind::Failed, ChatTurnStatus::Failed),
    ] {
        let service = SessionService::in_memory().unwrap();
        let id = session(&service);
        let chat = save(&service, &service.load_chat(&id).unwrap(), "Retain me");
        let started = service
            .start_chat_turn(ChatStartRequest {
                scope: scope(&chat),
            })
            .unwrap();
        let failed = service
            .fail_chat_turn(ChatFailRequest {
                scope: scope(&started.chat),
                turn_id: started.turn_id.clone(),
                kind,
                error_message: "Provider stopped".into(),
            })
            .unwrap();
        assert_eq!(failed.messages.len(), 1);
        assert_eq!(failed.messages[0].status, status);
        assert_eq!(failed.messages[0].text, "Retain me");
        assert_eq!(
            failed.messages[0].error_message.as_deref(),
            Some("Provider stopped")
        );
        validation(service.finish_chat_turn(ChatFinishRequest {
            scope: scope(&failed),
            turn_id: started.turn_id,
            assistant_text: "Late".into(),
        }));
        let retry = complete(&service, &failed, "Retry explicitly", "Recovered");
        assert_eq!(retry.messages.len(), 3);
    }
}

#[test]
fn reopen_reconciles_running_turn_once_without_retry_and_preserves_composer() {
    let dir = helpers::unique_temp_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("chat.sqlite");
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let id = session(&service);
    let chat = save(&service, &service.load_chat(&id).unwrap(), "Question");
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&chat),
        })
        .unwrap();
    let running = save(&service, &started.chat, "Next unsent message");
    drop(service);
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let recovered = service.load_chat(&id).unwrap();
    assert_eq!(recovered.draft_id, running.draft_id);
    assert_eq!(recovered.composer, "Next unsent message");
    assert_eq!(recovered.mode, ChatMode::Chat);
    assert_eq!(recovered.messages.len(), 1);
    assert_eq!(recovered.messages[0].status, ChatTurnStatus::Interrupted);
    assert!(recovered.revision > running.revision);
    validation(service.finish_chat_turn(ChatFinishRequest {
        scope: scope(&recovered),
        turn_id: started.turn_id,
        assistant_text: "Old process".into(),
    }));
    drop(service);
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    assert_eq!(service.load_chat(&id).unwrap(), recovered);
    drop(service);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn blank_and_oversized_input_fail_without_consuming_revision() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let chat = service.load_chat(&id).unwrap();
    validation(service.start_chat_turn(ChatStartRequest {
        scope: scope(&chat),
    }));
    validation(service.save_chat_composer(ChatComposerRequest {
        scope: scope(&chat),
        composer: "x".repeat(100_001),
        mode: ChatMode::Chat,
    }));
    assert_eq!(service.load_chat(&id).unwrap(), chat);
}

#[test]
fn composer_edits_during_turn_require_current_revision_without_interrupting_execution() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let saved = save(&service, &service.load_chat(&id).unwrap(), "First question");
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&saved),
        })
        .unwrap();
    let updated = save(&service, &started.chat, "Next question");
    validation(service.finish_chat_turn(ChatFinishRequest {
        scope: scope(&started.chat),
        turn_id: started.turn_id.clone(),
        assistant_text: "Response".into(),
    }));
    assert_eq!(service.load_chat(&id).unwrap(), updated);
    let completed = service
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&updated),
            turn_id: started.turn_id,
            assistant_text: "Response".into(),
        })
        .unwrap();
    assert_eq!(completed.composer, "Next question");
    assert_eq!(completed.messages.len(), 2);
}
