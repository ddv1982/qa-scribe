use std::{
    sync::{Arc, mpsc},
    time::Duration,
};

use base64::{Engine, engine::general_purpose::STANDARD};
use qa_scribe_core::{
    attachments::chat::{import_chat_image_data_url, resolve_chat_image_source},
    services::SessionService,
};

use super::*;

fn fixture() -> (Arc<AppState>, ChatState, std::path::PathBuf) {
    fixture_with_size(0)
}

fn fixture_with_size(size: usize) -> (Arc<AppState>, ChatState, std::path::PathBuf) {
    let service = SessionService::in_memory().unwrap();
    let session = service
        .create_session(SessionDraft {
            title: "Preparation boundary".into(),
            ..Default::default()
        })
        .unwrap();
    let chat = service.load_chat(&session.id).unwrap();
    let dir = std::env::temp_dir().join(format!("qa-preparation-{}", uuid::Uuid::new_v4()));
    let mut pixels = include_bytes!("../../../../e2e/fixtures/chat-image-pixels.png").to_vec();
    pixels.resize(size.max(pixels.len()), 0);
    let chat = import_chat_image_data_url(
        &service,
        &dir,
        lifecycle::scope(&chat),
        "pixel.png".into(),
        &format!("data:image/png;base64,{}", STANDARD.encode(pixels)),
    )
    .unwrap();
    (Arc::new(AppState::new(service, dir.clone())), chat, dir)
}

fn request(chat: &ChatState) -> StartChatJobRequest {
    StartChatJobRequest {
        intent: crate::commands::chat::ChatSendIntent::Composer,
        context: ChatTarget::Session,
        scope: lifecycle::scope(chat),

        provider: AiProvider::CopilotCli,
        model: "fixture".into(),
        reasoning_effort: None,
    }
}

fn run_count(state: &AppState) -> i64 {
    state
        .with_service(|service| {
            Ok(service.database().connection().query_row(
                "SELECT count(*) FROM ai_runs",
                [],
                |row| row.get(0),
            )?)
        })
        .unwrap()
}

