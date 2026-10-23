use super::*;

#[test]
fn process_cuts_reconcile_only_owned_files_or_return_the_committed_receipt() {
    for kind in [CreationKind::Finding, CreationKind::Testware] {
        for point in [
            "reserved",
            "bound",
            "namespace-reserved",
            "temp-created",
            "temp",
            "rename",
            "image-staged",
            "attachment-insert",
            "record-insert",
            "receipt-update",
            "committed",
        ] {
            let fixture = Fixture::new();
            let unrelated = import_managed_attachment_bytes(
                &fixture.service,
                &fixture.root,
                &fixture.session,
                None,
                "unrelated.png".into(),
                Some("image/png".into()),
                b"unrelated".to_vec(),
            )
            .unwrap();
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
            assert_eq!(
                status.code(),
                Some(93),
                "{kind:?} {point} must cut the real Rust path"
            );
            let service = open(&fixture.root);
            let prepared = service
                .prepare_creation_save(preparation(&fixture.session, kind, 2))
                .unwrap();
            assert_eq!(
                creation::require_attempt(service.database().connection(), "attempt")
                    .unwrap()
                    .payload_hash
                    .is_some(),
                point != "reserved"
            );
            if point == "committed" {
                let committed =
                    commit_creation_save(&service, &fixture.root, request(&prepared, kind))
                        .unwrap();
                assert!(matches!(committed, CreationOutcome::Committed { .. }));
                assert_eq!(
                    reconcile_creation_saves(&service, &fixture.root)
                        .unwrap()
                        .pending_attempts,
                    0
                );
                assert_eq!(count(&service, "attachments"), 3);
            } else {
                assert_eq!(
                    count(&service, "findings") + count(&service, "drafts"),
                    0,
                    "{point} rolls back partial records"
                );
                assert_eq!(
                    reconcile_creation_saves(&service, &fixture.root)
                        .unwrap()
                        .pending_attempts,
                    0
                );
                assert_eq!(
                    abort_creation_save(&service, &fixture.root, "attempt").unwrap(),
                    CreationOutcome::Aborted
                );
                assert_eq!(count(&service, "attachments"), 1);
                for index in 0..2 {
                    assert!(!path(&service, &fixture.root, index).exists());
                }
            }
            assert_eq!(
                fs::read(fixture.root.join(unrelated.relative_path)).unwrap(),
                b"unrelated"
            );
        }
    }
}
