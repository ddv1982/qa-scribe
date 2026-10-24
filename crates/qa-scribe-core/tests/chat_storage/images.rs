use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use qa_scribe_core::attachments::{
    chat::{import_chat_image_data_url, resolve_chat_image},
    delete_attachment_with_file,
};
use std::io::Cursor;

fn png() -> String {
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        2,
        1,
        image::Rgba([255, 0, 0, 255]),
    ))
    .write_to(&mut bytes, image::ImageFormat::Png)
    .unwrap();
    format!(
        "data:image/png;base64,{}",
        STANDARD.encode(bytes.into_inner())
    )
}

#[test]
fn image_only_composer_reopens_sends_retries_and_retains_archived_images() {
    let dir = helpers::unique_temp_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let db = dir.join("chat.sqlite");
    let service = SessionService::new(Database::open(&db).unwrap()).unwrap();
    let sid = session(&service);
    let chat = service.load_chat(&sid).unwrap();
    let image_chat =
        import_chat_image_data_url(&service, &dir, scope(&chat), "pixel.png".into(), &png())
            .unwrap();
    assert_eq!(image_chat.revision, 1);
    assert_eq!(image_chat.composer, "");
    assert_eq!(image_chat.composer_images[0].mime_type, "image/png");
    let image = image_chat.composer_images[0].clone();
    assert!(!delete_attachment_with_file(&service, &dir, &image.attachment_id).unwrap());
    validation(service.save_chat_composer(ChatComposerRequest {
        scope: scope(&chat),
        attachment_ids: vec![],
        composer: "stale".into(),
        mode: ChatMode::Chat,
    }));
    drop(service);
    let service = SessionService::new(Database::open(&db).unwrap()).unwrap();
    let restored = service.load_chat(&sid).unwrap();
    assert_eq!(restored, image_chat);
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&restored),
        })
        .unwrap();
    assert_eq!(started.chat.composer_images, vec![]);
    assert_eq!(started.chat.messages[0].images, vec![image.clone()]);
    assert_eq!(started.chat.messages[0].text, "");
    let id = started.chat.messages[0].id.clone();
    let failed = service
        .fail_chat_turn(ChatFailRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            kind: ChatFailureKind::Failed,
            error_message: "fixture failure".into(),
        })
        .unwrap();
    let retry = service
        .retry_chat_turn(ChatStartRequest {
            scope: scope(&failed),
        })
        .unwrap();
    assert_eq!(retry.chat.messages.len(), 1);
    assert_eq!(retry.chat.messages[0].id, id);
    assert_eq!(retry.chat.messages[0].images, vec![image.clone()]);
    let done = service
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&retry.chat),
            turn_id: retry.turn_id,
            assistant_text: "A red pixel".into(),
        })
        .unwrap();
    service
        .restart_chat(ChatRestartRequest {
            scope: scope(&done),
        })
        .unwrap();
    assert!(!delete_attachment_with_file(&service, &dir, &image.attachment_id).unwrap());
    resolve_chat_image(&service, &dir, &sid, &image.attachment_id).unwrap();
    service.delete_session(&sid).unwrap();
    assert_eq!(
        helpers::count_rows(service.database().connection(), "chat_message_images"),
        0
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn import_and_reorder_are_atomic_and_cross_session_images_cannot_be_borrowed() {
    let dir = helpers::unique_temp_dir();
    let service = SessionService::in_memory().unwrap();
    let sid = session(&service);
    let chat = service.load_chat(&sid).unwrap();
    let a = import_chat_image_data_url(&service, &dir, scope(&chat), "first.png".into(), &png())
        .unwrap();
    let b =
        import_chat_image_data_url(&service, &dir, scope(&a), "second.png".into(), &png()).unwrap();
    let ids = b
        .composer_images
        .iter()
        .rev()
        .map(|i| i.attachment_id.clone())
        .collect::<Vec<_>>();
    let reordered = service
        .save_chat_composer(ChatComposerRequest {
            scope: scope(&b),
            attachment_ids: ids.clone(),
            composer: "typed".into(),
            mode: ChatMode::Chat,
        })
        .unwrap();
    assert_eq!(
        reordered
            .composer_images
            .iter()
            .map(|i| i.attachment_id.clone())
            .collect::<Vec<_>>(),
        ids
    );
    let other = session(&service);
    let foreign_chat = service.load_chat(&other).unwrap();
    validation(resolve_chat_image(&service, &dir, &other, &ids[0]));
    validation(service.save_chat_composer(ChatComposerRequest {
        scope: scope(&foreign_chat),
        attachment_ids: ids.clone(),
        composer: "".into(),
        mode: ChatMode::Chat,
    }));
    validation(import_chat_image_data_url(
        &service,
        &dir,
        scope(&b),
        "stale.png".into(),
        &png(),
    ));
    assert_eq!(service.list_attachments(&sid).unwrap().len(), 2);
    assert_eq!(
        qa_scribe_core::attachments::reconcile_attachment_files(&service, &dir)
            .unwrap()
            .stray_files,
        Vec::<String>::new()
    );
    let removed = service
        .save_chat_composer(ChatComposerRequest {
            scope: scope(&reordered),
            attachment_ids: vec![ids[0].clone()],
            composer: "typed".into(),
            mode: ChatMode::Chat,
        })
        .unwrap();
    assert_eq!(removed.composer, "typed");
    assert!(delete_attachment_with_file(&service, &dir, &ids[1]).unwrap());
    assert!(!delete_attachment_with_file(&service, &dir, &ids[0]).unwrap());
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn image_handoff_preserves_note_json_and_receipt_and_guards_submitted_relationships() {
    let dir = helpers::unique_temp_dir();
    let service = SessionService::in_memory().unwrap();
    let sid = session(&service);
    let note = service.get_or_create_note_entry(&sid).unwrap();
    let note = service.update_entry(&note.id, EntryPatch { body: Some("<p>Existing</p>".into()), body_json: Some(Some(json!({"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Existing"}]}]}}).to_string())), body_format: Some(Some("tiptap_json".into())), ..Default::default() }).unwrap();
    let chat = service.load_chat(&sid).unwrap();
    let chat = import_chat_image_data_url(&service, &dir, scope(&chat), "pixel.png".into(), &png())
        .unwrap();
    let turn = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&chat),
        })
        .unwrap();
    let chat = service
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&turn.chat),
            turn_id: turn.turn_id,
            assistant_text: "Seen".into(),
        })
        .unwrap();
    let unsent =
        import_chat_image_data_url(&service, &dir, scope(&chat), "unsent.png".into(), &png())
            .unwrap();
    validation(service.submit_chat(submit_request(&unsent, &note)));
    let chat = service
        .save_chat_composer(ChatComposerRequest {
            scope: scope(&unsent),
            attachment_ids: vec![],
            composer: String::new(),
            mode: ChatMode::Chat,
        })
        .unwrap();
    let request = submit_request(&chat, &note);
    let receipt = service.submit_chat(request.clone()).unwrap();
    assert_eq!(service.submit_chat(request).unwrap(), receipt);
    let note = service.get_or_create_note_entry(&sid).unwrap();
    let id = &chat.messages[0].images[0].attachment_id;
    assert!(note.body.starts_with("<p>Existing</p>"));
    assert!(
        note.body
            .contains(&format!("src=\"qa-scribe-attachment://{id}\""))
    );
    let json: Value = serde_json::from_str(note.body_json.as_ref().unwrap()).unwrap();
    assert_eq!(
        json["doc"]["content"][2],
        json!({"type":"image","attrs":{"src":format!("qa-scribe-attachment://{id}"),"attachmentId":id,"alt":"pixel.png"}})
    );
    let connection = service.database().connection();
    for sql in [
        "UPDATE chat_message_images SET ordinal=1",
        "DELETE FROM chat_message_images",
        "UPDATE attachments SET mime_type='image/jpeg'",
        "INSERT INTO chat_composer_images SELECT draft_id, attachment_id, 0 FROM chat_message_images JOIN chat_messages ON message_id=id",
    ] {
        assert!(connection.execute(sql, []).is_err(), "{sql}");
    }
    assert!(!delete_attachment_with_file(&service, &dir, id).unwrap());
    service.delete_session(&sid).unwrap();
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn rejects_corrupt_mislabeled_and_excess_images_without_files_or_revision_changes() {
    let dir = helpers::unique_temp_dir();
    let service = SessionService::in_memory().unwrap();
    let sid = session(&service);
    let mut chat = service.load_chat(&sid).unwrap();
    for data in [
        "data:image/png;base64,YmFk".into(),
        png().replace("image/png", "image/jpeg"),
        png().replace("image/png", "image/svg+xml"),
    ] {
        validation(import_chat_image_data_url(
            &service,
            &dir,
            scope(&chat),
            "bad.png".into(),
            &data,
        ));
        assert_eq!(service.load_chat(&sid).unwrap(), chat);
    }
    for _ in 0..4 {
        chat = import_chat_image_data_url(&service, &dir, scope(&chat), "pixel.png".into(), &png())
            .unwrap();
    }
    validation(import_chat_image_data_url(
        &service,
        &dir,
        scope(&chat),
        "fifth.png".into(),
        &png(),
    ));
    assert_eq!(service.list_attachments(&sid).unwrap().len(), 4);
    assert_eq!(service.load_chat(&sid).unwrap(), chat);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn omitted_attachment_ids_default_to_an_empty_ordered_composer() {
    let request: ChatComposerRequest = serde_json::from_value(json!({
        "scope":{"sessionId":"session","draftId":"draft","expectedRevision":1},
        "composer":"text", "mode":"chat"
    }))
    .unwrap();
    assert_eq!(request.attachment_ids, Vec::<String>::new());
}