#[test]
fn image_loader_releases_both_gates_and_cancel_preserves_composer() {
    let (state, before, dir) = fixture();
    let jobs = Arc::new(JobStore::default());
    let (entered_tx, entered_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    let worker_state = state.clone();
    let worker_jobs = jobs.clone();
    let request = request(&before);
    let worker_dir = dir.clone();
    let worker = std::thread::spawn(move || {
        prepare_chat_job_with(
            &worker_state,
            &worker_jobs,
            &request,
            "cancel-preparation",
            |snapshot, control| {
                snapshot
                    .verify_with(
                        request.provider,
                        || control.is_cancelled(),
                        |source| {
                            entered_tx.send(()).unwrap();
                            resume_rx.recv_timeout(Duration::from_secs(15)).unwrap();
                            resolve_chat_image_source(&worker_dir, source)
                        },
                    )
                    .map_err(CommandError::from)
            },
        )
    });
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let actor_state = state.clone();
    let actor_jobs = jobs.clone();
    let session_id = before.session_id.clone();
    let (result_tx, result_rx) = mpsc::channel();
    let actor = std::thread::spawn(move || {
        let chat = actor_state
            .with_service(|service| service.load_chat(&session_id))
            .unwrap();
        let status = actor_jobs.cancel("cancel-preparation").unwrap();
        result_tx.send((chat, status.state)).unwrap();
    });
    let result = result_rx.recv_timeout(Duration::from_secs(5));
    resume_tx.send(()).unwrap();
    let rejected = worker.join().unwrap();
    actor.join().unwrap();
    let (during, status) =
        result.expect("service read and accepted cancel complete before loader resumes");
    assert_eq!(during, before);
    assert_eq!(status, GenerationJobState::Cancelling);
    assert!(matches!(rejected, Err(error) if error.message == "Generation cancelled."));
    assert_eq!(
        state
            .with_service(|service| service.load_chat(&before.session_id))
            .unwrap(),
        before
    );
    assert_eq!(run_count(&state), 0);
    assert_eq!(
        jobs.status("cancel-preparation").unwrap().state,
        GenerationJobState::Cancelled
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn stale_edit_or_session_deletion_during_loading_consumes_nothing() {
    for delete in [false, true] {
        let (state, before, dir) = fixture();
        let jobs = JobStore::default();
        let request = request(&before);
        let mut edited = None;
        let result = prepare_chat_job_with(
            &state,
            &jobs,
            &request,
            "stale-preparation",
            |snapshot, control| {
                snapshot
                    .verify_with(
                        request.provider,
                        || control.is_cancelled(),
                        |source| {
                            state
                                .with_service(|service| {
                                    if delete {
                                        service.delete_session(&before.session_id)?;
                                    } else {
                                        edited = Some(
                                            service.save_chat_composer(ChatComposerRequest {
                                                intent: qa_scribe_core::domain::ChatComposerIntent::Message,
                                                scope: lifecycle::scope(&before),
                                                composer: "Concurrent edit".into(),
                                                attachment_ids: before
                                                    .composer_images
                                                    .iter()
                                                    .map(|i| i.attachment_id.clone())
                                                    .collect(),
                                                mode: ChatMode::Chat,
                                            })?,
                                        );
                                    }
                                    Ok(())
                                })
                                .unwrap();
                            resolve_chat_image_source(&dir, source)
                        },
                    )
                    .map_err(CommandError::from)
            },
        );
        assert!(result.is_err());
        assert_eq!(run_count(&state), 0);
        if !delete {
            assert_eq!(
                state
                    .with_service(|service| service.load_chat(&before.session_id))
                    .unwrap(),
                edited.unwrap()
            );
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[test]
fn replay_count_and_byte_caps_precede_missing_or_corrupt_sources() {
    for (count, size, missing) in [(17, 0, true), (5, 9 * 1024 * 1024, false)] {
        let (state, mut chat, dir) = fixture_with_size(size);
        let image_id = chat.composer_images[0].attachment_id.clone();
        let mut pixels = include_bytes!("../../../../e2e/fixtures/chat-image-pixels.png").to_vec();
        pixels.resize(size.max(pixels.len()), 0);
        let data_url = format!("data:image/png;base64,{}", STANDARD.encode(pixels));
        for _ in 1..count {
            chat = state
                .with_service(|service| {
                    let started = service.start_chat_turn(ChatStartRequest {
                        scope: lifecycle::scope(&chat),
                    })?;
                    let completed = service.finish_chat_turn(ChatFinishRequest {
                        scope: lifecycle::scope(&started.chat),
                        turn_id: started.turn_id,
                        assistant_text: "Seen".into(),
                    })?;
                    import_chat_image_data_url(
                        service,
                        &dir,
                        lifecycle::scope(&completed),
                        "pixel.png".into(),
                        &data_url,
                    )
                })
                .unwrap();
        }
        let path = state
            .with_service(|service| Ok(service.get_attachment(&image_id)?.unwrap().relative_path))
            .unwrap();
        if missing {
            std::fs::remove_file(dir.join(path)).unwrap();
        } else {
            std::fs::write(dir.join(path), b"corrupt").unwrap();
        }
        let jobs = JobStore::default();
        let error = prepare_chat_job_with(&state, &jobs, &request(&chat), "over-budget", |_, _| {
            panic!("over-budget replay must not reach loader or provider preflight")
        })
        .err()
        .unwrap();
        assert_eq!(
            error.message,
            "Chat image history exceeds 16 images or 40 MiB. Start a new conversation; prior images will remain in history."
        );
        assert_eq!(run_count(&state), 0);
        assert_eq!(
            state
                .with_service(|service| service.load_chat(&chat.session_id))
                .unwrap(),
            chat
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[test]
fn oversized_text_precedes_missing_image_and_preserves_composer() {
    let (state, chat, dir) = fixture();
    let before = state
        .with_service(|service| {
            service.save_chat_composer(ChatComposerRequest {
                intent: qa_scribe_core::domain::ChatComposerIntent::Message,
                scope: lifecycle::scope(&chat),
                composer: "x".repeat(16_385),
                attachment_ids: chat
                    .composer_images
                    .iter()
                    .map(|i| i.attachment_id.clone())
                    .collect(),
                mode: ChatMode::Chat,
            })
        })
        .unwrap();
    std::fs::remove_dir_all(&dir).unwrap();
    let error = state
        .with_service(|service| {
            preparation::ChatPreparationSnapshot::capture(service, &request(&before))
        })
        .err()
        .unwrap();
    assert_eq!(error.message, "Chat message exceeds 16384 bytes");
    assert_eq!(run_count(&state), 0);
    assert_eq!(
        state
            .with_service(|service| service.load_chat(&before.session_id))
            .unwrap(),
        before
    );
}

#[test]
fn verified_pixels_are_committed_once_with_the_durable_message_label() {
    let (state, before, dir) = fixture();
    let jobs = JobStore::default();
    let request = request(&before);
    let mut loads = 0;
    let (prepared, _, _) =
        prepare_chat_job_with(&state, &jobs, &request, "verified", |snapshot, control| {
            snapshot
                .verify_with(
                    request.provider,
                    || control.is_cancelled(),
                    |source| {
                        loads += 1;
                        let image = resolve_chat_image_source(&dir, source)?;
                        std::fs::remove_dir_all(&dir)?;
                        Ok(image)
                    },
                )
                .map_err(CommandError::from)
        })
        .unwrap();
    assert_eq!(loads, 1);
    let id = &prepared.started.chat.messages[0].id;
    let blocks = prepared.input.content_blocks(AiProvider::CopilotCli);
    assert_eq!(
        blocks[2],
        serde_json::json!({"type":"text","text":format!("Image 1 for message {id}")})
    );
    assert_eq!(
        blocks[3],
        serde_json::json!({"type":"image","mimeType":"image/png","data":STANDARD.encode(include_bytes!("../../../../e2e/fixtures/chat-image-pixels.png"))})
    );
    assert_eq!(run_count(&state), 1);
    assert_eq!(
        state
            .with_service(|service| service.load_chat(&before.session_id))
            .unwrap(),
        prepared.started.chat
    );
}

#[test]
fn cancellation_between_sources_stops_loading_and_keeps_both_images() {
    let (state, before, dir) = fixture();
    let before = state
        .with_service(|service| {
            import_chat_image_data_url(
                service,
                &dir,
                lifecycle::scope(&before),
                "second.png".into(),
                &format!(
                    "data:image/png;base64,{}",
                    STANDARD.encode(include_bytes!(
                        "../../../../e2e/fixtures/chat-image-pixels.png"
                    ))
                ),
            )
        })
        .unwrap();
    let jobs = JobStore::default();
    let request = request(&before);
    let mut loads = 0;
    let result = prepare_chat_job_with(
        &state,
        &jobs,
        &request,
        "between-sources",
        |snapshot, control| {
            snapshot
                .verify_with(
                    request.provider,
                    || control.is_cancelled(),
                    |source| {
                        loads += 1;
                        let image = resolve_chat_image_source(&dir, source)?;
                        jobs.cancel("between-sources").unwrap();
                        Ok(image)
                    },
                )
                .map_err(CommandError::from)
        },
    );
    assert!(matches!(result, Err(error) if error.message == "Generation cancelled."));
    assert_eq!(loads, 1);
    assert_eq!(run_count(&state), 0);
    assert_eq!(
        state
            .with_service(|service| service.load_chat(&before.session_id))
            .unwrap(),
        before
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn context_change_without_chat_revision_change_rejects_verified_pixels() {
    let (state, before, dir) = fixture();
    let jobs = JobStore::default();
    let request = request(&before);
    let result = prepare_chat_job_with(
        &state,
        &jobs,
        &request,
        "context-change",
        |snapshot, control| {
            snapshot
                .verify_with(
                    request.provider,
                    || control.is_cancelled(),
                    |source| {
                        let image = resolve_chat_image_source(&dir, source)?;
                        state
                            .with_service(|service| {
                                service.update_session(
                                    &before.session_id,
                                    SessionPatch {
                                        session_context: Some(Some("Updated context".into())),
                                        ..Default::default()
                                    },
                                )
                            })
                            .unwrap();
                        Ok(image)
                    },
                )
                .map_err(CommandError::from)
        },
    );
    assert!(
        matches!(result, Err(error) if error.message == "Chat changed. Reload the conversation before retrying.")
    );
    assert_eq!(run_count(&state), 0);
    assert_eq!(
        state
            .with_service(|service| service.load_chat(&before.session_id))
            .unwrap(),
        before
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn preparation_and_image_loader_execute_on_the_existing_blocking_helper() {
    let (state, before, dir) = fixture();
    let request = request(&before);
    let caller = std::thread::current().id();
    let worker_state = state.clone();
    let result = tauri::async_runtime::block_on(super::super::files::attachment_task(
        "Chat preparation",
        move || {
            assert_ne!(std::thread::current().id(), caller);
            prepare_chat_job_with(
                &worker_state,
                &JobStore::default(),
                &request,
                "blocking-preparation",
                |snapshot, control| {
                    snapshot
                        .verify_with(
                            request.provider,
                            || control.is_cancelled(),
                            |source| {
                                assert_ne!(std::thread::current().id(), caller);
                                resolve_chat_image_source(&dir, source)
                            },
                        )
                        .map_err(CommandError::from)
                },
            )
            .map(|(prepared, _, _)| prepared)
        },
    ))
    .unwrap();
    assert_eq!(result.started.chat.messages.len(), 1);
    assert_eq!(run_count(&state), 1);
    assert_eq!(
        state
            .with_service(|service| service.load_chat(&before.session_id))
            .unwrap(),
        result.started.chat
    );
    std::fs::remove_dir_all(state.app_data_dir()).unwrap();
}
