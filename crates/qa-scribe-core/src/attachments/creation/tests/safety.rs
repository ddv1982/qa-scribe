use super::*;

fn materialize(fixture: &Fixture) -> CreationAttemptImage {
    let slot = creation::read_images(fixture.service.database().connection(), "attempt")
        .unwrap()
        .remove(0);
    let path = fixture.root.join(&slot.relative_path);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, b"image").unwrap();
    slot
}

#[test]
fn abort_retains_digest_size_row_identity_and_non_regular_mismatches() {
    for mismatch in ["digest", "size", "row", "directory"] {
        let fixture = Fixture::new();
        fixture.prepare(CreationKind::Finding, 1);
        let slot = materialize(&fixture);
        let path = fixture.root.join(&slot.relative_path);
        match mismatch {
            "digest" => fs::write(&path, b"other").unwrap(),
            "size" => fs::write(&path, b"truncated").unwrap(),
            "directory" => {
                fs::remove_file(&path).unwrap();
                fs::create_dir(&path).unwrap();
            }
            "row" => {
                create_attachment_on(
                    fixture.service.database().connection(),
                    slot.attachment_id.clone(),
                    AttachmentDraft {
                        session_id: fixture.session.clone(),
                        entry_id: None,
                        filename: "different.png".into(),
                        mime_type: Some("image/png".into()),
                        size_bytes: 5,
                        sha256: hex_sha256(b"image"),
                        relative_path: slot.relative_path.clone(),
                    },
                )
                .unwrap();
            }
            _ => unreachable!(),
        }
        assert!(
            abort_creation_save(&fixture.service, &fixture.root, "attempt").is_err(),
            "{mismatch}"
        );
        assert_eq!(
            reconcile_creation_saves(&fixture.service, &fixture.root)
                .unwrap()
                .pending_attempts,
            1
        );
        assert!(path.exists());
        assert_eq!(
            creation::require_attempt(fixture.service.database().connection(), "attempt")
                .unwrap()
                .payload_hash,
            None
        );
    }
}

