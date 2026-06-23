use qa_scribe_core::{
    attachments::{
        attachment_preview_data_url, delete_session_attachment_files,
        import_clipboard_screenshot_data_url, import_managed_attachment,
    },
    domain::{
        AiProvider, AiRunCreate, AppSettings, DraftCreate, DraftKind, DraftPatch, EntryDraft,
        EntryPatch, EntryType, EvidenceLinkDraft, FindingDraft, FindingKind, SessionDraft,
        SessionPatch,
    },
    export::{ExportFormat, export_session},
    services::SessionService,
};
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

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
fn settings_generation_context_ai_run_and_draft_round_trip() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let default_settings = service
        .get_settings()
        .expect("default settings should load");
    assert_eq!(default_settings.schema_version, 1);

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
        count_rows(
            service.database().connection(),
            "generation_context_entries"
        ),
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
        })
        .expect("Draft should be created");
    assert_eq!(draft.kind, DraftKind::SessionReport);

    let updated_draft = service
        .update_draft(
            &draft.id,
            DraftPatch {
                title: None,
                body: Some("Edited Session Report Draft".to_string()),
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
            metadata_json: Some(r#"{"url":"https://example.test/cart"}"#.to_string()),
            excluded_from_generation: false,
        })
        .expect("entry should be created");
    let finding = service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Coupon crashes checkout".to_string(),
            body: "SAVE10 produces an internal error.".to_string(),
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .expect("finding should be created");
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
fn managed_attachments_preview_generation_context_and_export_flow() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let source_path = temp_dir.join("browser log.txt");
    fs::write(&source_path, "network error at checkout").expect("source attachment should write");

    let session = service
        .create_session(SessionDraft {
            title: "Attachment export".to_string(),
            session_context: Some("Checkout evidence".to_string()),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let entry = service
        .create_entry(EntryDraft {
            session_id: session.id.clone(),
            entry_type: EntryType::Log,
            title: None,
            body: "Console showed a checkout error.".to_string(),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("entry should be created");

    let attachment = import_managed_attachment(
        &service,
        &temp_dir,
        &session.id,
        Some(entry.id),
        &source_path,
    )
    .expect("attachment should import");
    assert_eq!(attachment.filename, "browser_log.txt");
    assert_eq!(attachment.sha256.len(), 64);
    assert!(temp_dir.join(&attachment.relative_path).is_file());
    assert_eq!(
        service
            .list_attachments(&session.id)
            .expect("attachments should list")
            .len(),
        1
    );

    let pasted = import_clipboard_screenshot_data_url(
        &service,
        &temp_dir,
        &session.id,
        None,
        "clipboard.png".to_string(),
        "data:image/png;base64,aGVsbG8=",
    )
    .expect("clipboard screenshot should import");
    assert_eq!(pasted.mime_type.as_deref(), Some("image/png"));

    let preview = attachment_preview_data_url(&service, &temp_dir, &attachment.id)
        .expect("preview should load")
        .expect("preview should exist");
    assert!(preview.starts_with("data:text/plain;base64,"));

    service
        .create_generation_context(&session.id)
        .expect("generation context should create");
    assert_eq!(
        count_rows(
            service.database().connection(),
            "generation_context_attachments"
        ),
        2
    );

    let finding = service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Checkout log evidence".to_string(),
            body: "The imported log supports the Finding.".to_string(),
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .expect("finding should be created");
    service
        .create_evidence_link(EvidenceLinkDraft {
            finding_id: finding.id,
            entry_id: None,
            attachment_id: Some(attachment.id.clone()),
        })
        .expect("attachment Evidence link should be created");

    let markdown = export_session(&service, &session.id, ExportFormat::Markdown)
        .expect("markdown export should render");
    assert!(markdown.filename.ends_with(".md"));
    assert!(markdown.body.contains("browser_log.txt"));
    assert!(markdown.body.contains("Evidence Attachment"));
    let json = export_session(&service, &session.id, ExportFormat::Json)
        .expect("json export should render");
    assert!(json.body.contains("browser_log.txt"));
    assert!(json.body.contains("evidenceLinks"));

    delete_session_attachment_files(&temp_dir, &session.id)
        .expect("managed attachment files should clean up");
    assert!(!temp_dir.join("attachments").join(&session.id).exists());

    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
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
                metadata_json: Some("[]".to_string()),
                excluded_from_generation: false,
            })
            .is_err(),
        "metadata JSON must be an object"
    );
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
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("entry should be created");
    let finding = service
        .create_finding(FindingDraft {
            session_id: second.id.clone(),
            title: "Cross-session risk".to_string(),
            body: "Should not link to another Session.".to_string(),
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

fn count_rows(connection: &rusqlite::Connection, table: &str) -> i64 {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    connection
        .query_row(&sql, [], |row| row.get(0))
        .expect("count query should succeed")
}

fn unique_temp_dir() -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("qa-scribe-test-{nanos}"))
}
