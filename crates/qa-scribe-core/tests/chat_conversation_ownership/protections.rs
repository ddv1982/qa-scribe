use super::*;

#[test]
fn record_conversations_cannot_submit_restart_or_replay_a_notes_receipt() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let notes = service.load_chat(&id).unwrap();
    let note = service.get_or_create_note_entry(&id).unwrap();
    let record = finding(&service, &id);
    let chat = service.begin_record_chat(launch(&id, &record)).unwrap();
    let chat = complete(&service, &chat);
    assert!(service.submit_chat(submit(&chat, &note)).is_err());
    assert!(
        service
            .restart_chat(ChatRestartRequest {
                scope: scope(&chat)
            })
            .is_err()
    );
    assert_eq!(service.read_chat(&reference(&chat)).unwrap(), chat);
    assert_eq!(service.load_chat(&id).unwrap(), notes);
    assert_eq!(service.get_or_create_note_entry(&id).unwrap(), note);
    service.database().connection().execute("UPDATE chat_drafts SET submitted_note_id=?1,submitted_at='synthetic-receipt' WHERE id=?2", rusqlite::params![note.id, chat.draft_id]).unwrap();
    assert!(service.submit_chat(submit(&chat, &note)).is_err());
    assert_eq!(service.get_or_create_note_entry(&id).unwrap(), note);
}

#[test]
fn prepared_intent_is_unsent_input_even_when_text_is_empty() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let chat = complete(&service, &service.load_chat(&id).unwrap());
    let note = service.get_or_create_note_entry(&id).unwrap();
    for intent in [
        ChatComposerIntent::RefineRecord,
        ChatComposerIntent::DraftJira,
    ] {
        let prepared = service
            .save_chat_composer(composer(&service.load_chat(&id).unwrap(), "", intent))
            .unwrap();
        assert!(service.submit_chat(submit(&prepared, &note)).is_err());
        assert_eq!(service.get_or_create_note_entry(&id).unwrap(), note);
        assert_eq!(service.load_chat(&id).unwrap(), prepared);
    }
    let cleared = service
        .save_chat_composer(composer(
            &service.load_chat(&id).unwrap(),
            "",
            ChatComposerIntent::Message,
        ))
        .unwrap();
    assert_eq!(cleared.messages, chat.messages);
    assert_eq!(
        service
            .submit_chat(submit(&cleared, &note))
            .unwrap()
            .draft_id,
        chat.draft_id
    );
}

