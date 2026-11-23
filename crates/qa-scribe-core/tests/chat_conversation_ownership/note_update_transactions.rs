use super::*;

#[test]
fn note_proposal_updates_and_undoes_the_saved_body_and_rejects_newer_edits() {
    let service = SessionService::in_memory().unwrap();
    let session_id = session(&service);
    set_note(&service, &session_id, "<p>Before rewrite</p>".into());
    let before = service.get_or_create_note_entry(&session_id).unwrap();
    let chat = notes_turn(
        &service,
        &session_id,
        json!({"kind":"edit","patch":{"kind":"note","bodyMarkdown":"## Setup\n\n- Current checks"}}),
    );
    let request = |undo| ApplyNoteRefinementRequest {
        reference: ChatRef {
            session_id: session_id.clone(),
            draft_id: chat.draft_id.clone(),
        },
        proposal_id: chat.proposals[0].id.clone(),
        undo,
    };

    let saved = service.apply_note_refinement(request(false)).unwrap();
    assert_eq!(saved.chat.proposals[0].state, RefinementState::NoteApplied);
    assert!(saved.note.body.contains("Current checks"));
    assert_eq!(
        service.get_or_create_note_entry(&session_id).unwrap().body,
        saved.note.body
    );
    let restored = service.apply_note_refinement(request(true)).unwrap();
    assert_eq!(restored.chat.proposals[0].state, RefinementState::Offered);
    assert_eq!(restored.note.body, before.body);
    assert_eq!(restored.note.body_json, before.body_json);
    assert_eq!(restored.note.body_format, before.body_format);

    service.apply_note_refinement(request(false)).unwrap();
    set_note(&service, &session_id, "<p>New manual edit</p>".into());
    assert!(service.apply_note_refinement(request(true)).is_err());
    assert_eq!(
        service.load_chat(&session_id).unwrap().proposals[0].state,
        RefinementState::NoteApplied
    );
    assert!(
        service
            .get_or_create_note_entry(&session_id)
            .unwrap()
            .body
            .contains("New manual edit")
    );
}

#[test]
fn retries_a_prose_reply_as_a_local_refinement_of_the_current_note() {
    let service = SessionService::in_memory().unwrap();
    let session_id = session(&service);
    let chat = notes_turn(&service, &session_id, json!({"kind":"answer"}));
    let assistant = chat.messages.last().unwrap();
    let started = service
        .start_chat_turn_with_response(
            ChatStartRequest {
                scope: scope(&chat),
            },
            ChatTarget::Session,
            ChatRequestIntent::SuggestEdit {
                assistant_message_id: Some(assistant.id.clone()),
            },
        )
        .unwrap();
    let user = started.chat.messages.last().unwrap();
    assert_eq!(user.text, "Make my note clearer");
    assert!(
        service
            .response_contract(&user.id)
            .unwrap()
            .unwrap()
            .local_edit()
    );

    let completed = service.finish_chat_turn(ChatFinishRequest {
        scope: scope(&started.chat),
        turn_id: started.turn_id,
        assistant_text: json!({"version":3,"requestId":user.id,"markdown":"I updated the note.","outcome":{"kind":"answer"}}).to_string(),
    }).unwrap();
    assert!(completed.proposals.is_empty());
    assert!(
        completed
            .messages
            .last()
            .unwrap()
            .response
            .as_ref()
            .unwrap()
            .warning
            .as_deref()
            .is_some_and(|warning| warning.starts_with("No edit was created"))
    );
}

#[test]
fn failure_to_record_note_proposal_rolls_back_the_body_and_undo_record() {
    let service = SessionService::in_memory().unwrap();
    let session_id = session(&service);
    set_note(&service, &session_id, "<p>Before rewrite</p>".into());
    let before = service.get_or_create_note_entry(&session_id).unwrap();
    let chat = notes_turn(
        &service,
        &session_id,
        json!({"kind":"edit","patch":{"kind":"note","bodyMarkdown":"Proposed rewrite"}}),
    );
    service.database().connection().execute_batch(
        "CREATE TRIGGER test_reject_note_proposal BEFORE UPDATE ON chat_refinements BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;"
    ).unwrap();
    let request = ApplyNoteRefinementRequest {
        reference: ChatRef {
            session_id: session_id.clone(),
            draft_id: chat.draft_id.clone(),
        },
        proposal_id: chat.proposals[0].id.clone(),
        undo: false,
    };

    assert!(service.apply_note_refinement(request.clone()).is_err());
    assert_eq!(
        service.get_or_create_note_entry(&session_id).unwrap().body,
        before.body
    );
    assert_eq!(
        service.load_chat(&session_id).unwrap().proposals[0].state,
        RefinementState::Offered
    );
    service
        .database()
        .connection()
        .execute_batch("DROP TRIGGER test_reject_note_proposal")
        .unwrap();
    assert!(
        service.apply_note_refinement(request).is_ok(),
        "the failed transaction left no undo row behind"
    );
}

#[test]
fn note_update_rejects_newer_rich_json_when_the_html_is_unchanged() {
    let service = SessionService::in_memory().unwrap();
    let session_id = session(&service);
    set_note(&service, &session_id, "<p>Original</p>".into());
    let note = service.get_or_create_note_entry(&session_id).unwrap();
    let chat = notes_turn(
        &service,
        &session_id,
        json!({"kind":"edit","patch":{"kind":"note","bodyMarkdown":"Proposed rewrite"}}),
    );
    let newer = service.update_entry(&note.id, EntryPatch {
        body_json: Some(Some(json!({"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Richer newer content"}]}]}}).to_string())),
        ..EntryPatch::default()
    }).unwrap();
    assert_eq!(newer.body, note.body);
    assert!(
        service
            .apply_note_refinement(ApplyNoteRefinementRequest {
                reference: ChatRef {
                    session_id: session_id.clone(),
                    draft_id: chat.draft_id
                },
                proposal_id: chat.proposals[0].id.clone(),
                undo: false,
            })
            .is_err()
    );
    assert_eq!(
        service
            .get_or_create_note_entry(&session_id)
            .unwrap()
            .body_json,
        newer.body_json
    );
}

#[test]
fn consecutive_note_updates_can_be_undone_in_order() {
    let service = SessionService::in_memory().unwrap();
    let session_id = session(&service);
    set_note(&service, &session_id, "<p>Original</p>".into());
    let first = notes_turn(
        &service,
        &session_id,
        json!({"kind":"edit","patch":{"kind":"note","bodyMarkdown":"First rewrite"}}),
    );
    let request = |chat: &ChatState, index: usize, undo| ApplyNoteRefinementRequest {
        reference: ChatRef {
            session_id: session_id.clone(),
            draft_id: chat.draft_id.clone(),
        },
        proposal_id: chat.proposals[index].id.clone(),
        undo,
    };
    service
        .apply_note_refinement(request(&first, 0, false))
        .unwrap();
    let second = notes_turn(
        &service,
        &session_id,
        json!({"kind":"edit","patch":{"kind":"note","bodyMarkdown":"Second rewrite"}}),
    );
    service
        .apply_note_refinement(request(&second, 1, false))
        .unwrap();
    assert!(
        service
            .apply_note_refinement(request(&first, 0, true))
            .is_err()
    );
    let restored = service
        .apply_note_refinement(request(&second, 1, true))
        .unwrap();
    assert!(restored.note.body.contains("First rewrite"));
    assert_eq!(
        service
            .apply_note_refinement(request(&first, 0, true))
            .unwrap()
            .note
            .body,
        "<p>Original</p>"
    );
}
