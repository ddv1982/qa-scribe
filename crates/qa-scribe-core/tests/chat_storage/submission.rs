use super::*;

#[test]
fn submission_preserves_rich_document_and_escapes_faithful_role_labelled_transcript() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let note = service.get_or_create_note_entry(&id).unwrap();
    let original = json!({"schemaVersion": 1, "doc": {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Keep bold", "marks": [{"type": "bold"}]}]},
        {"type": "image", "attrs": {"src": "qa-scribe-attachment://managed-image", "alt": "Evidence"}}
    ]}});
    let html = "<p><strong>Keep bold</strong></p><img src=\"qa-scribe-attachment://managed-image\" alt=\"Evidence\">";
    let note = service
        .update_entry(
            &note.id,
            EntryPatch {
                body: Some(html.into()),
                body_json: Some(Some(original.to_string())),
                body_format: Some(Some("tiptap_json".into())),
                ..Default::default()
            },
        )
        .unwrap();
    let chat = complete(
        &service,
        &service.load_chat(&id).unwrap(),
        "<script>alert('x')</script> & question\nnext",
        "<img onerror=\"bad\"> & answer",
    );
    let receipt = service.submit_chat(submit_request(&chat, &note)).unwrap();
    assert_eq!(receipt.draft_id, chat.draft_id);
    assert_eq!(receipt.note_id, note.id);
    let submitted = service.load_chat(&id).unwrap();
    assert_eq!(submitted.submission.as_ref(), Some(&receipt));
    assert_eq!(submitted.mode, ChatMode::WriteNote);
    let result = service.get_or_create_note_entry(&id).unwrap();
    assert!(result.body.starts_with(html));
    assert!(result.body.contains("User:"));
    assert!(result.body.contains("Assistant:"));
    assert!(result.body.contains("&lt;script&gt;"));
    assert!(result.body.contains("&amp; question"));
    assert!(!result.body.contains("<script>"));
    assert!(!result.body.contains("<img onerror="));
    assert_eq!(result.body_format.as_deref(), Some("tiptap_json"));
    let json: Value = serde_json::from_str(result.body_json.as_ref().unwrap()).unwrap();
    assert_eq!(json["schemaVersion"], 1);
    let nodes = json["doc"]["content"].as_array().unwrap();
    assert_eq!(
        &nodes[..2],
        original["doc"]["content"].as_array().unwrap().as_slice()
    );
    let added = serde_json::to_string(&nodes[2..]).unwrap();
    assert!(added.contains("User:"));
    assert!(added.contains("Assistant:"));
    assert!(added.contains("<script>alert('x')</script> & question"));
    assert!(
        added.contains("hardBreak"),
        "line breaks must survive in JSON"
    );
    // A repeated request uses the original, now-stale revision and Note snapshot.
    assert_eq!(
        service.submit_chat(submit_request(&chat, &note)).unwrap(),
        receipt
    );
    assert_eq!(service.get_or_create_note_entry(&id).unwrap(), result);
    validation(service.start_chat_turn(ChatStartRequest {
        scope: scope(&submitted),
    }));
    validation(service.save_chat_composer(ChatComposerRequest {
        scope: scope(&submitted),
        composer: "Cannot change submitted transcript".into(),
        mode: ChatMode::Chat,
    }));
    let restarted = service
        .restart_chat(ChatRestartRequest {
            scope: scope(&submitted),
        })
        .unwrap();
    assert_ne!(restarted.draft_id, submitted.draft_id);
    assert!(restarted.messages.is_empty());
    assert!(restarted.submission.is_none());
    assert_eq!(
        helpers::count_rows(service.database().connection(), "chat_drafts"),
        2
    );
    assert_eq!(
        helpers::count_rows(service.database().connection(), "chat_messages"),
        2
    );
    assert_eq!(
        service.submit_chat(submit_request(&chat, &note)).unwrap(),
        receipt
    );
    assert_eq!(service.get_or_create_note_entry(&id).unwrap(), result);
    assert_eq!(
        service.list_drafts(&id).unwrap().len(),
        0,
        "submission is not Testware generation"
    );
}

