use super::*;

#[test]
fn compact_record_and_local_image_limits_are_enforced_without_lowering_existing_bounds() {
    let fixture = Fixture::new();
    let (_, prepared) = fixture.prepare(CreationKind::Testware, 0);
    let mut input = request(&prepared, CreationKind::Testware);
    if let CreationRecordInput::Testware { body, .. } = &mut input.record {
        *body = "x".repeat(250_001);
    }
    assert!(commit_creation_save(&fixture.service, &fixture.root, input.clone()).is_err());
    if let CreationRecordInput::Testware {
        body,
        body_json,
        metadata_json,
        ..
    } = &mut input.record
    {
        *body = "x".repeat(250_000);
        *body_json = Some(format!("\"{}\"", "x".repeat(500_000)));
        *metadata_json = None;
    }
    assert!(commit_creation_save(&fixture.service, &fixture.root, input.clone()).is_err());
    if let CreationRecordInput::Testware {
        body_json,
        metadata_json,
        ..
    } = &mut input.record
    {
        *body_json = None;
        *metadata_json = Some(format!("{{\"data\":\"{}\"}}", "x".repeat(20_000)));
    }
    assert!(commit_creation_save(&fixture.service, &fixture.root, input.clone()).is_err());
    if let CreationRecordInput::Testware { metadata_json, .. } = &mut input.record {
        *metadata_json = None;
    }
    assert!(matches!(
        commit_creation_save(&fixture.service, &fixture.root, input).unwrap(),
        CreationOutcome::Committed { .. }
    ));
    assert_eq!(
        fixture.service.list_drafts(&fixture.session).unwrap()[0]
            .body
            .len(),
        250_000
    );

    let fixture = Fixture::new();
    let mut prep = preparation(&fixture.session, CreationKind::Finding, 1);
    prep.images[0].size_bytes = (crate::attachments::MAX_ATTACHMENT_BYTES + 1) as u32;
    assert!(fixture.service.prepare_creation_save(prep.clone()).is_err());
    let bytes = vec![b'x'; crate::attachments::MAX_ATTACHMENT_BYTES as usize];
    prep.images[0].size_bytes = bytes.len() as u32;
    prep.images[0].sha256 = hex_sha256(&bytes);
    let prepared = fixture.service.prepare_creation_save(prep).unwrap();
    let mut input = request(&prepared, CreationKind::Finding);
    input.images[0].data_url = format!("data:image/png;base64,{}", STANDARD.encode(&bytes));
    assert!(matches!(
        commit_creation_save(&fixture.service, &fixture.root, input).unwrap(),
        CreationOutcome::Committed { .. }
    ));
    assert_eq!(
        fs::metadata(path(&fixture.service, &fixture.root, 0))
            .unwrap()
            .len(),
        crate::attachments::MAX_ATTACHMENT_BYTES
    );
}

#[test]
fn interrupted_cleanup_keeps_ownership_until_missing_exact_files_are_reconciled() {
    let fixture = Fixture::new();
    fixture.prepare(CreationKind::Finding, 2);
    for index in 0..2 {
        let path = path(&fixture.service, &fixture.root, index);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"image").unwrap();
    }
    let status = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "attachments::creation::tests::cut_worker",
            "--nocapture",
        ])
        .env("UC1_CUT_ROOT", &fixture.root)
        .env("UC1_CUT", "unlink")
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(93));
    assert!(!path(&fixture.service, &fixture.root, 0).exists());
    assert_eq!(
        reconcile_creation_saves(&fixture.service, &fixture.root)
            .unwrap()
            .pending_attempts,
        0
    );
    assert_eq!(
        abort_creation_save(&fixture.service, &fixture.root, "attempt").unwrap(),
        CreationOutcome::Aborted
    );
    assert!(!path(&fixture.service, &fixture.root, 1).exists());
}

#[test]
fn shared_images_require_the_actual_attachment_session_and_valid_descriptors() {
    let fixture = Fixture::new();
    let foreign = fixture
        .service
        .create_session(SessionDraft {
            title: "Foreign".into(),
            ..Default::default()
        })
        .unwrap();
    let image = import_managed_attachment_bytes(
        &fixture.service,
        &fixture.root,
        &foreign.id,
        None,
        "foreign.png".into(),
        Some("image/png".into()),
        b"image".to_vec(),
    )
    .unwrap();
    let (_, prepared) = fixture.prepare(CreationKind::Finding, 0);
    let mut input = request(&prepared, CreationKind::Finding);
    if let CreationRecordInput::Finding { body, .. } = &mut input.record {
        *body = format!("<img src=\"qa-scribe-attachment://{}\">", image.id);
    }
    input.shared_attachment_ids = vec![image.id.clone()];
    assert!(commit_creation_save(&fixture.service, &fixture.root, input).is_err());
    assert_eq!(count(&fixture.service, "findings"), 0);
    assert_eq!(
        fs::read(fixture.root.join(image.relative_path)).unwrap(),
        b"image"
    );
    for mime in ["image/", "image/png\n", "text/plain"] {
        let mut prep = preparation(&fixture.session, CreationKind::Finding, 1);
        prep.attempt_id = mime.into();
        prep.images[0].mime_type = mime.into();
        assert!(fixture.service.prepare_creation_save(prep).is_err());
    }
}
