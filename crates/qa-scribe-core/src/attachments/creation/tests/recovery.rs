use super::*;

#[test]
fn prepare_long_filename_is_a_definite_validation_rejection_without_an_attempt() {
    for kind in [CreationKind::Finding, CreationKind::Testware] {
        let fixture = Fixture::new();
        let mut prep = preparation(&fixture.session, kind, 1);
        prep.images[0].filename = format!("{}.png", "x".repeat(201));
        let error = fixture.service.prepare_creation_save(prep).unwrap_err();
        assert!(
            matches!(&error, crate::QaScribeError::Validation(message) if message == "Creation image filename must be sanitized and at most 200 bytes")
        );
        eprintln!(
            "{kind:?}: {error}; attempts={}, reservations={}",
            count(&fixture.service, "creation_attempts"),
            count(&fixture.service, "creation_attempt_images")
        );
        assert_eq!(count(&fixture.service, "creation_attempts"), 0);
        assert_eq!(count(&fixture.service, "creation_attempt_images"), 0);
        assert_eq!(
            count(&fixture.service, "findings") + count(&fixture.service, "drafts"),
            0
        );
        assert!(matches!(
            abort_creation_save(&fixture.service, &fixture.root, "attempt"),
            Err(crate::QaScribeError::NotFound(_))
        ));
        let (_, prepared) = fixture.prepare(kind, 1);
        let input = request(&prepared, kind);
        let outcome = commit_creation_save(&fixture.service, &fixture.root, input.clone()).unwrap();
        assert!(matches!(outcome, CreationOutcome::Committed { .. }));
        assert_eq!(
            commit_creation_save(&fixture.service, &fixture.root, input).unwrap(),
            outcome
        );
        assert_eq!(
            count(&fixture.service, "findings") + count(&fixture.service, "drafts"),
            1
        );
    }
}

#[cfg(unix)]
fn interrupt_partial_write(fixture: &Fixture, kind: CreationKind) -> PathBuf {
    let status = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "attachments::creation::tests::cut_worker",
            "--nocapture",
        ])
        .env("UC1_CUT_ROOT", &fixture.root)
        .env("UC1_CUT", "partial-write")
        .env("UC1_KIND", kind.as_str())
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(93));
    let parent = fixture.root.join("attachments").join(&fixture.session);
    let mut paths = Vec::new();
    for entry in fs::read_dir(parent).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            paths.extend(
                fs::read_dir(path)
                    .unwrap()
                    .map(|entry| entry.unwrap().path()),
            );
        } else {
            paths.push(path);
        }
    }
    let partial = paths
        .into_iter()
        .find(|path| fs::read(path).is_ok_and(|bytes| bytes == b"im"))
        .expect("actual persisted partial bytes before process exit");
    assert_eq!(fs::read(&partial).unwrap(), b"im");
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let (relative, device, inode): (String, String, String) = fixture
            .service
            .database()
            .connection()
            .query_row(
                "SELECT relative_path, device, inode FROM creation_staging",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let metadata = fs::symlink_metadata(partial.parent().unwrap()).unwrap();
        assert_eq!(fixture.root.join(relative), partial.parent().unwrap());
        assert_eq!(device, metadata.dev().to_string());
        assert_eq!(inode, metadata.ino().to_string());
    }

    assert_eq!(
        count(&fixture.service, "findings") + count(&fixture.service, "drafts"),
        0
    );
    eprintln!(
        "{kind:?}: process exited during write; partial={}; bytes={:?}; pending reservations={}",
        partial.display(),
        fs::read(&partial).unwrap(),
        count(&fixture.service, "creation_attempt_images")
    );
    partial
}

