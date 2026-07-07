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
fn recent_session_listing_is_bounded_and_ordered_by_last_opened() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let older = service
        .create_session(SessionDraft {
            title: "Older".to_string(),
            ..SessionDraft::default()
        })
        .expect("older Session should create");
    let middle = service
        .create_session(SessionDraft {
            title: "Middle".to_string(),
            ..SessionDraft::default()
        })
        .expect("middle Session should create");
    let newest = service
        .create_session(SessionDraft {
            title: "Newest".to_string(),
            ..SessionDraft::default()
        })
        .expect("newest Session should create");

    service
        .database()
        .connection()
        .execute(
            "UPDATE sessions SET last_opened_at = ?1 WHERE id = ?2",
            rusqlite::params!["2026-06-22T00:00:00.000Z", older.id],
        )
        .expect("older timestamp should update");
    service
        .database()
        .connection()
        .execute(
            "UPDATE sessions SET last_opened_at = ?1 WHERE id = ?2",
            rusqlite::params!["2026-06-23T00:00:00.000Z", middle.id],
        )
        .expect("middle timestamp should update");
    service
        .database()
        .connection()
        .execute(
            "UPDATE sessions SET last_opened_at = ?1 WHERE id = ?2",
            rusqlite::params!["2026-06-24T00:00:00.000Z", newest.id],
        )
        .expect("newest timestamp should update");

    let recent = service
        .list_recent_sessions(2)
        .expect("recent Sessions should list");
    assert_eq!(
        recent
            .iter()
            .map(|session| session.title.as_str())
            .collect::<Vec<_>>(),
        vec!["Newest", "Middle"]
    );
    assert!(
        service
            .list_recent_sessions(0)
            .expect("zero-limit recent Sessions should list")
            .is_empty()
    );
    assert_eq!(
        service
            .list_sessions()
            .expect("full Sessions should still list")
            .len(),
        3
    );
}

#[test]
fn open_session_note_state_returns_note_and_active_record_counts() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Hydration split".to_string(),
            ..SessionDraft::default()
        })
        .expect("Session should create");
    let existing_note = service
        .create_entry(EntryDraft {
            session_id: session.id.clone(),
            entry_type: EntryType::Note,
            title: Some("Existing note".to_string()),
            body: "<p>Existing note body</p>".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("existing Note Entry should create");
    service
        .create_entry(EntryDraft {
            session_id: session.id.clone(),
            entry_type: EntryType::Observation,
            title: Some("Observation".to_string()),
            body: "Observed behavior".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("non-note Entry should create");
    service
        .create_draft(DraftCreate {
            session_id: session.id.clone(),
            ai_run_id: None,
            kind: DraftKind::Testware,
            title: "Testware".to_string(),
            body: "<p>Check</p>".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
        })
        .expect("testware Draft should create");
    service
        .create_draft(DraftCreate {
            session_id: session.id.clone(),
            ai_run_id: None,
            kind: DraftKind::SessionReport,
            title: "Session report".to_string(),
            body: "<p>Report</p>".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
        })
        .expect("session report Draft should create");
    service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Finding".to_string(),
            body: "<p>Finding body</p>".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .expect("Finding should create");

    let opened = service
        .open_session_note_state(&session.id)
        .expect("Session note state should open");

    assert_eq!(opened.session.id, session.id);
    assert!(opened.session.last_opened_at >= session.last_opened_at);
    assert_eq!(opened.note_entry.id, existing_note.id);
    assert_eq!(opened.testware_draft_count, 1);
    assert_eq!(opened.finding_count, 1);
    let note_count: i64 = service
        .database()
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM entries WHERE session_id = ?1 AND type = 'note'",
            [session.id],
            |row| row.get(0),
        )
        .expect("note count should read");
    assert_eq!(note_count, 1, "opening should not create a duplicate Note Entry");
}

#[test]
fn open_session_note_state_creates_missing_note_entry() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "No note yet".to_string(),
            ..SessionDraft::default()
        })
        .expect("Session should create");

    let opened = service
        .open_session_note_state(&session.id)
        .expect("Session note state should open");

    assert_eq!(opened.session.id, session.id);
    assert_eq!(opened.note_entry.session_id, session.id);
    assert_eq!(opened.note_entry.entry_type, EntryType::Note);
    assert_eq!(opened.note_entry.title.as_deref(), Some("Note body"));
    assert_eq!(opened.note_entry.body, "");
    assert_eq!(opened.testware_draft_count, 0);
    assert_eq!(opened.finding_count, 0);
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
