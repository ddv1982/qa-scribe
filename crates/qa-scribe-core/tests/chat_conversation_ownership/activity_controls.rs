use super::*;
use qa_scribe_core::attachments::chat::PreparedChatImageImport;

#[test]
fn rejected_imports_and_import_recovery_replays_preserve_activity_and_images() {
    for kind in Kind::ALL {
        let f = Fixture::new(kind);
        let a = f.save(&f.a, "Earlier input");
        let b = f.other();
        assert!(f.import(&f.a).is_err());
        assert_eq!(f.read(&a), a);
        let imported = f.import(&a).unwrap();
        let prepared =
            PreparedChatImageImport::decode(scope(&imported), "cancelled.png".into(), &image_url())
                .unwrap();
        prepared.reserve(&f.service).unwrap();
        prepared.write(&f.root.0).unwrap();
        assert_eq!(f.read(&imported), imported);
        prepared.recover(&f.service, &f.root.0).unwrap();
        prepared.recover(&f.service, &f.root.0).unwrap();
        assert_eq!(f.read(&imported), imported);
        let committed =
            PreparedChatImageImport::decode(scope(&imported), "committed.png".into(), &image_url())
                .unwrap();
        committed.reserve(&f.service).unwrap();
        committed.write(&f.root.0).unwrap();
        let result = committed.commit(&f.service).unwrap();
        committed.recover(&f.service, &f.root.0).unwrap();
        committed.recover(&f.service, &f.root.0).unwrap();
        assert_eq!(f.read(&result), result);
        assert_eq!(result.composer_images.len(), 2);
        assert_eq!(result.composer_images[1].filename, "committed.png");
        assert_eq!(activity(&f.read(&b)), activity(&b));
        assert!(
            PreparedChatImageImport::decode(
                scope(&result),
                "invalid.png".into(),
                "data:image/png;base64,AA=="
            )
            .is_err()
        );
        assert_eq!(f.read(&result), result);
    }
}

#[test]
fn rejected_and_stale_retries_preserve_turn_and_activity() {
    for kind in Kind::ALL {
        let f = Fixture::new(kind);
        let failed = f.failed();
        let b = f.other();
        assert!(
            f.service
                .retry_chat_turn(ChatStartRequest { scope: scope(&f.a) })
                .is_err()
        );
        assert_eq!(f.read(&failed), failed);
        let occupied = f.save(&failed, "Unsent input");
        assert!(
            f.service
                .retry_chat_turn(ChatStartRequest {
                    scope: scope(&occupied)
                })
                .is_err()
        );
        assert_eq!(f.read(&occupied), occupied);
        let ready = f.save(&occupied, "");
        let retried = f
            .service
            .retry_chat_turn(ChatStartRequest {
                scope: scope(&ready),
            })
            .unwrap();
        assert!(
            f.service
                .retry_chat_turn(ChatStartRequest {
                    scope: scope(&retried.chat)
                })
                .is_err()
        );
        assert_eq!(f.read(&retried.chat), retried.chat);
        assert_eq!(f.read(&b), b);
    }
}

#[test]
fn failed_activity_write_rolls_back_image_import_and_explicit_retry() {
    for kind in Kind::ALL {
        let f = Fixture::new(kind);
        let a = f.save(&f.a, "Earlier input");
        let b = f.other();
        f.fail_activity();
        let error = f.import(&a).unwrap_err();
        assert!(error.to_string().contains("Injected activity failure"));
        assert_eq!(f.read(&a), a);
        assert_eq!(f.service.list_attachments(&f.id).unwrap().len(), 0);
        assert_eq!(f.read(&b), b);
        f.allow_activity();
        let failed = f.failed();
        let b = f.other();
        f.fail_activity();
        let error = f
            .service
            .retry_chat_turn(ChatStartRequest {
                scope: scope(&failed),
            })
            .unwrap_err();
        assert!(error.to_string().contains("Injected activity failure"));
        assert_eq!(f.read(&failed), failed);
        assert_eq!(failed.messages[0].status, ChatTurnStatus::Failed);
        assert_eq!(f.read(&b), b);
        f.allow_activity();
    }
}