#[test]
fn submitted_content_is_frozen_but_activation_and_exact_receipt_replay_remain_valid() {
    let (dir, service) = frozen_service();
    let reference = ChatRef {
        session_id: "isolation-submitted".into(),
        draft_id: "isolation-submitted-chat".into(),
    };
    let chat = service.read_chat(&reference).unwrap();
    let note = service.get_or_create_note_entry(&chat.session_id).unwrap();
    let activated = service.activate_chat(&reference).unwrap();
    assert_eq!(activated.revision, chat.revision);
    assert_eq!(activated.messages, chat.messages);
    assert_eq!(activated.submission, chat.submission);
    assert!(activated.last_active_order > chat.last_active_order);
    assert_eq!(
        service.submit_chat(submit(&chat, &note)).unwrap(),
        chat.submission.clone().unwrap()
    );
    assert!(
        service
            .save_chat_composer(composer(&activated, "Changed", ChatComposerIntent::Message))
            .is_err()
    );
    let c = service.database().connection();
    for update in [
        "composer='Changed'",
        "composer_intent='draft_jira'",
        "mode='chat'",
        "revision=revision+1",
        "submitted_note_id='changed'",
        "submitted_at=NULL",
    ] {
        assert!(
            c.execute(
                &format!("UPDATE chat_drafts SET {update} WHERE id='isolation-submitted-chat'"),
                []
            )
            .is_err(),
            "{update}"
        );
    }
    for sql in [
        "UPDATE chat_messages SET text='changed' WHERE draft_id='isolation-submitted-chat'",
        "DELETE FROM chat_messages WHERE draft_id='isolation-submitted-chat'",
        "INSERT INTO chat_messages(id,draft_id,turn_id,sequence,role,text,status,created_at) VALUES ('bad','isolation-submitted-chat','bad',99,'user','changed','completed','t')",
    ] {
        assert!(c.execute(sql, []).is_err(), "{sql}");
    }
    assert_eq!(service.read_chat(&reference).unwrap(), activated);
    assert_eq!(
        service.get_or_create_note_entry(&chat.session_id).unwrap(),
        note
    );
    drop(service);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn archived_scoped_reads_do_not_activate_or_allow_edits_and_never_create_missing_rows() {
    let (dir, service) = frozen_service();
    let reference = ChatRef {
        session_id: "perf-session".into(),
        draft_id: "isolation-history-000".into(),
    };
    let chat = service.read_chat(&reference).unwrap();
    assert!(chat.archived);
    assert_eq!(chat.messages.len(), 10);
    assert!(
        service
            .save_chat_composer(composer(&chat, "Changed", ChatComposerIntent::Message))
            .is_err()
    );
    assert!(
        service
            .start_chat_turn(ChatStartRequest {
                scope: scope(&chat)
            })
            .is_err()
    );
    let record = finding(&service, "perf-session");
    let record_chat = service
        .begin_record_chat(launch("perf-session", &record))
        .unwrap();
    let history = service
        .list_chat_history(ChatHistoryScope::Record {
            session_id: "perf-session".into(),
            record,
        })
        .unwrap();
    assert_eq!(
        history.iter().map(|h| &h.reference).collect::<Vec<_>>(),
        vec![&super::reference(&record_chat)]
    );
    assert_eq!(
        service
            .list_chat_history(ChatHistoryScope::Notes {
                session_id: "perf-session".into()
            })
            .unwrap()
            .len(),
        101
    );
    assert_eq!(service.read_chat(&reference).unwrap(), chat);
    assert!(
        service
            .read_chat(&ChatRef {
                draft_id: "absent".into(),
                ..reference.clone()
            })
            .is_err()
    );
    assert_eq!(
        service
            .list_chat_history(ChatHistoryScope::Session {
                session_id: "perf-session".into()
            })
            .unwrap()
            .len(),
        102
    );
    let activated = service.activate_chat(&reference).unwrap();
    assert_eq!(activated.revision, chat.revision);
    assert!(activated.archived);
    drop(service);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn sqlite_enforces_owner_shape_identity_and_notes_only_uniqueness() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let notes = service.load_chat(&id).unwrap();
    let c = service.database().connection();
    for (kind, record) in [
        ("notes", Some("record")),
        ("finding", None),
        ("test_cases_draft", None),
        ("finding", Some(" ")),
        ("unknown", Some("record")),
    ] {
        assert!(c.execute("INSERT INTO chat_drafts(id,session_id,owner_kind,owner_record_id,created_at) VALUES ('bad',?1,?2,?3,'t')", rusqlite::params![id, kind, record]).is_err());
    }
    for field in [
        "owner_kind='finding'",
        "owner_record_id='record'",
        "id='changed'",
        "session_id='changed'",
        "composer_intent='retry'",
    ] {
        assert!(
            c.execute(
                &format!("UPDATE chat_drafts SET {field} WHERE id=?1"),
                [&notes.draft_id]
            )
            .is_err(),
            "{field}"
        );
    }
    assert!(
        c.execute(
            "INSERT INTO chat_drafts(id,session_id,created_at) VALUES ('duplicate-notes',?1,'t')",
            [&id]
        )
        .is_err()
    );
    let record = finding(&service, &id);
    let a = service.begin_record_chat(launch(&id, &record)).unwrap();
    let b = service.begin_record_chat(launch(&id, &record)).unwrap();
    assert_ne!(a.draft_id, b.draft_id);
    assert_eq!(service.load_chat(&id).unwrap(), notes);
}

#[test]
fn record_images_and_prepared_intent_save_atomically_and_never_attach_to_notes() {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use qa_scribe_core::attachments::chat::import_chat_image_data_url;
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let notes = service.load_chat(&id).unwrap();
    let record = finding(&service, &id);
    let chat = service.begin_record_chat(launch(&id, &record)).unwrap();
    let dir = std::env::temp_dir().join(format!("qa-owned-images-{}", uuid::Uuid::new_v4()));
    let data_url = format!(
        "data:image/png;base64,{}",
        STANDARD.encode(include_bytes!(
            "../../../../e2e/fixtures/chat-image-pixels.png"
        ))
    );
    let chat =
        import_chat_image_data_url(&service, &dir, scope(&chat), "owned.png".into(), &data_url)
            .unwrap();
    let saved = service
        .save_chat_composer(composer(&chat, "", ChatComposerIntent::DraftJira))
        .unwrap();
    assert_eq!(saved.composer_images.len(), 1);
    assert_eq!(saved.composer_intent, ChatComposerIntent::DraftJira);
    assert_eq!(
        service
            .save_chat_composer(composer(&saved, "", ChatComposerIntent::DraftJira))
            .unwrap(),
        saved
    );
    let mut foreign_image = composer(&notes, "Must not steal", ChatComposerIntent::Message);
    foreign_image.attachment_ids = vec![saved.composer_images[0].attachment_id.clone()];
    assert!(service.save_chat_composer(foreign_image).is_err());
    assert_eq!(service.load_chat(&id).unwrap(), notes);
    let mut invalid = composer(&saved, "Must roll back", ChatComposerIntent::RefineRecord);
    invalid.attachment_ids.push("not-imported".into());
    assert!(service.save_chat_composer(invalid).is_err());
    assert_eq!(service.read_chat(&reference(&saved)).unwrap(), saved);
    let attachment = service
        .get_attachment(&saved.composer_images[0].attachment_id)
        .unwrap()
        .unwrap();
    let bytes = std::fs::read(dir.join(&attachment.relative_path)).unwrap();
    use sha2::{Digest, Sha256};
    assert_eq!(format!("{:x}", Sha256::digest(&bytes)), attachment.sha256);
    assert!(
        service
            .list_chat_history(ChatHistoryScope::Record {
                session_id: id.clone(),
                record
            })
            .unwrap()[0]
            .has_content
    );
    service.delete_session(&id).unwrap();
    std::fs::remove_dir_all(dir).unwrap();
}
