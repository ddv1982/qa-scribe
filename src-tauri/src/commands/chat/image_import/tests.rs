use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
        mpsc,
    },
    time::Duration,
};

use base64::{Engine, engine::general_purpose::STANDARD};
use qa_scribe_core::{attachments::reconcile_attachment_files, services::SessionService};

use super::*;

struct Fixture {
    state: Arc<AppState>,
    chat: ChatState,
}

impl Fixture {
    fn new() -> Self {
        let service = SessionService::in_memory().unwrap();
        let session = service
            .create_session(SessionDraft {
                title: "Import boundary".into(),
                ..Default::default()
            })
            .unwrap();
        let chat = service.load_chat(&session.id).unwrap();
        let dir = std::env::temp_dir().join(format!("qa-chat-import-{}", uuid::Uuid::new_v4()));
        Self {
            state: Arc::new(AppState::new(service, dir)),
            chat,
        }
    }

    fn read(&self) -> ChatState {
        self.state
            .with_service(|service| service.load_chat(&self.chat.session_id))
            .unwrap()
    }

    fn counts(&self) -> (i64, i64) {
        self.state
            .with_service(|service| {
                let connection = service.database().connection();
                Ok((
                    connection
                        .query_row("SELECT count(*) FROM attachments", [], |row| row.get(0))?,
                    connection.query_row("SELECT count(*) FROM chat_image_imports", [], |row| {
                        row.get(0)
                    })?,
                ))
            })
            .unwrap()
    }

    fn clean(&self) {
        self.state
            .with_service(|service| {
                let report = reconcile_attachment_files(service, self.state.app_data_dir())?;
                assert_eq!(report.missing_files, Vec::<String>::new());
                assert_eq!(report.stray_files, Vec::<String>::new());
                Ok(())
            })
            .unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(self.state.app_data_dir());
    }
}

fn scope(chat: &ChatState) -> ChatRevision {
    ChatRevision {
        session_id: chat.session_id.clone(),
        draft_id: chat.draft_id.clone(),
        expected_revision: chat.revision,
    }
}

fn png() -> String {
    format!(
        "data:image/png;base64,{}",
        STANDARD.encode(include_bytes!(
            "../../../../../e2e/fixtures/chat-image-pixels.png"
        ))
    )
}

fn edit(state: &AppState, chat: &ChatState) -> ChatState {
    state
        .with_service(|service| {
            service.save_chat_composer(ChatComposerRequest {
                intent: qa_scribe_core::domain::ChatComposerIntent::Message,
                scope: scope(chat),
                composer: "Newer composer".into(),
                attachment_ids: vec![],
                mode: ChatMode::Chat,
            })
        })
        .unwrap()
}

#[test]
fn decoder_and_durable_writer_allow_service_reads_before_release() {
    for pause_decoder in [true, false] {
        let fixture = Fixture::new();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        let resume = std::sync::Mutex::new(resume_rx);
        let worker_state = fixture.state.clone();
        let revision = scope(&fixture.chat);
        let decodes = Arc::new(AtomicUsize::new(0));
        let writes = Arc::new(AtomicUsize::new(0));
        let worker_decodes = decodes.clone();
        let worker_writes = writes.clone();
        let worker = std::thread::spawn(move || {
            import_with(
                &worker_state,
                revision,
                "pixel.png".into(),
                &png(),
                |scope, filename, data| {
                    worker_decodes.fetch_add(1, Ordering::SeqCst);
                    if pause_decoder {
                        entered_tx.send(()).unwrap();
                        resume
                            .lock()
                            .unwrap()
                            .recv_timeout(Duration::from_secs(15))
                            .unwrap();
                    }
                    PreparedChatImageImport::decode(scope, filename, data)
                },
                |prepared| {
                    worker_writes.fetch_add(1, Ordering::SeqCst);
                    if !pause_decoder {
                        entered_tx.send(()).unwrap();
                        resume
                            .lock()
                            .unwrap()
                            .recv_timeout(Duration::from_secs(15))
                            .unwrap();
                    }
                    prepared.write(worker_state.app_data_dir())
                },
            )
        });
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let reader_state = fixture.state.clone();
        let session_id = fixture.chat.session_id.clone();
        let (read_tx, read_rx) = mpsc::channel();
        let reader = std::thread::spawn(move || {
            read_tx
                .send(reader_state.with_service(|service| service.load_chat(&session_id)))
                .unwrap();
        });
        let during = read_rx.recv_timeout(Duration::from_secs(5));
        resume_tx.send(()).unwrap();
        let imported = worker.join().unwrap().unwrap();
        reader.join().unwrap();
        assert_eq!(
            during
                .expect("service read completes before import resumes")
                .unwrap(),
            fixture.chat
        );
        assert_eq!(decodes.load(Ordering::SeqCst), 1);
        assert_eq!(writes.load(Ordering::SeqCst), 1);
        assert_eq!(imported.composer_images.len(), 1);
        assert_eq!(imported.composer_images[0].filename, "pixel.png");
        assert_eq!(fixture.read(), imported);
        assert_eq!(fixture.counts(), (1, 0));
        fixture.clean();
    }
}

