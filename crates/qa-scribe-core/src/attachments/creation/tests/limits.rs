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

fn html_only_request(
    prepared: &PreparedCreation,
    kind: CreationKind,
    html: String,
) -> CommitCreationSave {
    let mut input = request(prepared, kind);
    match &mut input.record {
        CreationRecordInput::Finding {
            body,
            body_json,
            body_format,
            ..
        }
        | CreationRecordInput::Testware {
            body,
            body_json,
            body_format,
            ..
        } => {
            *body = html;
            *body_json = None;
            *body_format = Some("html".into());
        }
    }
    input
}

fn reject_uninventoried_html(sources: &[&str]) {
    reject_html_with_json(sources, None);
}

fn reject_html_with_json(sources: &[&str], body_json: Option<&str>) {
    let mut accepted = Vec::new();
    for kind in [CreationKind::Finding, CreationKind::Testware] {
        for template in sources {
            let fixture = Fixture::new();
            let foreign = fixture
                .service
                .create_session(SessionDraft {
                    title: "Foreign image owner".into(),
                    ..Default::default()
                })
                .unwrap();
            let borrowed = import_managed_attachment_bytes(
                &fixture.service,
                &fixture.root,
                &foreign.id,
                None,
                "borrowed.png".into(),
                Some("image/png".into()),
                b"borrowed".to_vec(),
            )
            .unwrap();
            let (_, prepared) = fixture.prepare(kind, 0);
            let html = template.replace("FOREIGN_ID", &borrowed.id);
            let mut input = html_only_request(&prepared, kind, html.clone());
            match &mut input.record {
                CreationRecordInput::Finding {
                    body_json: json, ..
                }
                | CreationRecordInput::Testware {
                    body_json: json, ..
                } => {
                    *json = body_json.map(str::to_owned);
                }
            }
            assert!(input.images.is_empty());
            assert!(input.shared_attachment_ids.is_empty());
            let result = commit_creation_save(&fixture.service, &fixture.root, input);
            if result.is_ok() {
                accepted.push(format!("{kind:?}: {html}: {result:?}"));
                continue;
            }
            assert_eq!(count(&fixture.service, "findings"), 0, "{html}");
            assert_eq!(count(&fixture.service, "drafts"), 0, "{html}");
            assert_eq!(count(&fixture.service, "attachments"), 1, "{html}");
            assert_eq!(
                count(&fixture.service, "creation_attempt_images"),
                0,
                "{html}"
            );
            let attempt =
                creation::require_attempt(fixture.service.database().connection(), "attempt")
                    .unwrap();
            assert!(attempt.preparing(), "{html}");
            assert_eq!(attempt.payload_hash, None, "{html}");
            assert!(
                !fixture
                    .root
                    .join("attachments")
                    .join(&fixture.session)
                    .exists(),
                "{html}"
            );
            assert_eq!(
                fixture.service.get_attachment(&borrowed.id).unwrap(),
                Some(borrowed.clone()),
                "{html}"
            );
            assert_eq!(
                fs::read(fixture.root.join(&borrowed.relative_path)).unwrap(),
                b"borrowed",
                "{html}"
            );
        }
    }
    assert!(
        accepted.is_empty(),
        "Unchecked actual commits: {accepted:#?}"
    );
}

#[test]
fn html_inventory_rejects_unquoted_and_slash_separated_undeclared_managed_images() {
    reject_uninventoried_html(&[
        "<img src=qa-scribe-attachment://FOREIGN_ID>",
        "<img/src=\"qa-scribe-attachment://FOREIGN_ID\">",
        "<img/src=qa-scribe-attachment://FOREIGN_ID>",
        "<IMG//SRC='qa-scribe-attachment://FOREIGN_ID'>",
        "<img /src=qa-scribe-attachment://FOREIGN_ID>",
        "<img alt='borrowed' /src=qa-scribe-attachment://FOREIGN_ID>",
    ]);
}

#[test]
fn html_inventory_rejects_slash_separated_local_data_and_blob_images() {
    reject_uninventoried_html(&[
        "<img/src=\"data:image/png;base64,aW1hZ2U=\">",
        "<img/src=data:image/png;base64,aW1hZ2U=>",
        "<img/src='blob:local-image'>",
        "<img/src=blob:local-image>",
        "<IMG//SRC=\"data&#58;image/png;base64,aW1hZ2U=\">",
        "<img /src='blob:local-image'>",
    ]);
}

#[test]
fn html_inventory_rejects_browser_decoded_named_colon_images() {
    reject_uninventoried_html(&[
        "<img src=\"qa-scribe-attachment&colon;//FOREIGN_ID\">",
        "<img/src=qa-scribe-attachment&colon;//FOREIGN_ID>",
        "<img/src=\"data&colon;image/png;base64,aW1hZ2U=\">",
        "<img src=data&colon;image/png;base64,aW1hZ2U=>",
        "<img/src='blob&colon;local-image'>",
        "<img src=blob&colon;local-image>",
    ]);
}

const LEGACY_IMAGE_BODIES: &[&str] = &[
    "&lt;img src=\"qa-scribe-attachment://FOREIGN_ID\"&gt;",
    "&lt;img src=\"data:image/png;base64,aW1hZ2U=\"&gt;",
    "&lt;img src=\"blob:local-image\"&gt;",
    "&lt;p&gt;&lt;im&#103; src=\"qa-scribe-attachment://FOREIGN_ID\"&gt;&lt;/p&gt;",
    "&lt;p&gt;&lt;im&#103; src=\"data:image/png;base64,aW1hZ2U=\"&gt;&lt;/p&gt;",
    "&lt;p&gt;&lt;im&#103; src=\"blob:local-image\"&gt;&lt;/p&gt;",
    "&LT;IMG/SRC=qa-scribe-attachment&colon;//FOREIGN_ID&GT;",
    "<div>&lt;img src=\"qa-scribe-attachment://FOREIGN_ID\"&gt;</div>",
    "<style>&lt;/style&gt;&lt;img src=\"qa-scribe-attachment://FOREIGN_ID\"&gt;",
];

