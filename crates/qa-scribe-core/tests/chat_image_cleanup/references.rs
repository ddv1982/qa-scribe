use super::*;
use rusqlite::params;

#[test]
fn release_preserves_notes_evidence_drafts_findings_and_generation_owners() {
    for owner in [
        "note",
        "note_json",
        "draft",
        "finding",
        "evidence",
        "generation",
    ] {
        let f = Fixture::new();
        let chat = f.import(&f.service.load_chat(&f.session).unwrap());
        let a = f.attachment(&chat);
        let c = f.service.database().connection();
        let reference = format!("qa-scribe-attachment://{}", a.id);
        match owner {
            "note" | "note_json" => {
                let note = f.service.get_or_create_note_entry(&f.session).unwrap();
                f.service
                    .update_entry(
                        &note.id,
                        EntryPatch {
                            body: Some(if owner == "note" {
                                format!("<img src=\"{reference}\">")
                            } else {
                                "JSON only".into()
                            }),
                            body_json: if owner == "note_json" {
                                Some(Some(serde_json::json!({"attachmentId": a.id}).to_string()))
                            } else {
                                None
                            },
                            ..Default::default()
                        },
                    )
                    .unwrap();
            }
            "draft" => {
                c.execute("INSERT INTO drafts (id,session_id,kind,title,body,created_at,updated_at) VALUES ('d',?1,'testware','Keep',?2,'t','t')", params![f.session, reference]).unwrap();
            }
            "finding" | "evidence" => {
                c.execute("INSERT INTO findings (id,session_id,title,body,kind,created_at,updated_at) VALUES ('f',?1,'Keep',?2,'note','t','t')", params![f.session, if owner == "finding" { &reference } else { "keep" }]).unwrap();
                if owner == "evidence" {
                    c.execute("INSERT INTO evidence_links (id,finding_id,attachment_id,created_at) VALUES ('e','f',?1,'t')", [&a.id]).unwrap();
                }
            }
            "generation" => {
                c.execute("INSERT INTO generation_contexts (id,session_id,created_at) VALUES ('g',?1,'t')", [&f.session]).unwrap();
                c.execute("INSERT INTO generation_context_attachments (id,generation_context_id,attachment_id) VALUES ('ga','g',?1)", [&a.id]).unwrap();
            }
            _ => unreachable!(),
        }
        f.service
            .save_chat_composer(request(&chat, vec![]))
            .unwrap();
        f.retry();
        assert_eq!(pending(&f.service), 0, "{owner}");
        assert_eq!(
            f.service.get_attachment(&a.id).unwrap(),
            Some(a.clone()),
            "{owner}"
        );
        assert_eq!(
            fs::read(f.root.join(a.relative_path)).unwrap(),
            include_bytes!("../../../../e2e/fixtures/chat-image-pixels.png")
        );
    }
}

#[test]
fn release_preserves_shared_messages_archived_composers_and_submitted_messages() {
    for owner in [
        "message",
        "archived_message",
        "archived_composer",
        "submitted",
    ] {
        let f = Fixture::new();
        let mut chat = f.import(&f.service.load_chat(&f.session).unwrap());
        let a = f.attachment(&chat);
        if owner != "archived_composer" {
            let turn = f
                .service
                .start_chat_turn(ChatStartRequest {
                    scope: scope(&chat),
                })
                .unwrap();
            chat = f
                .service
                .finish_chat_turn(ChatFinishRequest {
                    scope: scope(&turn.chat),
                    turn_id: turn.turn_id,
                    assistant_text: "Seen".into(),
                })
                .unwrap();
        }
        if owner == "submitted" {
            let note = f.service.get_or_create_note_entry(&f.session).unwrap();
            f.service
                .submit_chat(ChatSubmitRequest {
                    scope: scope(&chat),
                    note_id: note.id,
                    expected_note_body: note.body,
                    expected_note_body_json: note.body_json,
                    expected_note_body_format: note.body_format,
                })
                .unwrap();
            chat = f.service.load_chat(&f.session).unwrap();
        }
        if owner != "message" {
            chat = f
                .service
                .restart_chat(ChatRestartRequest {
                    scope: scope(&chat),
                })
                .unwrap();
        }
        f.service.database().connection().execute("INSERT INTO chat_composer_images (draft_id,attachment_id,ordinal) VALUES (?1,?2,0)", params![chat.draft_id,a.id]).unwrap();
        chat = f.service.load_chat(&f.session).unwrap();
        f.service
            .save_chat_composer(request(&chat, vec![]))
            .unwrap();
        f.retry();
        assert_eq!(pending(&f.service), 0, "{owner}");
        assert_eq!(
            f.service.get_attachment(&a.id).unwrap(),
            Some(a.clone()),
            "{owner}"
        );
        assert_eq!(
            fs::read(f.root.join(a.relative_path)).unwrap(),
            include_bytes!("../../../../e2e/fixtures/chat-image-pixels.png")
        );
    }
}

#[test]
fn shared_path_alias_keeps_pixels_until_both_composer_owners_release() {
    let f = Fixture::new();
    let chat = f.import(&f.service.load_chat(&f.session).unwrap());
    let a = f.attachment(&chat);
    let b = f
        .service
        .create_attachment(AttachmentDraft {
            session_id: f.session.clone(),
            entry_id: None,
            filename: a.filename.clone(),
            mime_type: a.mime_type.clone(),
            size_bytes: a.size_bytes,
            sha256: a.sha256.clone(),
            relative_path: a.relative_path.clone(),
        })
        .unwrap();
    f.service
        .database()
        .connection()
        .execute(
            "INSERT INTO chat_composer_images (draft_id,attachment_id,ordinal) VALUES (?1,?2,1)",
            params![chat.draft_id, b.id],
        )
        .unwrap();
    let chat = f.service.load_chat(&f.session).unwrap();
    let chat = f
        .service
        .save_chat_composer(request(&chat, vec![b.id.clone()]))
        .unwrap();
    assert!(f.service.get_attachment(&a.id).unwrap().is_none());
    assert_eq!(
        retry_attachment_cleanup(&f.service, &f.root)
            .unwrap()
            .pending_files,
        Some(1)
    );
    assert!(f.root.join(&a.relative_path).is_file());
    f.service
        .save_chat_composer(request(&chat, vec![]))
        .unwrap();
    f.retry();
    assert!(f.service.get_attachment(&b.id).unwrap().is_none());
    assert!(!f.root.join(a.relative_path).exists());
}
