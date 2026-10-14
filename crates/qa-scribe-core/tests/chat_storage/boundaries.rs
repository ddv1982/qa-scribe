use super::*;

const MESSAGE_BYTES: usize = 16_384;
const DRAFT_BYTES: usize = 131_072;

fn failed_send(service: &SessionService, chat: &ChatState, text: &str) -> ChatState {
    let saved = save(service, chat, text);
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&saved),
        })
        .unwrap();
    service
        .fail_chat_turn(ChatFailRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            kind: ChatFailureKind::Failed,
            error_message: "Provider failed".into(),
        })
        .unwrap()
}

fn reject_submission_unchanged(service: &SessionService, chat: &ChatState, note: &Entry) {
    validation(service.submit_chat(submit_request(chat, note)));
    assert_eq!(service.load_chat(&chat.session_id).unwrap(), *chat);
    assert!(
        service
            .load_chat(&chat.session_id)
            .unwrap()
            .submission
            .is_none()
    );
    assert_eq!(
        service.get_or_create_note_entry(&chat.session_id).unwrap(),
        *note
    );
}

#[test]
fn r20_01_assistant_message_limit_is_utf8_bytes_and_accepts_exact_boundary() {
    for text in ["x".repeat(MESSAGE_BYTES + 1), "é".repeat(8_193)] {
        let service = SessionService::in_memory().unwrap();
        let id = session(&service);
        let saved = save(&service, &service.load_chat(&id).unwrap(), "Q");
        let started = service
            .start_chat_turn(ChatStartRequest {
                scope: scope(&saved),
            })
            .unwrap();
        assert!(text.len() > MESSAGE_BYTES);
        validation(service.finish_chat_turn(ChatFinishRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            assistant_text: text,
        }));
        assert_eq!(service.load_chat(&id).unwrap(), started.chat);
    }
    for text in ["x".repeat(MESSAGE_BYTES), "é".repeat(8_192)] {
        let service = SessionService::in_memory().unwrap();
        let id = session(&service);
        let chat = complete(&service, &service.load_chat(&id).unwrap(), "Q", &text);
        assert_eq!(text.len(), MESSAGE_BYTES);
        assert_eq!(chat.messages[1].text, text);
        assert_eq!(chat.messages[1].status, ChatTurnStatus::Completed);
    }
}

#[test]
fn r20_01_completion_aggregate_includes_failed_text_and_accepts_exact_byte_cap() {
    for extra in [0, 1] {
        let service = SessionService::in_memory().unwrap();
        let id = session(&service);
        let mut chat = service.load_chat(&id).unwrap();
        for _ in 0..7 {
            chat = failed_send(&service, &chat, &"x".repeat(MESSAGE_BYTES));
        }
        let saved = save(&service, &chat, "Q");
        let started = service
            .start_chat_turn(ChatStartRequest {
                scope: scope(&saved),
            })
            .unwrap();
        let response = "a".repeat(MESSAGE_BYTES - 1 + extra);
        let result = service.finish_chat_turn(ChatFinishRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            assistant_text: response,
        });
        if extra == 0 {
            let completed = result.unwrap();
            assert_eq!(
                completed
                    .messages
                    .iter()
                    .map(|m| m.text.len())
                    .sum::<usize>(),
                DRAFT_BYTES
            );
        } else {
            validation(result);
            assert_eq!(service.load_chat(&id).unwrap(), started.chat);
        }
    }
}

#[test]
fn r20_02_oversized_composer_remains_durable_but_send_rejects_without_mutation() {
    for text in ["x".repeat(MESSAGE_BYTES + 1), "é".repeat(8_193)] {
        let service = SessionService::in_memory().unwrap();
        let id = session(&service);
        let saved = save(&service, &service.load_chat(&id).unwrap(), &text);
        validation(service.start_chat_turn(ChatStartRequest {
            scope: scope(&saved),
        }));
        assert_eq!(service.load_chat(&id).unwrap(), saved);
        assert_eq!(saved.composer, text);
        assert!(saved.messages.is_empty());
    }
    for text in ["x".repeat(MESSAGE_BYTES), "é".repeat(8_192)] {
        let service = SessionService::in_memory().unwrap();
        let id = session(&service);
        let saved = save(&service, &service.load_chat(&id).unwrap(), &text);
        let started = service
            .start_chat_turn(ChatStartRequest {
                scope: scope(&saved),
            })
            .unwrap();
        assert_eq!(started.chat.messages[0].text, text);
        assert!(started.chat.composer.is_empty());
    }
}

