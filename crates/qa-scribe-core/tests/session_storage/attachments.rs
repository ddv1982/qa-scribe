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
            body_json: None,
            body_format: Some("html".to_string()),
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
            body_json: None,
            body_format: Some("html".to_string()),
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
fn attachment_reconciliation_reports_missing_and_stray_files() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let source_path = temp_dir.join("screen.png");
    fs::write(&source_path, "image bytes").expect("source attachment should write");

    let session = service
        .create_session(SessionDraft {
            title: "Attachment reconciliation".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let attachment = import_managed_attachment(&service, &temp_dir, &session.id, None, &source_path)
        .expect("attachment should import");

    let clean_report =
        reconcile_attachment_files(&service, &temp_dir).expect("attachments should reconcile");
    assert!(clean_report.missing_files.is_empty());
    assert!(clean_report.stray_files.is_empty());

    fs::remove_file(temp_dir.join(&attachment.relative_path)).expect("managed file should remove");
    let stray_path = temp_dir
        .join("attachments")
        .join(&session.id)
        .join("stray.log");
    fs::write(&stray_path, "orphaned").expect("stray file should write");

    let report =
        reconcile_attachment_files(&service, &temp_dir).expect("attachments should reconcile");
    assert_eq!(report.missing_files, vec![attachment.relative_path]);
    assert_eq!(
        report.stray_files,
        vec![format!("attachments/{}/stray.log", session.id)]
    );

    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}

#[test]
fn delete_session_with_attachment_files_removes_database_rows_and_files() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let source_path = temp_dir.join("evidence.txt");
    fs::write(&source_path, "evidence").expect("source attachment should write");

    let session = service
        .create_session(SessionDraft {
            title: "Delete with files".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    import_managed_attachment(&service, &temp_dir, &session.id, None, &source_path)
        .expect("attachment should import");

    let session_dir = temp_dir.join("attachments").join(&session.id);
    assert!(session_dir.exists());
    delete_session_with_attachment_files(&service, &temp_dir, &session.id)
        .expect("session and attachment files should delete");
    assert!(!session_dir.exists());
    assert!(
        service
            .get_session(&session.id)
            .expect("session query should work")
            .is_none()
    );
    assert_eq!(
        count_rows(service.database().connection(), "attachments"),
        0
    );

    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}