#[test]
fn background_association_completion_failure_and_startup_do_not_reorder_history() {
    for kind in Kind::ALL {
        let f = Fixture::new(kind);
        let a = f.save(&f.a, "Literal question");
        let started = f
            .service
            .start_chat_turn(ChatStartRequest { scope: scope(&a) })
            .unwrap();
        let b = f.other();
        let run = f
            .service
            .create_ai_run(AiRunCreate {
                session_id: f.id.clone(),
                generation_context_id: None,
                provider: AiProvider::CodexCli,
                model: "fixture-model".into(),
                reasoning_effort: None,
                prompt_version: "activity-fixture".into(),
            })
            .unwrap();
        let associated = f
            .service
            .associate_chat_turn_ai_run(ChatAssociateRunRequest {
                scope: scope(&started.chat),
                turn_id: started.turn_id.clone(),
                ai_run_id: run.id.clone(),
            })
            .unwrap();
        assert_eq!(activity(&associated), activity(&started.chat));
        let failed = f
            .service
            .fail_chat_turn_with_ai_run(
                ChatFailRequest {
                    scope: scope(&associated),
                    turn_id: started.turn_id,
                    kind: ChatFailureKind::Failed,
                    error_message: "Background failure".into(),
                },
                &run.id,
            )
            .unwrap();
        assert_eq!(activity(&failed), activity(&started.chat));
        assert_eq!(failed.messages[0].status, ChatTurnStatus::Failed);
        f.history([&b.draft_id, &failed.draft_id], [5, 4]);
        let retried = f
            .service
            .retry_chat_turn(ChatStartRequest {
                scope: scope(&failed),
            })
            .unwrap();
        let b = f.other();
        let completed = f
            .service
            .finish_chat_turn(ChatFinishRequest {
                scope: scope(&retried.chat),
                turn_id: retried.turn_id,
                assistant_text: "Background answer".into(),
            })
            .unwrap();
        assert_eq!(activity(&completed), activity(&retried.chat));
        assert_eq!(
            completed
                .messages
                .iter()
                .map(|m| (m.role, m.text.as_str(), m.status))
                .collect::<Vec<_>>(),
            vec![
                (
                    ChatRole::User,
                    "Literal question",
                    ChatTurnStatus::Completed
                ),
                (
                    ChatRole::Assistant,
                    "Background answer",
                    ChatTurnStatus::Completed
                )
            ]
        );
        f.history([&b.draft_id, &completed.draft_id], [7, 6]);
        let next = f.save(&completed, "Interrupted question");
        let running = f
            .service
            .start_chat_turn(ChatStartRequest {
                scope: scope(&next),
            })
            .unwrap();
        let b = f.other();
        let before = activity(&running.chat);
        let r = reference(&running.chat);
        let id = f.id.clone();
        let record = f.record.clone();
        drop(f.service);
        let service =
            SessionService::new(Database::open(f.root.0.join("activity.sqlite")).unwrap()).unwrap();
        let interrupted = service.read_chat(&r).unwrap();
        assert_eq!(activity(&interrupted), before);
        assert_eq!(
            interrupted.messages.last().unwrap().status,
            ChatTurnStatus::Interrupted
        );
        let entries = service
            .list_chat_history(ChatHistoryScope::Record {
                session_id: id,
                record,
            })
            .unwrap();
        assert_eq!(
            entries
                .iter()
                .map(|e| e.reference.draft_id.as_str())
                .collect::<Vec<_>>(),
            vec![b.draft_id.as_str(), r.draft_id.as_str()]
        );
        assert_eq!(service.read_chat(&reference(&b)).unwrap(), b);
        drop(service);
    }
}

#[test]
fn reads_launch_replay_equal_save_and_preflight_checks_do_not_reorder_activity() {
    for kind in Kind::ALL {
        let f = Fixture::new(kind);
        let a = f.save(&f.a, "Earlier input");
        let b = f.other();
        assert_eq!(f.read(&a), a);
        assert_eq!(f.save(&a, "Earlier input"), a);
        assert_eq!(
            f.service
                .begin_record_chat(BeginRecordChatRequest {
                    session_id: f.id.clone(),
                    draft_id: a.draft_id.clone(),
                    record: f.record.clone()
                })
                .unwrap(),
            a
        );
        f.service.check_chat_image_import(&scope(&a), 77).unwrap();
        assert_eq!(f.read(&a), a);
        f.history([&b.draft_id, &a.draft_id], [4, 3]);
    }
}