#[test]
fn r20_02_failed_messages_count_toward_limit_and_start_reserves_assistant_slot() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let mut chat = service.load_chat(&id).unwrap();
    for _ in 0..127 {
        chat = failed_send(&service, &chat, "Q");
    }
    assert_eq!(chat.messages.len(), 127);
    let saved = save(&service, &chat, "Keep unsent");
    validation(service.start_chat_turn(ChatStartRequest {
        scope: scope(&saved),
    }));
    assert_eq!(service.load_chat(&id).unwrap(), saved);
    let cleared = save(&service, &saved, "");
    let retried = service
        .retry_chat_turn(ChatStartRequest {
            scope: scope(&cleared),
        })
        .unwrap();
    assert_eq!(retried.chat.messages.len(), 127);
    let finished = service
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&retried.chat),
            turn_id: retried.turn_id,
            assistant_text: "A".into(),
        })
        .unwrap();
    assert_eq!(finished.messages.len(), 128);
    let saved = save(&service, &finished, "Still unsent");
    validation(service.start_chat_turn(ChatStartRequest {
        scope: scope(&saved),
    }));
    assert_eq!(service.load_chat(&id).unwrap(), saved);
}

#[test]
fn r20_02_failed_text_counts_toward_start_aggregate_limit_in_utf8_bytes() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let mut chat = service.load_chat(&id).unwrap();
    for _ in 0..8 {
        chat = failed_send(&service, &chat, &"é".repeat(8_192));
    }
    assert_eq!(
        chat.messages.iter().map(|m| m.text.len()).sum::<usize>(),
        DRAFT_BYTES
    );
    let saved = save(&service, &chat, "x");
    validation(service.start_chat_turn(ChatStartRequest {
        scope: scope(&saved),
    }));
    assert_eq!(service.load_chat(&id).unwrap(), saved);
}

#[test]
fn r20_03_completed_pair_with_unsent_composer_cannot_be_submitted() {
    for composer in ["Unsent question", " "] {
        let service = SessionService::in_memory().unwrap();
        let id = session(&service);
        let note = service.get_or_create_note_entry(&id).unwrap();
        let completed = complete(&service, &service.load_chat(&id).unwrap(), "Q", "A");
        let saved = save(&service, &completed, composer);
        reject_submission_unchanged(&service, &saved, &note);
        let cleared = save(&service, &saved, "");
        service
            .submit_chat(submit_request(&cleared, &note))
            .unwrap();
    }
}

#[test]
fn r20_03_completed_pair_with_failed_or_cancelled_tail_stays_retryable() {
    for kind in [ChatFailureKind::Failed, ChatFailureKind::Cancelled] {
        let service = SessionService::in_memory().unwrap();
        let id = session(&service);
        let note = service.get_or_create_note_entry(&id).unwrap();
        let completed = complete(&service, &service.load_chat(&id).unwrap(), "Q1", "A1");
        let saved = save(&service, &completed, "Q2");
        let started = service
            .start_chat_turn(ChatStartRequest {
                scope: scope(&saved),
            })
            .unwrap();
        reject_submission_unchanged(&service, &started.chat, &note);
        let failed = service
            .fail_chat_turn(ChatFailRequest {
                scope: scope(&started.chat),
                turn_id: started.turn_id,
                kind,
                error_message: "Stopped".into(),
            })
            .unwrap();
        reject_submission_unchanged(&service, &failed, &note);
        let retried = service
            .retry_chat_turn(ChatStartRequest {
                scope: scope(&failed),
            })
            .unwrap();
        let finished = service
            .finish_chat_turn(ChatFinishRequest {
                scope: scope(&retried.chat),
                turn_id: retried.turn_id,
                assistant_text: "A2".into(),
            })
            .unwrap();
        service
            .submit_chat(submit_request(&finished, &note))
            .unwrap();
    }
}

#[test]
fn r20_03_failed_earlier_message_cannot_be_sealed_by_later_completed_pair() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let note = service.get_or_create_note_entry(&id).unwrap();
    let failed = failed_send(&service, &service.load_chat(&id).unwrap(), "Failed earlier");
    let completed = complete(&service, &failed, "Later Q", "Later A");
    reject_submission_unchanged(&service, &completed, &note);
    let restarted = service
        .restart_chat(ChatRestartRequest {
            scope: scope(&completed),
        })
        .unwrap();
    assert_ne!(restarted.draft_id, completed.draft_id);
    assert!(restarted.messages.is_empty());
    assert_eq!(
        helpers::count_rows(service.database().connection(), "chat_messages"),
        3
    );
    assert_eq!(service.get_or_create_note_entry(&id).unwrap(), note);
}

#[test]
fn r20_03_interrupted_tail_cannot_be_submitted_after_reopen_but_can_retry() {
    let dir = helpers::unique_temp_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("chat.sqlite");
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let id = session(&service);
    let note = service.get_or_create_note_entry(&id).unwrap();
    let completed = complete(&service, &service.load_chat(&id).unwrap(), "Q1", "A1");
    let saved = save(&service, &completed, "Q2");
    service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&saved),
        })
        .unwrap();
    drop(service);
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let interrupted = service.load_chat(&id).unwrap();
    assert_eq!(interrupted.messages[2].status, ChatTurnStatus::Interrupted);
    reject_submission_unchanged(&service, &interrupted, &note);
    let retry = service
        .retry_chat_turn(ChatStartRequest {
            scope: scope(&interrupted),
        })
        .unwrap();
    assert_eq!(retry.chat.messages.len(), 3);
    assert_eq!(retry.chat.messages[2].status, ChatTurnStatus::Running);
    drop(service);
    std::fs::remove_dir_all(dir).unwrap();
}
