use super::*;
use qa_scribe_core::domain::{
    AiProvider, AiRunCreate, ChatAssociateRunRequest, RequestedModel, RunModelSelection,
};

fn run(service: &SessionService, session_id: &str, turn_id: &str) -> String {
    service
        .create_ai_run(AiRunCreate {
            session_id: session_id.into(),
            generation_context_id: None,
            provider: AiProvider::CodexCli,
            model: "requested-model".into(),
            reasoning_effort: Some("high".into()),
            prompt_version: format!("session-chat-v1:{turn_id}"),
        })
        .unwrap()
        .id
}

fn associate(
    service: &SessionService,
    started: &qa_scribe_core::domain::ChatTurnStarted,
    id: &str,
) -> ChatState {
    service
        .associate_chat_turn_ai_run(ChatAssociateRunRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id.clone(),
            ai_run_id: id.into(),
        })
        .unwrap()
}

#[test]
fn retry_reuses_terminal_user_message_with_fresh_turn_id_and_no_duplicate() {
    for kind in [ChatFailureKind::Failed, ChatFailureKind::Cancelled] {
        let service = SessionService::in_memory().unwrap();
        let id = session(&service);
        let prior = complete(
            &service,
            &service.load_chat(&id).unwrap(),
            "First Q",
            "First A",
        );
        let saved = save(&service, &prior, "Retry this exact question\n");
        let started = service
            .start_chat_turn(ChatStartRequest {
                scope: scope(&saved),
            })
            .unwrap();
        let failed = service
            .fail_chat_turn(ChatFailRequest {
                scope: scope(&started.chat),
                turn_id: started.turn_id.clone(),
                kind,
                error_message: "Original failure".into(),
            })
            .unwrap();
        let retried = service
            .retry_chat_turn(ChatStartRequest {
                scope: scope(&failed),
            })
            .unwrap();
        assert_ne!(retried.turn_id, started.turn_id);
        assert_eq!(retried.chat.messages.len(), 3);
        assert_eq!(&retried.chat.messages[..2], &prior.messages[..]);
        let message = &retried.chat.messages[2];
        assert_eq!(message.id, failed.messages[2].id);
        assert_eq!(message.text, "Retry this exact question\n");
        assert_eq!(message.turn_id, retried.turn_id);
        assert_eq!(message.status, ChatTurnStatus::Running);
        assert!(message.error_message.is_none());
        assert!(message.ai_run_id.is_none());
        validation(service.finish_chat_turn(ChatFinishRequest {
            scope: scope(&retried.chat),
            turn_id: started.turn_id,
            assistant_text: "Late old response".into(),
        }));
        validation(service.retry_chat_turn(ChatStartRequest {
            scope: scope(&retried.chat),
        }));
        let done = service
            .finish_chat_turn(ChatFinishRequest {
                scope: scope(&retried.chat),
                turn_id: retried.turn_id,
                assistant_text: "Retried A".into(),
            })
            .unwrap();
        assert_eq!(done.messages.len(), 4);
        validation(service.retry_chat_turn(ChatStartRequest {
            scope: scope(&done),
        }));
    }
}

#[test]
fn retry_rejects_nonempty_composer_stale_revision_and_earlier_failed_tail() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let empty = service.load_chat(&id).unwrap();
    validation(service.retry_chat_turn(ChatStartRequest {
        scope: scope(&empty),
    }));
    let saved = save(&service, &empty, "Failed Q");
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&saved),
        })
        .unwrap();
    let failed = service
        .fail_chat_turn(ChatFailRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            kind: ChatFailureKind::Failed,
            error_message: "Error".into(),
        })
        .unwrap();
    let composed = save(&service, &failed, " ");
    validation(service.retry_chat_turn(ChatStartRequest {
        scope: scope(&failed),
    }));
    validation(service.retry_chat_turn(ChatStartRequest {
        scope: scope(&composed),
    }));
    assert_eq!(service.load_chat(&id).unwrap(), composed);
    let completed = complete(&service, &composed, "Different Q", "Different A");
    validation(service.retry_chat_turn(ChatStartRequest {
        scope: scope(&completed),
    }));
    assert_eq!(service.load_chat(&id).unwrap(), completed);
}

