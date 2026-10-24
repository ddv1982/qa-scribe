use super::*;

#[test]
fn assistant_markdown_submission_formats_html_and_json_and_preserves_user_literals() {
    for rich in [false, true] {
        let service = SessionService::in_memory().unwrap();
        let id = session(&service);
        let note = service.get_or_create_note_entry(&id).unwrap();
        let original = json!({"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Existing"}]}]}});
        let note = service
            .update_entry(
                &note.id,
                EntryPatch {
                    body: Some("<p>Existing</p>".into()),
                    body_json: Some(rich.then(|| original.to_string())),
                    body_format: Some(Some(if rich { "tiptap_json" } else { "html" }.into())),
                    ..Default::default()
                },
            )
            .unwrap();
        let assistant = "# Requirements\n\n**Important** and *context*\n\n- Parent\n  - Nested\n\n- [x] Verified\n\n[Reference](https://example.com)\n\n<img src=\"https://example.test/literal-raw\"><strong>raw example</strong>\n\n```html\n<img src=\"https://example.test/literal-code\"><strong>code example</strong>\n```\n\n7. Seventh\n8. Eighth";
        let chat = complete(
            &service,
            &service.load_chat(&id).unwrap(),
            "**Keep literal**",
            assistant,
        );
        let before_revision = service
            .note_source(&id, &note.id)
            .unwrap()
            .unwrap()
            .revision;
        let receipt = service.submit_chat(submit_request(&chat, &note)).unwrap();
        assert_eq!(
            service
                .note_source(&id, &note.id)
                .unwrap()
                .unwrap()
                .revision,
            before_revision + 1
        );
        let result = service.get_or_create_note_entry(&id).unwrap();
        assert!(result.body.starts_with("<p>Existing</p>"));
        assert!(
            result.body.contains("<h2>Requirements</h2>"),
            "{}",
            result.body
        );
        assert!(result.body.contains("<strong>Important</strong>"));
        assert!(result.body.contains("<em>context</em>"));
        assert!(result.body.contains("<ul>"));
        assert!(result.body.contains("data-type=\"taskList\""));
        assert!(result.body.contains("href=\"https://example.com\""));
        assert!(result.body.contains("**Keep literal**"));
        assert!(!result.body.contains("<img"));
        assert!(result.body.contains("&lt;img"));
        assert!(
            result
                .body
                .contains("&lt;strong&gt;code example&lt;/strong&gt;")
        );
        assert!(result.body.contains("<ol start=\"7\">"));
        if rich {
            let parsed: Value = serde_json::from_str(result.body_json.as_ref().unwrap()).unwrap();
            let nodes = parsed["doc"]["content"].as_array().unwrap();
            assert_eq!(nodes[0], original["doc"]["content"][0]);
            assert!(
                nodes
                    .iter()
                    .any(|node| node["type"] == "heading" && node["attrs"]["level"] == 2)
            );
            let serialized = parsed.to_string();
            for kind in [
                "bold",
                "italic",
                "bulletList",
                "taskList",
                "taskItem",
                "link",
            ] {
                assert!(
                    serialized.contains(&format!("\"type\":\"{kind}\"")),
                    "missing {kind}"
                );
            }
        } else {
            assert!(result.body_json.is_none());
        }
        assert_eq!(
            service.submit_chat(submit_request(&chat, &note)).unwrap(),
            receipt
        );
        assert_eq!(service.get_or_create_note_entry(&id).unwrap(), result);
        assert_eq!(service.load_chat(&id).unwrap().messages, chat.messages);
    }
}

#[test]
fn markdown_fallbacks_keep_text_boundaries_and_block_unsafe_resources() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let note = service.get_or_create_note_entry(&id).unwrap();
    let note = service
        .update_entry(
            &note.id,
            EntryPatch {
                body_json: Some(Some(
                    json!({"schemaVersion":1,"doc":{"type":"doc","content":[]}}).to_string(),
                )),
                body_format: Some(Some("tiptap_json".into())),
                ..Default::default()
            },
        )
        .unwrap();
    let text = "###### Deep heading\n\n`inline` and ~~retained~~\n\n> Quote α\n> next β\n\n```sql\nselect '<x>';\nsecond line\n```\n\n| Name | Result |\n| --- | --- |\n| α | Pass |\n\n![Evidence](https://example.com/tracker)\n\n[Bad](javascript:alert%281%29) [Local](file:///tmp/private) [Relative](/settings)\n\n[Good](https://example.com?a=1&b=2)\n\n<script>alert(1)</script>\n\n1. First\n2. Second";
    let chat = complete(&service, &service.load_chat(&id).unwrap(), "Literal", text);
    service.submit_chat(submit_request(&chat, &note)).unwrap();
    let result = service.get_or_create_note_entry(&id).unwrap();
    for fragment in [
        "<h3>Deep heading</h3>",
        "inline",
        "retained",
        "Quote α<br>next β",
        "select &#39;&lt;x&gt;&#39;;<br>second line",
        "Name | Result",
        "α | Pass",
        "Evidence",
        "&lt;script&gt;alert(1)&lt;/script&gt;",
        "<ol start=\"1\">",
    ] {
        assert!(
            result.body.contains(fragment),
            "missing {fragment}: {}",
            result.body
        );
    }
    for forbidden in [
        "<script",
        "<img",
        "href=\"javascript:",
        "href=\"file:",
        "href=\"/settings",
        "<table",
        "<code",
        "<blockquote",
    ] {
        assert!(!result.body.contains(forbidden), "unexpected {forbidden}");
    }
    let document: Value = serde_json::from_str(result.body_json.as_ref().unwrap()).unwrap();
    let serialized = document.to_string();
    assert!(!serialized.contains("tracker"));
    assert!(!serialized.contains("javascript:"));
    for text in [
        "Deep heading",
        "Quote α",
        "next β",
        "second line",
        "Evidence",
        "Bad",
        "Local",
        "Relative",
        "Good",
        "First",
        "Second",
    ] {
        assert!(serialized.contains(text), "JSON lost {text}");
    }
}

#[test]
fn markdown_expansion_overflow_rolls_back_note_and_receipt() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let note = service.get_or_create_note_entry(&id).unwrap();
    let note = service
        .update_entry(
            &note.id,
            EntryPatch {
                body: Some(format!("<p>{}</p>", "x".repeat(70_000))),
                ..Default::default()
            },
        )
        .unwrap();
    let text = "*x* ".repeat(3000);
    let chat = complete(&service, &service.load_chat(&id).unwrap(), "Q", &text);
    validation(service.submit_chat(submit_request(&chat, &note)));
    assert_eq!(service.get_or_create_note_entry(&id).unwrap(), note);
    assert_eq!(service.load_chat(&id).unwrap(), chat);
}

#[test]
fn deep_markdown_nesting_falls_back_to_readable_literal_content() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let note = service.get_or_create_note_entry(&id).unwrap();
    let text = format!("{}Deep content", "> ".repeat(64));
    let chat = complete(&service, &service.load_chat(&id).unwrap(), "Q", &text);
    service.submit_chat(submit_request(&chat, &note)).unwrap();
    let result = service.get_or_create_note_entry(&id).unwrap();
    assert!(result.body.contains("Deep content"));
    assert!(result.body.contains("&gt; &gt;"));
}

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
        attachment_ids: vec![],
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