#[test]
fn html_inventory_rejects_legacy_repair_images_with_null_json() {
    reject_html_with_json(LEGACY_IMAGE_BODIES, None);
}

#[test]
fn html_inventory_rejects_legacy_repair_images_with_fallback_json() {
    reject_html_with_json(LEGACY_IMAGE_BODIES, Some("{}"));
}

#[test]
fn html_inventory_rejects_legacy_repair_images_with_unsupported_json_version() {
    reject_html_with_json(
        LEGACY_IMAGE_BODIES,
        Some("{\"schemaVersion\":2,\"doc\":{\"type\":\"doc\"}}"),
    );
}

#[test]
fn html_inventory_preserves_quoted_and_unquoted_shared_images_for_both_record_kinds() {
    for kind in [CreationKind::Finding, CreationKind::Testware] {
        for template in [
            "<img src=\"qa-scribe-attachment://SHARED_ID\">",
            "<img src=qa-scribe-attachment://SHARED_ID>",
            "<img/src=\"qa-scribe-attachment://SHARED_ID\">",
            "<img/src=qa-scribe-attachment://SHARED_ID>",
            "<IMG//SRC='qa-scribe-attachment://SHARED_ID'>",
            "<img alt='shared' /src=qa-scribe-attachment://SHARED_ID>",
            "<p>Text &copy; &amp; ordinary.</p><img src=\"qa-scribe-attachment&colon;//SHARED_ID\" data-attachment-id=\"SHARED_ID\" alt=\"A &quot;quote&quot;\">",
            "<img/src=qa-scribe-attachment&colon;//SHARED_ID>",
            "<img src='qa-scribe-attachment&#58;//SHARED_ID'>",
            "<img src=qa-scribe-attachment&#x3a//SHARED_ID>",
            "<p>Text &copy; &amp; ordinary.</p><img src=\"qa-scribe-attachment://SHARED_ID\"><img src=\"https://example.test/image?a=1&amp;b=2\">",
            "<img src=qa-scribe-attachment://SHARED_ID><img src=https://example.test/image?a=1&amp/b=2>",
            "<p>Code &lt;img src=\"qa-scribe-attachment://FOREIGN_ID\"&gt;</p><img src=\"qa-scribe-attachment://SHARED_ID\">",
            "<p>&lt;img src=\"data:image/png;base64,aW1hZ2U=\"&gt;</p><img src=qa-scribe-attachment://SHARED_ID>",
        ] {
            let fixture = Fixture::new();
            let shared = import_managed_attachment_bytes(
                &fixture.service,
                &fixture.root,
                &fixture.session,
                None,
                "shared.png".into(),
                Some("image/png".into()),
                b"shared".to_vec(),
            )
            .unwrap();
            let (_, prepared) = fixture.prepare(kind, 0);
            let html = template.replace("SHARED_ID", &shared.id);
            let mut input = html_only_request(&prepared, kind, html.clone());
            input.shared_attachment_ids.push(shared.id.clone());
            let result =
                commit_creation_save(&fixture.service, &fixture.root, input.clone()).unwrap();
            let record = match &result {
                CreationOutcome::Committed { record } => record,
                other => panic!("Unexpected shared image outcome: {other:?}"),
            };
            match record.as_ref() {
                CreatedRecord::Finding(record) => {
                    assert_eq!(record.body, html);
                    assert_eq!(record.body_json, None);
                }
                CreatedRecord::Testware(record) => {
                    assert_eq!(record.body, html);
                    assert_eq!(record.body_json, None);
                }
            }
            assert_eq!(
                commit_creation_save(&fixture.service, &fixture.root, input).unwrap(),
                result
            );
            assert_eq!(
                count(&fixture.service, "findings") + count(&fixture.service, "drafts"),
                1
            );
            assert_eq!(count(&fixture.service, "attachments"), 1);
            assert_eq!(
                fixture.service.get_attachment(&shared.id).unwrap(),
                Some(shared.clone())
            );
            assert_eq!(
                fs::read(fixture.root.join(shared.relative_path)).unwrap(),
                b"shared"
            );
        }
    }
}

#[test]
fn html_inventory_preserves_literal_code_examples_inside_genuine_html() {
    for kind in [CreationKind::Finding, CreationKind::Testware] {
        for html in [
            "<p>Code &lt;img src=\"qa-scribe-attachment://FOREIGN_ID\"&gt;</p>",
            "<p>&lt;img src=\"data:image/png;base64,aW1hZ2U=\"&gt;</p>",
            "<strong>Code &lt;img src=blob:local-image&gt;</strong>",
            "<p>&copy; &amp; &lt; ordinary entities.</p>",
        ] {
            let fixture = Fixture::new();
            let (_, prepared) = fixture.prepare(kind, 0);
            let input = html_only_request(&prepared, kind, html.into());
            let outcome = commit_creation_save(&fixture.service, &fixture.root, input).unwrap();
            let CreationOutcome::Committed { record } = outcome else {
                panic!("Expected commit")
            };
            match record.as_ref() {
                CreatedRecord::Finding(record) => assert_eq!(record.body, html),
                CreatedRecord::Testware(record) => assert_eq!(record.body, html),
            }
            assert_eq!(count(&fixture.service, "attachments"), 0);
            assert_eq!(
                count(&fixture.service, "findings") + count(&fixture.service, "drafts"),
                1
            );
            assert!(!fixture.root.join("attachments").exists());
        }
    }
}