#[test]
fn html_only_note_stays_html_without_json_that_hides_existing_content() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let note = service.get_or_create_note_entry(&id).unwrap();
    let note = service
        .update_entry(
            &note.id,
            EntryPatch {
                body: Some("<ul><li>Keep list</li></ul>".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let chat = complete(
        &service,
        &service.load_chat(&id).unwrap(),
        "Question",
        "Answer",
    );
    service.submit_chat(submit_request(&chat, &note)).unwrap();
    let result = service.get_or_create_note_entry(&id).unwrap();
    assert!(result.body.starts_with(&note.body));
    assert!(result.body_json.is_none());
    assert_eq!(result.body_format.as_deref(), Some("html"));
}

#[test]
fn submission_checks_all_note_representations_and_rolls_back_on_stale_content() {
    for changed_field in ["body", "body_json", "body_format"] {
        let service = SessionService::in_memory().unwrap();
        let id = session(&service);
        let note = service.get_or_create_note_entry(&id).unwrap();
        let chat = complete(&service, &service.load_chat(&id).unwrap(), "Q", "A");
        let patch = match changed_field {
            "body" => EntryPatch {
                body: Some("<p>New text</p>".into()),
                ..Default::default()
            },
            "body_json" => EntryPatch {
                body_json: Some(Some(
                    json!({"schemaVersion":1,"doc":{"type":"doc","content":[]}}).to_string(),
                )),
                ..Default::default()
            },
            _ => EntryPatch {
                body_format: Some(Some("tiptap_json".into())),
                ..Default::default()
            },
        };
        let changed = service.update_entry(&note.id, patch).unwrap();
        validation(service.submit_chat(submit_request(&chat, &note)));
        assert_eq!(service.get_or_create_note_entry(&id).unwrap(), changed);
        assert_eq!(service.load_chat(&id).unwrap(), chat);
    }
}

#[test]
fn running_empty_foreign_and_non_primary_note_submissions_are_rejected() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let note = service.get_or_create_note_entry(&id).unwrap();
    let chat = service.load_chat(&id).unwrap();
    validation(service.submit_chat(submit_request(&chat, &note)));
    let saved = save(&service, &chat, "Question");
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&saved),
        })
        .unwrap();
    validation(service.submit_chat(submit_request(&started.chat, &note)));
    validation(service.restart_chat(ChatRestartRequest {
        scope: scope(&started.chat),
    }));
    let done = service
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            assistant_text: "Answer".into(),
        })
        .unwrap();
    let other = session(&service);
    let foreign = service.get_or_create_note_entry(&other).unwrap();
    validation(service.submit_chat(submit_request(&done, &foreign)));
    let secondary = service
        .create_entry(qa_scribe_core::domain::EntryDraft {
            session_id: id.clone(),
            entry_type: qa_scribe_core::domain::EntryType::Note,
            title: None,
            body: String::new(),
            body_json: None,
            body_format: None,
            metadata_json: None,
            excluded_from_generation: false,
        })
        .unwrap();
    // Ensure deterministic primary ordering even on clocks with millisecond ties.
    service
        .database()
        .connection()
        .execute(
            "UPDATE entries SET created_at = '9999-01-01' WHERE id = ?1",
            [&secondary.id],
        )
        .unwrap();
    validation(service.submit_chat(submit_request(&done, &secondary)));
    assert_eq!(service.get_or_create_note_entry(&id).unwrap(), note);
    assert_eq!(service.load_chat(&id).unwrap(), done);
}

#[test]
fn invalid_rich_json_and_note_overflow_do_not_commit_submission_receipt() {
    for (body, json) in [
        ("<p>Existing</p>".into(), Some("{}".into())),
        (format!("<p>{}</p>", "x".repeat(99_980)), None),
    ] {
        let service = SessionService::in_memory().unwrap();
        let id = session(&service);
        let note = service.get_or_create_note_entry(&id).unwrap();
        let note = service
            .update_entry(
                &note.id,
                EntryPatch {
                    body: Some(body),
                    body_json: Some(json),
                    ..Default::default()
                },
            )
            .unwrap();
        let chat = complete(
            &service,
            &service.load_chat(&id).unwrap(),
            "Question",
            "Long enough answer",
        );
        validation(service.submit_chat(submit_request(&chat, &note)));
        assert_eq!(service.get_or_create_note_entry(&id).unwrap(), note);
        assert_eq!(service.load_chat(&id).unwrap(), chat);
    }
}

#[test]
fn receipt_survives_reopen_and_repeat_submission_preserves_later_note_edits() {
    let dir = helpers::unique_temp_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("chat.sqlite");
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let id = session(&service);
    let note = service.get_or_create_note_entry(&id).unwrap();
    let chat = complete(&service, &service.load_chat(&id).unwrap(), "Q", "A");
    let receipt = service.submit_chat(submit_request(&chat, &note)).unwrap();
    let edited = service
        .update_entry(
            &note.id,
            EntryPatch {
                body: Some("<p>User edited submitted Note</p>".into()),
                ..Default::default()
            },
        )
        .unwrap();
    drop(service);
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    assert_eq!(
        service.load_chat(&id).unwrap().submission,
        Some(receipt.clone())
    );
    assert_eq!(
        service.submit_chat(submit_request(&chat, &note)).unwrap(),
        receipt
    );
    assert_eq!(service.get_or_create_note_entry(&id).unwrap(), edited);
    let sql_result = service.database().connection().execute(
        "UPDATE chat_drafts SET submitted_at = 'tampered' WHERE id = ?1",
        [&chat.draft_id],
    );
    assert!(
        sql_result.is_err(),
        "receipt must be immutable at the storage boundary"
    );
    service.delete_session(&id).unwrap();
    assert_eq!(
        helpers::count_rows(service.database().connection(), "chat_messages"),
        0
    );
    drop(service);
    std::fs::remove_dir_all(dir).unwrap();
}
