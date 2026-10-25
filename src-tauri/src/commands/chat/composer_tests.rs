use std::{
    future::Future,
    sync::mpsc,
    task::{Context, Waker},
    time::Duration,
};

use base64::{Engine, engine::general_purpose::STANDARD};
use qa_scribe_core::{attachments::chat::import_chat_image_data_url, services::SessionService};
use tauri::Manager;

use super::*;

#[test]
fn actual_save_adapter_yields_while_service_is_busy_then_reclaims_released_file() {
    let root = std::env::temp_dir().join(format!("qa-composer-adapter-{}", uuid::Uuid::new_v4()));
    let service = SessionService::in_memory().unwrap();
    let session = service
        .create_session(SessionDraft {
            title: "Composer worker".into(),
            ..Default::default()
        })
        .unwrap();
    let initial = service.load_chat(&session.id).unwrap();
    let scope = |chat: &ChatState| ChatRevision {
        session_id: chat.session_id.clone(),
        draft_id: chat.draft_id.clone(),
        expected_revision: chat.revision,
    };
    let data = format!(
        "data:image/png;base64,{}",
        STANDARD.encode(include_bytes!(
            "../../../../e2e/fixtures/chat-image-pixels.png"
        ))
    );
    let chat =
        import_chat_image_data_url(&service, &root, scope(&initial), "pixel.png".into(), &data)
            .unwrap();
    let image = service
        .get_attachment(&chat.composer_images[0].attachment_id)
        .unwrap()
        .unwrap();
    let app = tauri::test::mock_app();
    app.manage(AppState::new(service, root.clone()));
    let handle = app.handle().clone();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    let holder = std::thread::spawn(move || {
        handle
            .state::<AppState>()
            .with_service(|_| {
                entered_tx.send(()).unwrap();
                resume_rx.recv_timeout(Duration::from_secs(15)).unwrap();
                Ok(())
            })
            .unwrap();
    });
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let handle = app.handle().clone();
    let request = ChatComposerRequest {
        intent: qa_scribe_core::domain::ChatComposerIntent::Message,
        scope: scope(&chat),
        composer: "Keep text".into(),
        attachment_ids: vec![],
        mode: ChatMode::Chat,
    };
    let (polled_tx, polled_rx) = mpsc::channel();
    let poller = std::thread::spawn(move || {
        let mut future = Box::pin(save_chat_composer(handle, request));
        let waker = Waker::noop();
        let polled = future.as_mut().poll(&mut Context::from_waker(waker));
        polled_tx.send(polled.is_pending()).unwrap();
        match polled {
            std::task::Poll::Ready(result) => result,
            std::task::Poll::Pending => tauri::async_runtime::block_on(future),
        }
    });
    let while_locked = polled_rx.recv_timeout(Duration::from_secs(2));
    resume_tx.send(()).unwrap();
    holder.join().unwrap();
    let saved = poller.join().unwrap().unwrap();
    assert!(while_locked.expect("command future yields before service lock is released"));
    assert!(saved.composer_images.is_empty());
    assert_eq!(saved.composer, "Keep text");
    assert!(!root.join(&image.relative_path).exists());
    app.state::<AppState>()
        .with_service(|service| {
            assert!(service.get_attachment(&image.id)?.is_none());
            assert_eq!(service.load_chat(&session.id)?, saved);
            Ok(())
        })
        .unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
