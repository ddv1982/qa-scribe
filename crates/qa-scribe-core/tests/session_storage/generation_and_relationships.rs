#[test]
fn settings_generation_context_ai_run_and_draft_round_trip() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let default_settings = service
        .get_settings()
        .expect("default settings should load");
    assert_eq!(default_settings.schema_version, 1);
    assert_eq!(
        default_settings.generation_system_prompt,
        default_generation_system_prompt()
    );
    assert!(!default_settings.generation_system_prompt.contains("Testware"));

    let updated_settings = service
        .update_settings(AppSettings {
            schema_version: 1,
            generation_system_prompt: "Summarize the selected Session into Testware.".to_string(),
            ..AppSettings::default()
        })
        .expect("settings should update");
    assert_eq!(
        service.get_settings().expect("settings should reload"),
        updated_settings
    );

    service
        .update_settings(AppSettings {
            schema_version: 1,
            generation_system_prompt: legacy_testware_generation_system_prompt().to_string(),
            ..AppSettings::default()
        })
        .expect("legacy default settings should save");
    assert_eq!(
        service
            .get_settings()
            .expect("legacy default should normalize")
            .generation_system_prompt,
        default_generation_system_prompt()
    );

    let session = service
        .create_session(SessionDraft {
            title: "Generation flow".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let entry = service
        .create_entry(EntryDraft {
            session_id: session.id.clone(),
            entry_type: EntryType::Note,
            title: None,
            body: "Checkout works for guest users.".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("entry should be created");
    let excluded_entry = service
        .create_entry(EntryDraft {
            session_id: session.id.clone(),
            entry_type: EntryType::Note,
            title: None,
            body: "Do not include this setup note.".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("entry should be created");
    service
        .update_entry(
            &excluded_entry.id,
            EntryPatch {
                excluded_from_generation: Some(true),
                ..EntryPatch::default()
            },
        )
        .expect("entry should update");

    let context = service
        .create_generation_context(&session.id)
        .expect("generation context should be created");
    assert_eq!(context.session_id, session.id);
    assert_eq!(
        count_rows(service.database().connection(), "generation_context_entries"),
        1
    );

    let ai_run = service
        .create_ai_run(AiRunCreate {
            session_id: session.id.clone(),
            generation_context_id: Some(context.id),
            provider: AiProvider::CodexCli,
            model: "gpt-test".to_string(),
            reasoning_effort: Some("low".to_string()),
            prompt_version: "session-report-v1".to_string(),
        })
        .expect("AI Run should be created");
    assert_eq!(ai_run.session_id, session.id);
    assert_eq!(
        service
            .complete_ai_run(&ai_run.id)
            .expect("AI Run should complete")
            .status
            .as_str(),
        "completed"
    );

    let draft = service
        .create_draft(DraftCreate {
            session_id: session.id.clone(),
            ai_run_id: Some(ai_run.id.clone()),
            kind: DraftKind::SessionReport,
            title: "Session Report Draft".to_string(),
            body: format!("Entry used: {}", entry.id),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
        })
        .expect("Draft should be created");
    assert_eq!(draft.kind, DraftKind::SessionReport);

    let updated_draft = service
        .update_draft(
            &draft.id,
            DraftPatch {
                title: None,
                body: Some("Edited Session Report Draft".to_string()),
                ..DraftPatch::default()
            },
        )
        .expect("Draft should update");
    assert_eq!(updated_draft.body, "Edited Session Report Draft");

    let failed = service
        .create_ai_run(AiRunCreate {
            session_id: session.id.clone(),
            generation_context_id: None,
            provider: AiProvider::CodexCli,
            model: "gpt-test".to_string(),
            reasoning_effort: None,
            prompt_version: "session-report-v1".to_string(),
        })
        .expect("AI Run should be created");
    assert_eq!(
        service
            .fail_ai_run(&failed.id, "provider unavailable")
            .expect("AI Run should fail")
            .status
            .as_str(),
        "failed"
    );
    assert_eq!(
        service
            .list_drafts(&session.id)
            .expect("Drafts should list")
            .first()
            .expect("updated Draft should exist")
            .body,
        "Edited Session Report Draft"
    );

    service
        .delete_session(&session.id)
        .expect("session should delete");
    let connection = service.database().connection();
    assert_eq!(count_rows(connection, "generation_contexts"), 0);
    assert_eq!(count_rows(connection, "generation_context_entries"), 0);
    assert_eq!(count_rows(connection, "ai_runs"), 0);
    assert_eq!(count_rows(connection, "drafts"), 0);
}

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
fn deleting_draft_preserves_ai_run_and_other_drafts() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Draft cleanup".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let context = service
        .create_generation_context(&session.id)
        .expect("generation context should be created");
    let ai_run = service
        .create_ai_run(AiRunCreate {
            session_id: session.id.clone(),
            generation_context_id: Some(context.id),
            provider: AiProvider::CodexCli,
            model: "gpt-test".to_string(),
            reasoning_effort: None,
            prompt_version: "draft-delete-v1".to_string(),
        })
        .expect("AI Run should be created");
    let testware = service
        .create_draft(DraftCreate {
            session_id: session.id.clone(),
            ai_run_id: Some(ai_run.id.clone()),
            kind: DraftKind::Testware,
            title: "Checkout testware".to_string(),
            body: "Scenario: checkout completion".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
        })
        .expect("Testware Draft should be created");
    let report = service
        .create_draft(DraftCreate {
            session_id: session.id.clone(),
            ai_run_id: Some(ai_run.id),
            kind: DraftKind::SessionReport,
            title: "Session report".to_string(),
            body: "Report stays available.".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
        })
        .expect("Session Report Draft should be created");
    let testware_id = testware.id.clone();

    service
        .delete_draft(&testware_id)
        .expect("Testware Draft should delete");
    let drafts = service
        .list_drafts(&session.id)
        .expect("Drafts should list after delete");
    assert_eq!(drafts.len(), 1);
    assert_eq!(drafts[0].id, report.id);
    let connection = service.database().connection();
    assert_eq!(count_rows(connection, "ai_runs"), 1);
    assert_eq!(count_rows(connection, "generation_contexts"), 1);
    assert!(matches!(
        service.delete_draft(&testware_id),
        Err(QaScribeError::NotFound(missing_id)) if missing_id == testware_id
    ));
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
        service
            .create_evidence_link(EvidenceLinkDraft {
                finding_id: finding.id,
                entry_id: Some(entry.id.clone()),
                attachment_id: None,
            })
            .is_err(),
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
        service
            .create_evidence_link(EvidenceLinkDraft {
                finding_id: same_session_finding.id,
                entry_id: None,
                attachment_id: Some("attachment-1".to_string()),
            })
            .is_err(),
        "Evidence links must not reference attachments from another Session"
    );
}