#[test]
fn restart_interrupted_user_is_explicitly_retryable_without_duplicate() {
    let dir = helpers::unique_temp_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("chat.sqlite");
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let id = session(&service);
    let saved = save(&service, &service.load_chat(&id).unwrap(), "Interrupted Q");
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&saved),
        })
        .unwrap();
    let run_id = run(&service, &id, &started.turn_id);
    associate(&service, &started, &run_id);
    drop(service);
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let interrupted = service.load_chat(&id).unwrap();
    assert_eq!(interrupted.messages[0].status, ChatTurnStatus::Interrupted);
    assert_eq!(
        interrupted.messages[0].ai_run_id.as_deref(),
        Some(run_id.as_str())
    );
    assert_eq!(
        service.get_ai_run(&run_id).unwrap().unwrap().provider,
        AiProvider::CodexCli
    );
    let retried = service
        .retry_chat_turn(ChatStartRequest {
            scope: scope(&interrupted),
        })
        .unwrap();
    assert_ne!(retried.turn_id, started.turn_id);
    assert_eq!(retried.chat.messages.len(), 1);
    assert_eq!(retried.chat.messages[0].id, interrupted.messages[0].id);
    assert_eq!(retried.chat.messages[0].status, ChatTurnStatus::Running);
    assert!(retried.chat.messages[0].ai_run_id.is_none());
    drop(service);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn atomic_finish_rolls_back_chat_and_model_if_ai_run_cannot_complete() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let saved = save(&service, &service.load_chat(&id).unwrap(), "Q");
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&saved),
        })
        .unwrap();
    let run_id = run(&service, &id, &started.turn_id);
    associate(&service, &started, &run_id);
    service.fail_ai_run(&run_id, "Already terminal").unwrap();
    let associated = service.load_chat(&id).unwrap();
    validation(
        service
            .finish_chat_turn_with_ai_run(
                ChatFinishRequest {
                    scope: scope(&associated),
                    turn_id: started.turn_id,
                    assistant_text: "Must not persist".into(),
                },
                &run_id,
            )
            .map(|_| ()),
    );
    assert_eq!(service.load_chat(&id).unwrap(), associated);
    let run = service.get_ai_run(&run_id).unwrap().unwrap();
    assert_eq!(run.status.as_str(), "failed");
    assert_eq!(
        run.model_selection,
        RunModelSelection::Recorded {
            requested: RequestedModel::Explicit {
                id: "requested-model".into()
            },
            reported: None
        }
    );
}

#[test]
fn atomic_finish_rejects_wrong_run_and_stale_chat_without_touching_run() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let saved = save(&service, &service.load_chat(&id).unwrap(), "Q");
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&saved),
        })
        .unwrap();
    let run_id = run(&service, &id, &started.turn_id);
    let associated = associate(&service, &started, &run_id);
    let foreign_session = session(&service);
    let wrong_id = run(&service, &foreign_session, &started.turn_id);
    validation(service.finish_chat_turn_with_ai_run(
        ChatFinishRequest {
            scope: scope(&associated),
            turn_id: started.turn_id.clone(),
            assistant_text: "Wrong run".into(),
        },
        &wrong_id,
    ));
    let edited = save(&service, &associated, "Next composer");
    validation(service.finish_chat_turn_with_ai_run(
        ChatFinishRequest {
            scope: scope(&associated),
            turn_id: started.turn_id,
            assistant_text: "Stale response".into(),
        },
        &run_id,
    ));
    assert_eq!(service.load_chat(&id).unwrap(), edited);
    for run_id in [run_id, wrong_id] {
        let run = service.get_ai_run(&run_id).unwrap().unwrap();
        assert_eq!(run.status.as_str(), "running");
        assert_eq!(
            run.model_selection,
            RunModelSelection::Recorded {
                requested: RequestedModel::Explicit {
                    id: "requested-model".into()
                },
                reported: None
            }
        );
    }
}

#[test]
fn atomic_failure_finishes_both_records_and_retry_detaches_previous_run() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let saved = save(&service, &service.load_chat(&id).unwrap(), "Q");
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&saved),
        })
        .unwrap();
    let run_id = run(&service, &id, &started.turn_id);
    let associated = associate(&service, &started, &run_id);
    let failed = service
        .fail_chat_turn_with_ai_run(
            ChatFailRequest {
                scope: scope(&associated),
                turn_id: started.turn_id,
                kind: ChatFailureKind::Cancelled,
                error_message: "Cancelled explicitly".into(),
            },
            &run_id,
        )
        .unwrap();
    assert_eq!(failed.messages[0].status, ChatTurnStatus::Cancelled);
    assert_eq!(
        failed.messages[0].ai_run_id.as_deref(),
        Some(run_id.as_str())
    );
    let ai_run = service.get_ai_run(&run_id).unwrap().unwrap();
    assert_eq!(ai_run.status.as_str(), "failed");
    assert_eq!(
        ai_run.error_message.as_deref(),
        Some("Cancelled explicitly")
    );
    let retried = service
        .retry_chat_turn(ChatStartRequest {
            scope: scope(&failed),
        })
        .unwrap();
    assert!(retried.chat.messages[0].ai_run_id.is_none());
    assert_eq!(service.get_ai_run(&run_id).unwrap().unwrap(), ai_run);
}