#[cfg(unix)]
#[test]
fn abort_and_commit_refuse_symlinks_at_every_owned_path_level() {
    use std::os::unix::fs::symlink;
    for level in ["attachments", "session", "final", "temp"] {
        let fixture = Fixture::new();
        let (_, prepared) = fixture.prepare(CreationKind::Finding, 1);
        let slot = creation::read_images(fixture.service.database().connection(), "attempt")
            .unwrap()
            .remove(0);
        let outside = fixture.root.join("outside");
        fs::create_dir(&outside).unwrap();
        let evidence = outside.join("preserve.png");
        fs::write(&evidence, b"image").unwrap();
        let parent = fixture.root.join("attachments").join(&fixture.session);
        let link = match level {
            "attachments" => {
                let link = fixture.root.join("attachments");
                symlink(&outside, &link).unwrap();
                link
            }
            "session" => {
                fs::create_dir(fixture.root.join("attachments")).unwrap();
                symlink(&outside, &parent).unwrap();
                parent
            }
            "final" => {
                fs::create_dir_all(&parent).unwrap();
                let link = fixture.root.join(&slot.relative_path);
                symlink(&evidence, &link).unwrap();
                link
            }
            "temp" => {
                fs::create_dir_all(&parent).unwrap();
                let link = parent.join(format!(".{}.tmp", slot.attachment_id));
                symlink(&evidence, &link).unwrap();
                link
            }
            _ => unreachable!(),
        };
        assert!(
            commit_creation_save(
                &fixture.service,
                &fixture.root,
                request(&prepared, CreationKind::Finding)
            )
            .is_err()
        );
        assert!(abort_creation_save(&fixture.service, &fixture.root, "attempt").is_err());
        assert!(fs::symlink_metadata(link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read(evidence).unwrap(), b"image");
    }
}

#[test]
fn cleanup_checks_every_live_reference_owner_under_the_write_transaction() {
    for owner in [
        "entry-body",
        "entry-json",
        "draft-body",
        "draft-json",
        "finding-body",
        "finding-json",
        "evidence",
        "generation",
    ] {
        let fixture = Fixture::new();
        fixture.prepare(CreationKind::Finding, 1);
        let slot = materialize(&fixture);
        let connection = fixture.service.database().connection();
        create_attachment_on(
            connection,
            slot.attachment_id.clone(),
            AttachmentDraft {
                session_id: fixture.session.clone(),
                entry_id: None,
                filename: slot.descriptor.filename.clone(),
                mime_type: Some(slot.descriptor.mime_type.clone()),
                size_bytes: 5,
                sha256: slot.descriptor.sha256.clone(),
                relative_path: slot.relative_path.clone(),
            },
        )
        .unwrap();
        let note = fixture
            .service
            .get_or_create_note_entry(&fixture.session)
            .unwrap();
        let finding = fixture
            .service
            .create_finding(FindingDraft {
                session_id: fixture.session.clone(),
                title: "Other finding".into(),
                body: String::new(),
                body_json: None,
                body_format: None,
                metadata_json: None,
                kind: FindingKind::Bug,
            })
            .unwrap();
        let draft = fixture
            .service
            .create_draft(DraftCreate {
                session_id: fixture.session.clone(),
                title: "Other draft".into(),
                body: String::new(),
                body_json: None,
                body_format: None,
                metadata_json: None,
                ai_run_id: None,
                kind: DraftKind::Testware,
            })
            .unwrap();
        match owner {
            "entry-body" | "entry-json" => {
                connection
                    .execute(
                        &format!(
                            "UPDATE entries SET {} = ?1 WHERE id = ?2",
                            if owner.ends_with("body") {
                                "body"
                            } else {
                                "body_json"
                            }
                        ),
                        params![slot.attachment_id, note.id],
                    )
                    .unwrap();
            }
            "draft-body" | "draft-json" => {
                connection
                    .execute(
                        &format!(
                            "UPDATE drafts SET {} = ?1 WHERE id = ?2",
                            if owner.ends_with("body") {
                                "body"
                            } else {
                                "body_json"
                            }
                        ),
                        params![slot.attachment_id, draft.id],
                    )
                    .unwrap();
            }
            "finding-body" | "finding-json" => {
                connection
                    .execute(
                        &format!(
                            "UPDATE findings SET {} = ?1 WHERE id = ?2",
                            if owner.ends_with("body") {
                                "body"
                            } else {
                                "body_json"
                            }
                        ),
                        params![slot.attachment_id, finding.id],
                    )
                    .unwrap();
            }
            "evidence" => {
                fixture
                    .service
                    .create_evidence_link(EvidenceLinkDraft {
                        finding_id: finding.id,
                        entry_id: None,
                        attachment_id: Some(slot.attachment_id.clone()),
                    })
                    .unwrap();
            }
            "generation" => {
                connection.execute("INSERT INTO generation_contexts (id, session_id, created_at) VALUES ('context', ?1, 't')", [&fixture.session]).unwrap();
                connection.execute("INSERT INTO generation_context_attachments (id, generation_context_id, attachment_id) VALUES ('link', 'context', ?1)", [&slot.attachment_id]).unwrap();
            }
            _ => unreachable!(),
        }
        assert!(
            abort_creation_save(&fixture.service, &fixture.root, "attempt").is_err(),
            "{owner}"
        );
        assert_eq!(
            fs::read(fixture.root.join(&slot.relative_path)).unwrap(),
            b"image"
        );
        assert!(
            attachment_on(connection, &slot.attachment_id)
                .unwrap()
                .is_some()
        );
        assert_eq!(
            reconcile_creation_saves(&fixture.service, &fixture.root)
                .unwrap()
                .pending_attempts,
            1
        );
    }
}

#[test]
fn session_cascade_preserves_reservations_and_committed_deleted_tombstones() {
    let fixture = Fixture::new();
    let (_, prepared) = fixture.prepare(CreationKind::Finding, 1);
    let slot = materialize(&fixture);
    let unrelated = fixture
        .root
        .join("attachments")
        .join(&fixture.session)
        .join("unrelated.png");
    fs::write(&unrelated, b"retain").unwrap();
    fixture.service.delete_session(&fixture.session).unwrap();
    assert_eq!(count(&fixture.service, "creation_attempt_images"), 1);
    assert!(
        commit_creation_save(
            &fixture.service,
            &fixture.root,
            request(&prepared, CreationKind::Finding)
        )
        .is_err()
    );
    assert_eq!(
        reconcile_creation_saves(&fixture.service, &fixture.root)
            .unwrap()
            .pending_attempts,
        0
    );
    assert!(!fixture.root.join(slot.relative_path).exists());
    assert_eq!(fs::read(unrelated).unwrap(), b"retain");

    let fixture = Fixture::new();
    let (_, prepared) = fixture.prepare(CreationKind::Testware, 0);
    let input = request(&prepared, CreationKind::Testware);
    commit_creation_save(&fixture.service, &fixture.root, input.clone()).unwrap();
    fixture.service.delete_session(&fixture.session).unwrap();
    assert!(matches!(
        commit_creation_save(&fixture.service, &fixture.root, input).unwrap(),
        CreationOutcome::CommittedDeleted { .. }
    ));
    assert_eq!(count(&fixture.service, "drafts"), 0);
}

#[test]
fn failed_final_insert_rolls_back_attachments_and_retry_uses_the_original_files() {
    let fixture = Fixture::new();
    let (_, prepared) = fixture.prepare(CreationKind::Finding, 2);
    fixture.service.database().connection().execute_batch("CREATE TRIGGER refuse_result BEFORE INSERT ON findings BEGIN SELECT RAISE(FAIL, 'Injected final insert failure'); END;").unwrap();
    let input = request(&prepared, CreationKind::Finding);
    assert!(commit_creation_save(&fixture.service, &fixture.root, input.clone()).is_err());
    assert_eq!(count(&fixture.service, "attachments"), 0);
    assert_eq!(count(&fixture.service, "findings"), 0);
    assert!(
        creation::require_attempt(fixture.service.database().connection(), "attempt")
            .unwrap()
            .payload_hash
            .is_some()
    );
    for index in 0..2 {
        assert_eq!(
            fs::read(path(&fixture.service, &fixture.root, index)).unwrap(),
            b"image"
        );
    }
    fixture
        .service
        .database()
        .connection()
        .execute_batch("DROP TRIGGER refuse_result")
        .unwrap();
    assert!(matches!(
        commit_creation_save(&fixture.service, &fixture.root, input).unwrap(),
        CreationOutcome::Committed { .. }
    ));
    assert_eq!(count(&fixture.service, "findings"), 1);
    assert_eq!(count(&fixture.service, "attachments"), 2);
}

#[test]
fn a_temp_path_borrowed_by_another_attachment_is_never_renamed_or_unlinked() {
    let fixture = Fixture::new();
    let (_, prepared) = fixture.prepare(CreationKind::Finding, 1);
    let slot = creation::read_images(fixture.service.database().connection(), "attempt")
        .unwrap()
        .remove(0);
    let temporary = format!(
        "attachments/{}/.{}.tmp",
        fixture.session, slot.attachment_id
    );
    let path = fixture.root.join(&temporary);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, b"image").unwrap();
    let owner = create_attachment_on(
        fixture.service.database().connection(),
        uuid::Uuid::new_v4().to_string(),
        AttachmentDraft {
            session_id: fixture.session.clone(),
            entry_id: None,
            filename: "other.png".into(),
            mime_type: Some("image/png".into()),
            size_bytes: 5,
            sha256: hex_sha256(b"image"),
            relative_path: temporary,
        },
    )
    .unwrap();
    assert!(
        commit_creation_save(
            &fixture.service,
            &fixture.root,
            request(&prepared, CreationKind::Finding)
        )
        .is_err()
    );
    assert!(abort_creation_save(&fixture.service, &fixture.root, "attempt").is_err());
    assert_eq!(fs::read(&path).unwrap(), b"image");
    assert!(
        attachment_on(fixture.service.database().connection(), &owner.id)
            .unwrap()
            .is_some()
    );
}
