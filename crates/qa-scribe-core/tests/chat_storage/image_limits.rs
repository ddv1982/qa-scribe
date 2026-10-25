use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use qa_scribe_core::attachments::{chat::import_chat_image_data_url, reconcile_attachment_files};

#[test]
fn real_encoded_image_aggregate_stops_before_fourth_and_failed_sql_import_cleans_its_file() {
    let dir = helpers::unique_temp_dir();
    let service = SessionService::in_memory().unwrap();
    let sid = session(&service);
    let mut chat = service.load_chat(&sid).unwrap();
    let mut state = 1u32;
    let mut pixels = vec![0; 1280 * 1280 * 4];
    for pixel in &mut pixels {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        *pixel = state as u8;
    }
    let image = image::RgbaImage::from_raw(1280, 1280, pixels).unwrap();
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    let data = format!(
        "data:image/png;base64,{}",
        STANDARD.encode(bytes.into_inner())
    );
    for _ in 0..3 {
        chat = import_chat_image_data_url(&service, &dir, scope(&chat), "noise.png".into(), &data)
            .unwrap();
    }
    let error = import_chat_image_data_url(&service, &dir, scope(&chat), "over.png".into(), &data)
        .unwrap_err();
    assert!(error.to_string().contains("20 MiB"));
    assert_eq!(service.load_chat(&sid).unwrap(), chat);
    let removed = service
        .save_chat_composer(ChatComposerRequest {
            intent: qa_scribe_core::domain::ChatComposerIntent::Message,
            scope: scope(&chat),
            attachment_ids: vec![],
            composer: "keep".into(),
            mode: ChatMode::Chat,
        })
        .unwrap();
    service.database().connection().execute_batch("CREATE TRIGGER fail_image_import BEFORE INSERT ON chat_composer_images BEGIN SELECT RAISE(ABORT,'injected import failure'); END;").unwrap();
    assert!(
        import_chat_image_data_url(&service, &dir, scope(&removed), "failed.png".into(), &data)
            .is_err()
    );
    assert!(service.list_attachments(&sid).unwrap().is_empty());
    assert_eq!(
        qa_scribe_core::attachments::retry_attachment_cleanup(&service, &dir)
            .unwrap()
            .pending_files,
        Some(0)
    );
    assert_eq!(service.load_chat(&sid).unwrap(), removed);
    assert_eq!(
        reconcile_attachment_files(&service, &dir)
            .unwrap()
            .stray_files,
        Vec::<String>::new()
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn crash_import_intent_recovers_exact_files_in_bounded_batches_without_touching_siblings() {
    use qa_scribe_core::attachments::chat_imports::recover_chat_image_imports;
    let dir = helpers::unique_temp_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let db = dir.join("recovery.sqlite");
    let service = SessionService::new(Database::open(&db).unwrap()).unwrap();
    let sid = session(&service);
    let folder = dir.join("attachments").join(&sid);
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("unknown.png"), b"keep sibling").unwrap();
    for index in 0..53 {
        let path = format!("attachments/{sid}/{index:03}_image.png");
        let temp = format!("attachments/{sid}/.{index:03}.tmp");
        std::fs::write(dir.join(&path), b"crashed publication").unwrap();
        std::fs::write(dir.join(&temp), b"crashed write").unwrap();
        service.database().connection().execute("INSERT INTO chat_image_imports (relative_path,temp_path,session_id) VALUES (?1,?2,?3)",rusqlite::params![path,temp,sid]).unwrap();
    }
    drop(service);
    let service = SessionService::new(Database::open(&db).unwrap()).unwrap();
    assert_eq!(recover_chat_image_imports(&service, &dir).unwrap(), 3);
    assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 7);
    assert_eq!(recover_chat_image_imports(&service, &dir).unwrap(), 0);
    assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 1);
    assert_eq!(
        std::fs::read(folder.join("unknown.png")).unwrap(),
        b"keep sibling"
    );
    std::fs::remove_dir_all(dir).unwrap();
}