#[test]
fn service_read_oracle_detects_a_held_service_mutex() {
    let fixture = Fixture::new();
    let state = fixture.state.clone();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    let holder = std::thread::spawn(move || {
        state.with_service(|_| {
            entered_tx.send(()).unwrap();
            resume_rx.recv_timeout(Duration::from_secs(15)).unwrap();
            Ok(())
        })
    });
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let reader_state = fixture.state.clone();
    let session_id = fixture.chat.session_id.clone();
    let (attempt_tx, attempt_rx) = mpsc::channel();
    let (read_tx, read_rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        attempt_tx.send(()).unwrap();
        read_tx
            .send(reader_state.with_service(|service| service.load_chat(&session_id)))
            .unwrap();
    });
    attempt_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let blocked = read_rx.recv_timeout(Duration::from_millis(100));
    resume_tx.send(()).unwrap();
    holder.join().unwrap().unwrap();
    assert!(matches!(blocked, Err(mpsc::RecvTimeoutError::Timeout)));
    assert_eq!(
        read_rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap(),
        fixture.chat
    );
    reader.join().unwrap();
}

#[test]
fn edits_and_session_deletion_after_publication_reject_and_remove_only_own_file() {
    for delete_session in [false, true] {
        let fixture = Fixture::new();
        let mut newer = None;
        let result = import_with(
            &fixture.state,
            scope(&fixture.chat),
            "stale.png".into(),
            &png(),
            PreparedChatImageImport::decode,
            |prepared| {
                prepared.write(fixture.state.app_data_dir())?;
                if delete_session {
                    fixture
                        .state
                        .with_service(|service| service.delete_session(&fixture.chat.session_id))
                        .unwrap();
                } else {
                    newer = Some(edit(&fixture.state, &fixture.chat));
                }
                Ok(())
            },
        );
        assert!(result.is_err());
        assert_eq!(fixture.counts(), (0, 0));
        if let Some(newer) = newer {
            assert_eq!(fixture.read(), newer);
        }
        fixture.clean();
    }
}

#[test]
fn edit_or_delete_during_decode_prevents_receipt_and_files() {
    for delete_session in [false, true] {
        let fixture = Fixture::new();
        let result = import_with(
            &fixture.state,
            scope(&fixture.chat),
            "stale.png".into(),
            &png(),
            |scope, filename, data| {
                let prepared = PreparedChatImageImport::decode(scope, filename, data)?;
                if delete_session {
                    fixture
                        .state
                        .with_service(|service| service.delete_session(&fixture.chat.session_id))
                        .unwrap();
                } else {
                    edit(&fixture.state, &fixture.chat);
                }
                Ok(prepared)
            },
            |_| panic!("rejected reservation must not write"),
        );
        assert!(result.is_err());
        assert_eq!(fixture.counts(), (0, 0));
        assert!(!fixture.state.app_data_dir().exists());
    }
}

