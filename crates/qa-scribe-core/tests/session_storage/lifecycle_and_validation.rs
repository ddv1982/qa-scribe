#[test]
fn session_library_create_reopen_update_delete_flow() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: " Checkout testing ".to_string(),
            session_context: Some("Cart and payment flow".to_string()),
            objective_notes: Some("Verify coupon edge cases".to_string()),
            environment: Some("staging".to_string()),
            build_version: Some("2026.06.22".to_string()),
            related_reference: Some("QA-42".to_string()),
        })
        .expect("session should be created");

    assert_eq!(session.title, "Checkout testing");
    assert_eq!(
        service.list_sessions().expect("sessions should list").len(),
        1
    );

    let reopened = service
        .reopen_session(&session.id)
        .expect("session should reopen");
    assert_eq!(reopened.id, session.id);
    assert!(reopened.last_opened_at >= session.last_opened_at);

    let updated = service
        .update_session(
            &session.id,
            SessionPatch {
                title: Some("Checkout regression".to_string()),
                environment: Some(Some("prod-like".to_string())),
                ..SessionPatch::default()
            },
        )
        .expect("session should update");

    assert_eq!(updated.title, "Checkout regression");
    assert_eq!(updated.environment.as_deref(), Some("prod-like"));

    service
        .delete_session(&session.id)
        .expect("session should delete");
    assert!(
        service
            .get_session(&session.id)
            .expect("query should succeed")
            .is_none()
    );
}

#[test]
fn rich_body_json_round_trips_for_entries_findings_and_drafts() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Rich text storage".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let body_json = r#"{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Stored JSON"}]}]}}"#;
    let updated_body_json = r#"{"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Updated JSON"}]}]}}"#;

    let entry = service
        .create_entry(EntryDraft {
            session_id: session.id.clone(),
            entry_type: EntryType::Note,
            title: Some("Note body".to_string()),
            body: "<p>Stored JSON</p>".to_string(),
            body_json: Some(body_json.to_string()),
            body_format: Some("tiptap_json".to_string()),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("entry should create with rich body JSON");
    assert_eq!(entry.body_json.as_deref(), Some(body_json));
    assert_eq!(entry.body_format.as_deref(), Some("tiptap_json"));
    let entry = service
        .update_entry(
            &entry.id,
            EntryPatch {
                body: Some("<p>Updated JSON</p>".to_string()),
                body_json: Some(Some(updated_body_json.to_string())),
                body_format: Some(Some("tiptap_json".to_string())),
                ..EntryPatch::default()
            },
        )
        .expect("entry should update rich body JSON");
    assert_eq!(entry.body_json.as_deref(), Some(updated_body_json));

    let finding = service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Finding".to_string(),
            body: "<p>Stored JSON</p>".to_string(),
            body_json: Some(body_json.to_string()),
            body_format: Some("tiptap_json".to_string()),
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .expect("finding should create with rich body JSON");
    assert_eq!(finding.body_json.as_deref(), Some(body_json));
    let finding = service
        .update_finding(
            &finding.id,
            FindingPatch {
                body: Some("<p>Updated JSON</p>".to_string()),
                body_json: Some(Some(updated_body_json.to_string())),
                body_format: Some(Some("tiptap_json".to_string())),
                kind: Some(FindingKind::Risk),
                metadata_json: Some(Some(r#"{"severity":"high"}"#.to_string())),
                ..FindingPatch::default()
            },
        )
        .expect("finding should update rich body JSON");
    assert_eq!(finding.body_json.as_deref(), Some(updated_body_json));
    assert_eq!(finding.kind, FindingKind::Risk);
    assert_eq!(finding.metadata_json.as_deref(), Some(r#"{"severity":"high"}"#));

    let draft = service
        .create_draft(DraftCreate {
            session_id: session.id,
            ai_run_id: None,
            kind: DraftKind::Testware,
            title: "Draft".to_string(),
            body: "<p>Stored JSON</p>".to_string(),
            body_json: Some(body_json.to_string()),
            body_format: Some("tiptap_json".to_string()),
            metadata_json: None,
        })
        .expect("draft should create with rich body JSON");
    assert_eq!(draft.body_json.as_deref(), Some(body_json));
    let draft = service
        .update_draft(
            &draft.id,
            DraftPatch {
                body: Some("<p>Updated JSON</p>".to_string()),
                body_json: Some(Some(updated_body_json.to_string())),
                body_format: Some(Some("tiptap_json".to_string())),
                ..DraftPatch::default()
            },
        )
        .expect("draft should update rich body JSON");
    assert_eq!(draft.body_json.as_deref(), Some(updated_body_json));
}

#[test]
fn rich_text_bodies_can_be_blank() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Blank body flow".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");

    let entry = service
        .create_entry(EntryDraft {
            session_id: session.id.clone(),
            entry_type: EntryType::Note,
            title: Some("Editable note".to_string()),
            body: "".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("blank entry body should be accepted");
    assert_eq!(entry.body, "");

    let entry = service
        .update_entry(
            &entry.id,
            EntryPatch {
                body: Some("   ".to_string()),
                ..EntryPatch::default()
            },
        )
        .expect("blank entry update should be accepted");
    assert_eq!(entry.body, "");

    let finding = service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Blank finding".to_string(),
            body: "".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .expect("blank finding body should be accepted");
    assert_eq!(finding.body, "");

    let finding = service
        .update_finding(
            &finding.id,
            FindingPatch {
                title: None,
                body: Some("   ".to_string()),
                ..FindingPatch::default()
            },
        )
        .expect("blank finding update should be accepted");
    assert_eq!(finding.body, "");

    let draft = service
        .create_draft(DraftCreate {
            session_id: session.id,
            ai_run_id: None,
            kind: DraftKind::Testware,
            title: "Blank testware".to_string(),
            body: "".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
        })
        .expect("blank draft body should be accepted");
    assert_eq!(draft.body, "");

    let draft = service
        .update_draft(
            &draft.id,
            DraftPatch {
                title: None,
                body: Some("   ".to_string()),
                ..DraftPatch::default()
            },
        )
        .expect("blank draft update should be accepted");
    assert_eq!(draft.body, "");
}

#[test]
fn validation_rejects_blank_session_titles_and_non_object_metadata() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    assert!(
        service
            .create_session(SessionDraft {
                title: "   ".to_string(),
                ..SessionDraft::default()
            })
            .is_err(),
        "blank Session titles should be rejected"
    );

    let session = service
        .create_session(SessionDraft {
            title: "Metadata check".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");

    assert!(
        service
            .create_entry(EntryDraft {
                session_id: session.id,
                entry_type: EntryType::Log,
                title: None,
                body: "console output".to_string(),
                body_json: None,
                body_format: Some("html".to_string()),
                metadata_json: Some("[]".to_string()),
                excluded_from_generation: false,
            })
            .is_err(),
        "metadata JSON must be an object"
    );
}