#[test]
fn association_rejects_foreign_terminal_and_replacement_runs_without_changing_chat() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let saved = save(&service, &service.load_chat(&id).unwrap(), "Q");
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&saved),
        })
        .unwrap();
    let other = session(&service);
    let foreign = run(&service, &other, &started.turn_id);
    validation(service.associate_chat_turn_ai_run(ChatAssociateRunRequest {
        scope: scope(&started.chat),
        turn_id: started.turn_id.clone(),
        ai_run_id: foreign,
    }));
    let terminal = run(&service, &id, &started.turn_id);
    service.complete_ai_run(&terminal).unwrap();
    validation(service.associate_chat_turn_ai_run(ChatAssociateRunRequest {
        scope: scope(&started.chat),
        turn_id: started.turn_id.clone(),
        ai_run_id: terminal,
    }));
    assert_eq!(service.load_chat(&id).unwrap(), started.chat);
    let associated_id = run(&service, &id, &started.turn_id);
    let associated = associate(&service, &started, &associated_id);
    let replacement = run(&service, &id, &started.turn_id);
    validation(service.associate_chat_turn_ai_run(ChatAssociateRunRequest {
        scope: scope(&associated),
        turn_id: started.turn_id,
        ai_run_id: replacement,
    }));
    assert_eq!(service.load_chat(&id).unwrap(), associated);
}

#[test]
fn atomic_failure_rolls_back_if_run_has_already_completed() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let saved = save(&service, &service.load_chat(&id).unwrap(), "Q");
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&saved),
        })
        .unwrap();
    let run_id = run(&service, &id, &started.turn_id);
    associate(&service, &started, &run_id);
    let completed = service.complete_ai_run(&run_id).unwrap();
    let associated = service.load_chat(&id).unwrap();
    validation(service.fail_chat_turn_with_ai_run(
        ChatFailRequest {
            scope: scope(&associated),
            turn_id: started.turn_id,
            kind: ChatFailureKind::Failed,
            error_message: "Must not persist".into(),
        },
        &run_id,
    ));
    assert_eq!(service.load_chat(&id).unwrap(), associated);
    assert_eq!(service.get_ai_run(&run_id).unwrap().unwrap(), completed);
}

#[test]
fn ai_run_write_failure_rolls_back_already_written_chat_completion_and_failure() {
    for completing in [true, false] {
        let service = SessionService::in_memory().unwrap();
        let id = session(&service);
        let saved = save(&service, &service.load_chat(&id).unwrap(), "Q");
        let started = service
            .start_chat_turn(ChatStartRequest {
                scope: scope(&saved),
            })
            .unwrap();
        let run_id = run(&service, &id, &started.turn_id);
        let associated = associate(&service, &started, &run_id);
        let initial_run = service.get_ai_run(&run_id).unwrap().unwrap();
        service.database().connection().execute_batch(
            "CREATE TRIGGER reject_chat_run_transition BEFORE UPDATE OF status ON ai_runs
             WHEN NEW.status <> 'running' BEGIN SELECT RAISE(ABORT, 'injected run write failure'); END;"
        ).unwrap();
        let result = if completing {
            service.finish_chat_turn_with_ai_run(
                ChatFinishRequest {
                    scope: scope(&associated),
                    turn_id: started.turn_id,
                    assistant_text: "Must roll back".into(),
                },
                &run_id,
            )
        } else {
            service.fail_chat_turn_with_ai_run(
                ChatFailRequest {
                    scope: scope(&associated),
                    turn_id: started.turn_id,
                    kind: ChatFailureKind::Failed,
                    error_message: "Must roll back".into(),
                },
                &run_id,
            )
        };
        assert!(result.is_err());
        assert_eq!(service.load_chat(&id).unwrap(), associated);
        assert_eq!(service.get_ai_run(&run_id).unwrap().unwrap(), initial_run);
    }
}

#[test]
fn associated_turn_requires_atomic_lifecycle_and_session_delete_cascades_submitted_history() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let saved = save(&service, &service.load_chat(&id).unwrap(), "Q");
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&saved),
        })
        .unwrap();
    let run_id = run(&service, &id, &started.turn_id);
    let associated = associate(&service, &started, &run_id);
    validation(service.finish_chat_turn(ChatFinishRequest {
        scope: scope(&associated),
        turn_id: started.turn_id.clone(),
        assistant_text: "Unsafe split finish".into(),
    }));
    validation(service.fail_chat_turn(ChatFailRequest {
        scope: scope(&associated),
        turn_id: started.turn_id.clone(),
        kind: ChatFailureKind::Failed,
        error_message: "Unsafe split failure".into(),
    }));
    assert_eq!(service.load_chat(&id).unwrap(), associated);
    let completed = service
        .finish_chat_turn_with_ai_run(
            ChatFinishRequest {
                scope: scope(&associated),
                turn_id: started.turn_id,
                assistant_text: "A".into(),
            },
            &run_id,
        )
        .unwrap();
    let note = service.get_or_create_note_entry(&id).unwrap();
    service
        .submit_chat(submit_request(&completed, &note))
        .unwrap();
    service.delete_session(&id).unwrap();
    for table in ["chat_messages", "chat_drafts", "ai_runs"] {
        assert_eq!(
            helpers::count_rows(service.database().connection(), table),
            0
        );
    }
    helpers::assert_no_foreign_key_violations(service.database().connection());
}

#[path = "model_evidence.rs"]
mod model_evidence;
