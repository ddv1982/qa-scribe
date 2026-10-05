#[test]
fn create_attachment_rejects_sha256_that_is_not_exactly_64_lowercase_hex_chars() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Attachment sha256 validation".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");

    let base_draft = qa_scribe_core::domain::AttachmentDraft {
        session_id: session.id.clone(),
        entry_id: None,
        filename: "evidence.txt".to_string(),
        mime_type: None,
        size_bytes: 4,
        sha256: String::new(),
        relative_path: format!("attachments/{}/evidence.txt", session.id),
    };

    let too_short = "a".repeat(63);
    let too_long = "a".repeat(65);
    let uppercase = "A".repeat(64);
    let non_hex = format!("{}g", "a".repeat(63));

    for invalid_sha256 in [too_short, too_long, uppercase, non_hex] {
        let result = service.create_attachment(qa_scribe_core::domain::AttachmentDraft {
            sha256: invalid_sha256.clone(),
            ..base_draft.clone()
        });
        assert!(
            result.is_err(),
            "sha256 {invalid_sha256:?} must be rejected as invalid"
        );
    }

    let valid = service.create_attachment(qa_scribe_core::domain::AttachmentDraft {
        sha256: "a".repeat(64),
        ..base_draft
    });
    assert!(valid.is_ok(), "a well-formed 64-char lowercase hex sha256 should be accepted");
}

#[test]
fn create_attachment_rejects_unsafe_relative_paths() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Attachment path validation".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");

    let result = service.create_attachment(qa_scribe_core::domain::AttachmentDraft {
        session_id: session.id,
        entry_id: None,
        filename: "evidence.txt".to_string(),
        mime_type: None,
        size_bytes: 4,
        sha256: "a".repeat(64),
        relative_path: "attachments/../secret.txt".to_string(),
    });

    assert!(result.is_err(), "unsafe relative paths must be rejected for every core caller");
}

#[test]
fn create_attachment_rejects_paths_outside_the_session_attachment_directory() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Attachment path ownership".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");

    let result = service.create_attachment(qa_scribe_core::domain::AttachmentDraft {
        session_id: session.id.clone(),
        entry_id: None,
        filename: "evidence.txt".to_string(),
        mime_type: None,
        size_bytes: 4,
        sha256: "a".repeat(64),
        relative_path: "attachments/other-session/evidence.txt".to_string(),
    });

    assert!(
        result.is_err(),
        "core callers must use the managed attachments/<session-id>/ path"
    );
}

#[test]
fn create_attachment_returns_not_found_for_missing_entry() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Attachment not-found check".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");

    assert!(
        matches!(
            service.create_attachment(qa_scribe_core::domain::AttachmentDraft {
                session_id: session.id.clone(),
                entry_id: Some("missing-entry".to_string()),
                filename: "evidence.txt".to_string(),
                mime_type: None,
                size_bytes: 4,
                sha256: "abc123".to_string(),
                relative_path: format!("attachments/{}/evidence.txt", session.id),
            }),
            Err(QaScribeError::NotFound(id)) if id == "missing-entry"
        ),
        "a missing Entry reference must surface as NotFound, not a raw Sqlite error"
    );
}