#[cfg(unix)]
#[test]
fn partial_process_write_reopens_and_aborts_or_reconciles_without_erasing_borrowed_files() {
    for kind in [CreationKind::Finding, CreationKind::Testware] {
        for startup in [false, true] {
            let fixture = Fixture::new();
            let borrowed = import_managed_attachment_bytes(
                &fixture.service,
                &fixture.root,
                &fixture.session,
                None,
                "note.png".into(),
                Some("image/png".into()),
                b"borrowed".to_vec(),
            )
            .unwrap();
            let partial = interrupt_partial_write(&fixture, kind);
            let reopened = open(&fixture.root);
            if startup {
                assert_eq!(
                    reconcile_creation_saves(&reopened, &fixture.root)
                        .unwrap()
                        .pending_attempts,
                    0
                );
            } else {
                assert_eq!(
                    abort_creation_save(&reopened, &fixture.root, "attempt").unwrap(),
                    CreationOutcome::Aborted
                );
            }
            assert!(!partial.exists());
            assert!(!partial.parent().unwrap().exists());
            assert_eq!(count(&reopened, "creation_staging"), 0);
            assert_eq!(
                abort_creation_save(&reopened, &fixture.root, "attempt").unwrap(),
                CreationOutcome::Aborted
            );
            let prepared = reopened
                .prepare_creation_save(preparation(&fixture.session, kind, 2))
                .unwrap();
            assert_eq!(
                commit_creation_save(&reopened, &fixture.root, request(&prepared, kind)).unwrap(),
                CreationOutcome::Aborted
            );
            assert_eq!(count(&reopened, "findings") + count(&reopened, "drafts"), 0);
            assert_eq!(count(&reopened, "attachments"), 1);
            assert_eq!(
                fs::read(fixture.root.join(borrowed.relative_path)).unwrap(),
                b"borrowed"
            );
        }
    }
}

#[cfg(unix)]
#[test]
fn partial_process_write_retry_commits_once_with_original_reservations() {
    for kind in [CreationKind::Finding, CreationKind::Testware] {
        let fixture = Fixture::new();
        let partial = interrupt_partial_write(&fixture, kind);
        let reopened = open(&fixture.root);
        let prepared = reopened
            .prepare_creation_save(preparation(&fixture.session, kind, 2))
            .unwrap();
        let input = request(&prepared, kind);
        let result = commit_creation_save(&reopened, &fixture.root, input.clone()).unwrap();
        assert!(matches!(result, CreationOutcome::Committed { .. }));
        assert_eq!(
            commit_creation_save(&reopened, &fixture.root, input).unwrap(),
            result
        );
        assert_eq!(
            abort_creation_save(&reopened, &fixture.root, "attempt").unwrap(),
            result
        );
        assert_eq!(count(&reopened, "findings") + count(&reopened, "drafts"), 1);
        assert_eq!(count(&reopened, "attachments"), 2);
        assert!(!partial.exists());
        assert!(!partial.parent().unwrap().exists());
        assert_eq!(count(&reopened, "creation_staging"), 0);
    }
}

#[cfg(unix)]
#[test]
fn staging_cleanup_process_cuts_recover_without_a_file_or_directory() {
    for kind in [CreationKind::Finding, CreationKind::Testware] {
        for point in ["staging-unlink", "staging-remove-dir"] {
            let fixture = Fixture::new();
            let partial = interrupt_partial_write(&fixture, kind);
            let owned = partial.parent().unwrap();
            let status = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "attachments::creation::tests::cut_worker",
                    "--nocapture",
                ])
                .env("UC1_CUT_ROOT", &fixture.root)
                .env("UC1_CUT", point)
                .env("UC1_KIND", kind.as_str())
                .status()
                .unwrap();
            assert_eq!(status.code(), Some(93));
            assert!(!partial.exists());
            assert_eq!(owned.exists(), point == "staging-unlink");
            assert_eq!(
                count(&fixture.service, "creation_staging"),
                1,
                "terminated cleanup rolls back only its DB deletion"
            );
            let reopened = open(&fixture.root);
            assert_eq!(
                reconcile_creation_saves(&reopened, &fixture.root)
                    .unwrap()
                    .pending_attempts,
                0
            );
            assert_eq!(count(&reopened, "creation_staging"), 0);
            assert!(!owned.exists());
            assert_eq!(count(&reopened, "findings") + count(&reopened, "drafts"), 0);
        }
    }
}

#[cfg(unix)]
#[test]
fn an_uncommitted_namespace_can_contain_no_image_and_does_not_poison_abort() {
    let fixture = Fixture::new();
    let status = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "attachments::creation::tests::cut_worker",
            "--nocapture",
        ])
        .env("UC1_CUT_ROOT", &fixture.root)
        .env("UC1_CUT", "namespace-created")
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(93));
    assert_eq!(count(&fixture.service, "creation_staging"), 0);
    let parent = fixture.root.join("attachments").join(&fixture.session);
    let entries: Vec<_> = fs::read_dir(parent)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert_eq!(entries.len(), 1);
    assert!(entries[0].is_dir());
    assert_eq!(fs::read_dir(&entries[0]).unwrap().count(), 0);
    assert_eq!(
        abort_creation_save(&fixture.service, &fixture.root, "attempt").unwrap(),
        CreationOutcome::Aborted
    );
    assert!(
        entries[0].exists(),
        "no committed ownership proof permits sweeping this empty namespace"
    );
}

