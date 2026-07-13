#[test]
fn entries_findings_and_evidence_links_cascade_with_session() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Timeline capture".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let entry = service
        .create_entry(EntryDraft {
            session_id: session.id.clone(),
            entry_type: EntryType::Observation,
            title: Some("Coupon failure".to_string()),
            body: "Applying SAVE10 returns a 500.".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: Some(r#"{"url":"https://example.test/cart"}"#.to_string()),
            excluded_from_generation: false,
        })
        .expect("entry should be created");
    let finding = service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Coupon crashes checkout".to_string(),
            body: "SAVE10 produces an internal error.".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .expect("finding should be created");
    let finding = service
        .update_finding(
            &finding.id,
            FindingPatch {
                title: Some("Coupon blocks checkout".to_string()),
                body: Some("<p>SAVE10 produces an internal error.</p>".to_string()),
                ..FindingPatch::default()
            },
        )
        .expect("finding should update");
    assert_eq!(finding.title, "Coupon blocks checkout");
    assert_eq!(finding.body, "<p>SAVE10 produces an internal error.</p>");
    let link = service
        .create_evidence_link(EvidenceLinkDraft {
            finding_id: finding.id,
            entry_id: Some(entry.id),
            attachment_id: None,
        })
        .expect("evidence link should be created");

    assert!(!link.id.is_empty());
    assert_eq!(
        service
            .list_entries(&session.id)
            .expect("entries should list")
            .len(),
        1
    );
    assert_eq!(
        service
            .list_findings(&session.id)
            .expect("findings should list")
            .len(),
        1
    );

    service
        .delete_session(&session.id)
        .expect("session should delete");
    let connection = service.database().connection();
    assert_eq!(count_rows(connection, "entries"), 0);
    assert_eq!(count_rows(connection, "findings"), 0);
    assert_eq!(count_rows(connection, "evidence_links"), 0);
}
#[test]
fn deleting_finding_removes_evidence_links_but_keeps_entries() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Finding cleanup".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let entry = service
        .create_entry(EntryDraft {
            session_id: session.id.clone(),
            entry_type: EntryType::Observation,
            title: Some("Checkout observation".to_string()),
            body: "The checkout confirmation did not render.".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("entry should be created");
    let finding = service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Checkout confirmation missing".to_string(),
            body: "The confirmation screen stays blank after payment.".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .expect("finding should be created");
    let finding_id = finding.id.clone();
    service
        .create_evidence_link(EvidenceLinkDraft {
            finding_id: finding.id,
            entry_id: Some(entry.id),
            attachment_id: None,
        })
        .expect("evidence link should be created");

    service
        .delete_finding(&finding_id)
        .expect("finding should delete");
    assert!(
        service
            .list_findings(&session.id)
            .expect("findings should list")
            .is_empty()
    );
    let connection = service.database().connection();
    assert_eq!(count_rows(connection, "evidence_links"), 0);
    assert_eq!(count_rows(connection, "entries"), 1);
    assert!(matches!(
        service.delete_finding(&finding_id),
        Err(QaScribeError::NotFound(missing_id)) if missing_id == finding_id
    ));
}

#[test]
fn cross_session_libraries_include_session_provenance() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let first = service
        .create_session(SessionDraft {
            title: "Checkout exploratory".to_string(),
            ..SessionDraft::default()
        })
        .expect("first Session should be created");
    let second = service
        .create_session(SessionDraft {
            title: "Account recovery".to_string(),
            ..SessionDraft::default()
        })
        .expect("second Session should be created");

    service
        .create_draft(DraftCreate {
            session_id: first.id.clone(),
            ai_run_id: None,
            kind: DraftKind::Testware,
            title: "Checkout cases".to_string(),
            body: "Verify a completed card payment.".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
        })
        .expect("Draft should be created");
    service
        .create_finding(FindingDraft {
            session_id: second.id.clone(),
            title: "Reset email delayed".to_string(),
            body: "The recovery email arrived after ten minutes.".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            kind: FindingKind::Risk,
            metadata_json: None,
        })
        .expect("Finding should be created");

    let draft_library = service
        .list_draft_library()
        .expect("Draft library should list");
    assert_eq!(draft_library.len(), 1);
    assert_eq!(draft_library[0].draft.session_id, first.id);
    assert_eq!(draft_library[0].session_title, "Checkout exploratory");

    let finding_library = service
        .list_finding_library()
        .expect("Finding library should list");
    assert_eq!(finding_library.len(), 1);
    assert_eq!(finding_library[0].finding.session_id, second.id);
    assert_eq!(finding_library[0].session_title, "Account recovery");
}


#[test]
fn evidence_links_must_stay_within_one_session() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let first = service
        .create_session(SessionDraft {
            title: "First Session".to_string(),
            ..SessionDraft::default()
        })
        .expect("first Session should be created");
    let second = service
        .create_session(SessionDraft {
            title: "Second Session".to_string(),
            ..SessionDraft::default()
        })
        .expect("second Session should be created");
    let entry = service
        .create_entry(EntryDraft {
            session_id: first.id,
            entry_type: EntryType::Note,
            title: None,
            body: "Evidence from another Session".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("entry should be created");
    let finding = service
        .create_finding(FindingDraft {
            session_id: second.id.clone(),
            title: "Cross-session risk".to_string(),
            body: "Should not link to another Session.".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            kind: FindingKind::Risk,
            metadata_json: None,
        })
        .expect("finding should be created");

    assert!(
        matches!(
            service.create_evidence_link(EvidenceLinkDraft {
                finding_id: finding.id,
                entry_id: Some(entry.id.clone()),
                attachment_id: None,
            }),
            Err(QaScribeError::Validation(_))
        ),
        "Evidence links must not cross Session boundaries"
    );

    service
        .database()
        .connection()
        .execute(
            "INSERT INTO attachments (
                id, session_id, entry_id, filename, mime_type, size_bytes, sha256, relative_path, created_at
            ) VALUES ('attachment-1', ?1, NULL, 'screenshot.png', 'image/png', 10, 'abc', 'first/attachment-1.png', '2026-06-22T00:00:00.000Z')",
            [&entry.session_id],
        )
        .expect("attachment fixture should insert");

    let same_session_finding = service
        .create_finding(FindingDraft {
            session_id: second.id,
            title: "Attachment cross-session risk".to_string(),
            body: "Should not link to another Session attachment.".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            kind: FindingKind::Risk,
            metadata_json: None,
        })
        .expect("finding should be created");

    assert!(
        matches!(
            service.create_evidence_link(EvidenceLinkDraft {
                finding_id: same_session_finding.id,
                entry_id: None,
                attachment_id: Some("attachment-1".to_string()),
            }),
            Err(QaScribeError::Validation(_))
        ),
        "Evidence links must not reference attachments from another Session"
    );
}