#[test]
fn failed_import_cleanup_preserves_another_live_import_receipt_and_pixels() {
    let fixture = Fixture::new();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    let worker_state = fixture.state.clone();
    let revision = scope(&fixture.chat);
    let worker = std::thread::spawn(move || {
        import_with(
            &worker_state,
            revision,
            "live.png".into(),
            &png(),
            PreparedChatImageImport::decode,
            |prepared| {
                prepared.write(worker_state.app_data_dir())?;
                entered_tx.send(()).unwrap();
                resume_rx.recv_timeout(Duration::from_secs(15)).unwrap();
                Ok(())
            },
        )
    });
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let paths = std::fs::read_dir(
        fixture
            .state
            .app_data_dir()
            .join("attachments")
            .join(&fixture.chat.session_id),
    )
    .unwrap()
    .map(|entry| entry.unwrap().path())
    .collect::<Vec<PathBuf>>();
    assert_eq!(paths.len(), 1);
    let result = import_with(
        &fixture.state,
        scope(&fixture.chat),
        "failed.png".into(),
        &png(),
        PreparedChatImageImport::decode,
        |prepared| {
            prepared.write(fixture.state.app_data_dir())?;
            Err(qa_scribe_core::QaScribeError::Validation(
                "Injected write failure".into(),
            ))
        },
    );
    let during_counts = fixture.counts();
    let during_pixels = std::fs::read(&paths[0]);
    resume_tx.send(()).unwrap();
    let imported = worker.join().unwrap().unwrap();
    assert!(matches!(result, Err(error) if error.message == "Injected write failure"));
    assert_eq!(during_counts, (0, 1));
    assert_eq!(
        during_pixels.unwrap(),
        include_bytes!("../../../../../e2e/fixtures/chat-image-pixels.png")
    );
    assert_eq!(imported.composer_images[0].filename, "live.png");
    assert_eq!(fixture.counts(), (1, 0));
    fixture.clean();
}

#[test]
fn concurrent_imports_compare_revision_and_keep_winning_image() {
    let fixture = Fixture::new();
    let mut winner = None;
    let result = import_with(
        &fixture.state,
        scope(&fixture.chat),
        "loser.png".into(),
        &png(),
        PreparedChatImageImport::decode,
        |prepared| {
            prepared.write(fixture.state.app_data_dir())?;
            winner = Some(
                import(
                    &fixture.state,
                    scope(&fixture.chat),
                    "winner.png".into(),
                    &png(),
                )
                .unwrap(),
            );
            Ok(())
        },
    );
    assert!(
        matches!(result, Err(error) if error.message == "Chat changed. Reload the conversation before retrying.")
    );
    let winner = winner.unwrap();
    assert_eq!(fixture.read(), winner);
    assert_eq!(winner.composer_images.len(), 1);
    assert_eq!(winner.composer_images[0].filename, "winner.png");
    assert_eq!(fixture.counts(), (1, 0));
    fixture.clean();
}

#[test]
fn invalid_pixels_filename_and_mime_do_not_persist() {
    for (filename, data) in [
        (
            "bad.png".to_string(),
            "data:image/png;base64,YmFk".to_string(),
        ),
        (".".to_string(), png()),
        ("x".repeat(201), png()),
        (
            "bad.jpg".to_string(),
            png().replace("image/png", "image/jpeg"),
        ),
    ] {
        let fixture = Fixture::new();
        assert!(import(&fixture.state, scope(&fixture.chat), filename, &data).is_err());
        assert_eq!(fixture.read(), fixture.chat);
        assert_eq!(fixture.counts(), (0, 0));
        assert!(!fixture.state.app_data_dir().exists());
    }
}

#[test]
fn error_after_durable_commit_preserves_attachment_and_composer_ownership() {
    let fixture = Fixture::new();
    let mut committed = None;
    let result = import_with(
        &fixture.state,
        scope(&fixture.chat),
        "committed.png".into(),
        &png(),
        PreparedChatImageImport::decode,
        |prepared| {
            prepared.write(fixture.state.app_data_dir())?;
            committed = Some(
                fixture
                    .state
                    .with_service(|service| prepared.commit(service))
                    .unwrap(),
            );
            Err(qa_scribe_core::QaScribeError::Validation(
                "Commit outcome unavailable".into(),
            ))
        },
    );
    assert!(matches!(result, Err(error) if error.message == "Commit outcome unavailable"));
    let committed = committed.unwrap();
    assert_eq!(fixture.read(), committed);
    assert_eq!(committed.composer_images[0].filename, "committed.png");
    assert_eq!(fixture.counts(), (1, 0));
    fixture.clean();
}

#[test]
fn import_runs_on_existing_blocking_attachment_helper() {
    let fixture = Fixture::new();
    let state = fixture.state.clone();
    let revision = scope(&fixture.chat);
    let caller = std::thread::current().id();
    let imported = tauri::async_runtime::block_on(crate::commands::files::attachment_task(
        "Chat image import",
        move || {
            assert_ne!(std::thread::current().id(), caller);
            import(&state, revision, "worker.png".into(), &png())
        },
    ))
    .unwrap();
    assert_eq!(imported.composer_images[0].filename, "worker.png");
    assert_eq!(fixture.read(), imported);
    assert_eq!(fixture.counts(), (1, 0));
    fixture.clean();
}