#[cfg(unix)]
#[test]
fn staging_receipt_cannot_authorize_replaced_borrowed_or_unexpected_files() {
    use std::os::unix::fs::symlink;
    for changed in [
        "directory-identity",
        "directory-symlink",
        "image-symlink",
        "hardlink",
        "borrowed",
        "extra-file",
        "receipt-path",
        "receipt-inode",
    ] {
        let fixture = Fixture::new();
        let partial = interrupt_partial_write(&fixture, CreationKind::Finding);
        let directory = partial.parent().unwrap();
        let outside = fixture.root.join("preserve");
        fs::create_dir(&outside).unwrap();
        let foreign = outside.join("foreign.png");
        fs::write(&foreign, b"foreign").unwrap();
        match changed {
            "directory-identity" | "directory-symlink" => {
                fs::rename(directory, outside.join("original-owned")).unwrap();
                if changed == "directory-symlink" {
                    symlink(&outside, directory).unwrap();
                } else {
                    fs::create_dir(directory).unwrap();
                    fs::write(&partial, b"replacement").unwrap();
                }
            }
            "image-symlink" | "hardlink" => {
                fs::remove_file(&partial).unwrap();
                if changed == "image-symlink" {
                    symlink(&foreign, &partial).unwrap();
                } else {
                    fs::hard_link(&foreign, &partial).unwrap();
                }
            }
            "borrowed" => {
                let connection = fixture.service.database().connection();
                let borrowed = create_attachment_on(
                    connection,
                    uuid::Uuid::new_v4().to_string(),
                    AttachmentDraft {
                        session_id: fixture.session.clone(),
                        entry_id: None,
                        filename: "foreign.png".into(),
                        mime_type: Some("image/png".into()),
                        size_bytes: 2,
                        sha256: hex_sha256(b"im"),
                        relative_path: format!("attachments/{}/foreign.png", fixture.session),
                    },
                )
                .unwrap();
                connection
                    .execute(
                        "UPDATE attachments SET relative_path = ?1 WHERE id = ?2",
                        params![
                            partial
                                .strip_prefix(&fixture.root)
                                .unwrap()
                                .to_str()
                                .unwrap(),
                            borrowed.id
                        ],
                    )
                    .unwrap();
            }
            "extra-file" => {
                fs::write(directory.join("unrelated.png"), b"preserve").unwrap();
            }
            "receipt-path" => {
                fixture
                    .service
                    .database()
                    .connection()
                    .execute(
                        "UPDATE creation_staging SET relative_path = '../preserve'",
                        [],
                    )
                    .unwrap();
            }
            "receipt-inode" => {
                fixture
                    .service
                    .database()
                    .connection()
                    .execute("UPDATE creation_staging SET inode = 'wrong'", [])
                    .unwrap();
            }
            _ => unreachable!(),
        }
        let before = fs::read(&partial).ok();
        assert!(
            abort_creation_save(&fixture.service, &fixture.root, "attempt").is_err(),
            "{changed}"
        );
        assert_eq!(
            reconcile_creation_saves(&fixture.service, &fixture.root)
                .unwrap()
                .pending_attempts,
            1,
            "{changed}"
        );
        assert_eq!(fs::read(&partial).ok(), before, "{changed}");
        assert_eq!(fs::read(&foreign).unwrap(), b"foreign", "{changed}");
        assert_eq!(count(&fixture.service, "creation_staging"), 1);
        assert_eq!(
            count(&fixture.service, "findings") + count(&fixture.service, "drafts"),
            0
        );
    }
}

#[cfg(unix)]
#[test]
fn a_mismatched_final_still_blocks_cleanup_of_even_proven_owned_partial_bytes() {
    for bytes in [&b"wrong"[..], &b"im"[..]] {
        let fixture = Fixture::new();
        let partial = interrupt_partial_write(&fixture, CreationKind::Finding);
        let final_path = path(&fixture.service, &fixture.root, 0);
        fs::write(&final_path, bytes).unwrap();
        assert!(abort_creation_save(&fixture.service, &fixture.root, "attempt").is_err());
        assert_eq!(fs::read(&partial).unwrap(), b"im");
        assert_eq!(fs::read(&final_path).unwrap(), bytes);
        assert_eq!(
            reconcile_creation_saves(&fixture.service, &fixture.root)
                .unwrap()
                .pending_attempts,
            1
        );
        assert_eq!(count(&fixture.service, "creation_staging"), 1);
    }
}
