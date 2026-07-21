#[test]
fn managed_attachments_preview_generation_context_and_evidence_flow() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let source_path = temp_dir.join("browser log.txt");
    fs::write(&source_path, "network error at checkout").expect("source attachment should write");

    let session = service
        .create_session(SessionDraft {
            title: "Attachment evidence".to_string(),
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
            finding_id: finding.id.clone(),
            entry_id: None,
            attachment_id: Some(attachment.id.clone()),
        })
        .expect("attachment Evidence link should be created");

    let evidence_links = service
        .list_evidence_links(&session.id)
        .expect("evidence links should list");
    assert_eq!(evidence_links.len(), 1);
    assert_eq!(evidence_links[0].finding_id, finding.id);
    assert_eq!(
        evidence_links[0].attachment_id.as_deref(),
        Some(attachment.id.as_str())
    );

    delete_session_attachment_files(&temp_dir, &session.id)
        .expect("managed attachment files should clean up");
    assert!(!temp_dir.join("attachments").join(&session.id).exists());

    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}

#[test]
fn imported_attachment_cleanup_removes_its_row_and_managed_file() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let session = service
        .create_session(SessionDraft {
            title: "Attachment cleanup".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let attachment = import_clipboard_screenshot_data_url(
        &service,
        &temp_dir,
        &session.id,
        None,
        "discarded.png".to_string(),
        "data:image/png;base64,aGVsbG8=",
    )
    .expect("clipboard screenshot should import");
    let attachment_path = temp_dir.join(&attachment.relative_path);
    assert!(attachment_path.is_file());

    assert!(
        delete_attachment_with_file(&service, &temp_dir, &attachment.id)
            .expect("attachment should be deleted")
    );

    assert!(
        service
            .get_attachment(&attachment.id)
            .expect("attachment lookup should succeed")
            .is_none()
    );
    assert!(!attachment_path.exists());
    assert!(
        delete_attachment_with_file(&service, &temp_dir, &attachment.id)
            .expect("repeated cleanup should be idempotent")
    );
    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}

#[test]
fn imported_attachment_cleanup_keeps_referenced_content() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let session = service
        .create_session(SessionDraft {
            title: "Referenced attachment cleanup".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let attachment = import_clipboard_screenshot_data_url(
        &service,
        &temp_dir,
        &session.id,
        None,
        "referenced.png".to_string(),
        "data:image/png;base64,aGVsbG8=",
    )
    .expect("clipboard screenshot should import");
    service
        .create_entry(EntryDraft {
            session_id: session.id.clone(),
            entry_type: EntryType::Note,
            title: Some("Note body".to_string()),
            body: format!(
                "<p><img data-attachment-id=\"{}\" src=\"qa-scribe-attachment://{}\"></p>",
                attachment.id, attachment.id
            ),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("referencing Entry should be created");

    assert!(
        !delete_attachment_with_file(&service, &temp_dir, &attachment.id)
            .expect("referenced attachment cleanup should be deferred")
    );
    assert!(
        service
            .get_attachment(&attachment.id)
            .expect("attachment lookup should succeed")
            .is_some()
    );
    assert!(temp_dir.join(&attachment.relative_path).is_file());
    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}

#[test]
fn imported_attachment_cleanup_keeps_row_when_file_removal_fails() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let session = service
        .create_session(SessionDraft {
            title: "Retryable attachment cleanup".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let attachment = import_clipboard_screenshot_data_url(
        &service,
        &temp_dir,
        &session.id,
        None,
        "retry.png".to_string(),
        "data:image/png;base64,aGVsbG8=",
    )
    .expect("clipboard screenshot should import");
    let attachment_path = temp_dir.join(&attachment.relative_path);
    fs::remove_file(&attachment_path).expect("attachment file should be removed");
    fs::create_dir(&attachment_path).expect("directory should replace attachment file");

    delete_attachment_with_file(&service, &temp_dir, &attachment.id)
        .expect_err("directory removal through remove_file should fail");

    assert!(
        service
            .get_attachment(&attachment.id)
            .expect("attachment lookup should succeed")
            .is_some()
    );
    fs::remove_dir(&attachment_path).expect("blocking directory should be removed");
    assert!(
        delete_attachment_with_file(&service, &temp_dir, &attachment.id)
            .expect("cleanup should retry after the filesystem recovers")
    );
    assert!(
        service
            .get_attachment(&attachment.id)
            .expect("attachment lookup should succeed")
            .is_none()
    );
    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}

include!("attachments/validation_and_integrity.rs");
include!("attachments/reconciliation_and_session_deletion.rs");