#[test]
fn import_managed_attachment_returns_not_found_for_missing_entry() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let source_path = temp_dir.join("evidence.txt");
    fs::write(&source_path, "evidence").expect("source attachment should write");

    let session = service
        .create_session(SessionDraft {
            title: "Import not-found check".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");

    assert!(
        matches!(
            import_managed_attachment(
                &service,
                &temp_dir,
                &session.id,
                Some("missing-entry".to_string()),
                &source_path,
            ),
            Err(QaScribeError::NotFound(id)) if id == "missing-entry"
        ),
        "a missing Entry reference must surface as NotFound, not a raw Sqlite error"
    );

    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}

#[test]
fn attachment_file_bytes_fails_integrity_check_when_file_is_corrupted_on_disk() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let source_path = temp_dir.join("evidence.txt");
    fs::write(&source_path, "original evidence bytes").expect("source attachment should write");

    let session = service
        .create_session(SessionDraft {
            title: "Attachment integrity check".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let attachment = import_managed_attachment(&service, &temp_dir, &session.id, None, &source_path)
        .expect("attachment should import");

    // Sanity check: reading back before corruption succeeds and returns the original bytes.
    let (_, bytes) = attachment_file_bytes(&service, &temp_dir, &attachment.id)
        .expect("attachment read should succeed before corruption")
        .expect("attachment should exist");
    assert_eq!(bytes, b"original evidence bytes");

    // Keep the length unchanged so a size check cannot mask the hash regression.
    fs::write(temp_dir.join(&attachment.relative_path), "Original evidence bytes")
        .expect("attachment file should be overwritten to simulate corruption");

    let result = attachment_file_bytes(&service, &temp_dir, &attachment.id);
    assert!(
        matches!(result, Err(QaScribeError::InvalidStoredValue { .. })),
        "a corrupted attachment file must fail with a distinct integrity error, got {result:?}"
    );

    let preview_result = attachment_preview_data_url(&service, &temp_dir, &attachment.id);
    assert!(
        matches!(preview_result, Err(QaScribeError::InvalidStoredValue { .. })),
        "attachment_preview_data_url must also surface the integrity error, got {preview_result:?}"
    );

    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}

// Build stored attachments directly so import-time validation cannot mask read-time defects.
// The fixture allocation is dropped before attachment_file_bytes allocates its read buffer.
fn attachment_file_bytes_size_fixture(
    actual_size: usize,
    stored_size: i64,
) -> (SessionService, std::path::PathBuf, qa_scribe_core::domain::Attachment) {
    use sha2::{Digest, Sha256};

    let service = SessionService::in_memory().expect("in-memory service should open");
    let temp_dir = unique_temp_dir();
    let session = service
        .create_session(SessionDraft {
            title: "Attachment read size validation".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let relative_path = format!("attachments/{}/evidence.bin", session.id);
    fs::create_dir_all(temp_dir.join("attachments").join(&session.id))
        .expect("managed attachment directory should be created");
    let bytes = vec![0x5a; actual_size];
    fs::write(temp_dir.join(&relative_path), &bytes).expect("attachment file should write");
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let attachment = service
        .create_attachment(qa_scribe_core::domain::AttachmentDraft {
            session_id: session.id,
            entry_id: None,
            filename: "evidence.bin".to_string(),
            mime_type: Some("application/octet-stream".to_string()),
            size_bytes: stored_size,
            sha256,
            relative_path,
        })
        .expect("attachment metadata should be stored");
    (service, temp_dir, attachment)
}

#[test]
fn attachment_file_bytes_rejects_over_25_mib_with_matching_size_and_hash() {
    let actual_size = 25 * 1024 * 1024 + 1;
    let (service, temp_dir, attachment) =
        attachment_file_bytes_size_fixture(actual_size, actual_size as i64);

    let result = attachment_file_bytes(&service, &temp_dir, &attachment.id);
    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");

    assert!(
        result.is_err(),
        "read must reject content above 25 MiB even with matching stored size and SHA-256"
    );
}

#[test]
fn attachment_file_bytes_rejects_stored_size_mismatch_with_valid_hash() {
    // Cover both underreported and overreported sizes without exceeding the read bound.
    for stored_size in [31, 33] {
        let (service, temp_dir, attachment) =
            attachment_file_bytes_size_fixture(32, stored_size);

        let result = attachment_file_bytes(&service, &temp_dir, &attachment.id);
        fs::remove_dir_all(temp_dir).expect("temp dir should be removed");

        assert!(
            result.is_err(),
            "read must reject stored size {stored_size} for 32 valid bytes with matching SHA-256"
        );
    }
}

#[test]
fn attachment_file_bytes_accepts_exactly_25_mib_with_matching_size_and_hash() {
    let actual_size = 25 * 1024 * 1024;
    let (service, temp_dir, attachment) =
        attachment_file_bytes_size_fixture(actual_size, actual_size as i64);

    let result = attachment_file_bytes(&service, &temp_dir, &attachment.id);
    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
    let (read_attachment, bytes) = result
        .expect("exactly 25 MiB must remain readable")
        .expect("attachment should exist");
    assert_eq!(read_attachment.id, attachment.id);
    assert_eq!(read_attachment.size_bytes, actual_size as i64);
    assert_eq!(bytes.len(), actual_size);
    assert!(bytes.iter().all(|byte| *byte == 0x5a));
}

#[test]
fn import_rejects_a_filename_too_long_to_fit_the_on_disk_uuid_prefixed_name() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");

    let session = service
        .create_session(SessionDraft {
            title: "Attachment filename length check".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");

    // The on-disk name is `{uuid}_{filename}` (uuid is 36 chars + `_`), so an
    // overlong filename must be rejected with a clean validation error before
    // any file touches disk, not surfaced as a raw ENAMETOOLONG I/O error.
    let overlong_filename = format!("{}.png", "a".repeat(300));
    let result = import_clipboard_screenshot_data_url(
        &service,
        &temp_dir,
        &session.id,
        None,
        overlong_filename,
        "data:image/png;base64,aGVsbG8=",
    );

    assert!(
        matches!(result, Err(QaScribeError::Validation(_))),
        "an overlong filename must fail validation cleanly, got {result:?}"
    );
    assert_eq!(
        count_rows(service.database().connection(), "attachments"),
        0,
        "no attachment row should be created for a rejected filename"
    );

    let session_dir = temp_dir.join("attachments").join(&session.id);
    assert!(
        !session_dir.exists() || fs::read_dir(&session_dir).expect("dir should list").next().is_none(),
        "no file should be left on disk for a rejected filename"
    );

    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}
