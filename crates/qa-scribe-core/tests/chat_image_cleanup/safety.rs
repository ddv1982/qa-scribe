use super::*;
use qa_scribe_core::attachments::chat::PreparedChatImageImport;
use rusqlite::params;

#[test]
fn release_and_session_deletion_preserve_a_concurrent_import_workers_receipt_and_pixels() {
    let f = Fixture::new();
    let chat = f.import(&f.service.load_chat(&f.session).unwrap());
    let released = f.attachment(&chat);
    let db = f.root.join("test.sqlite");
    let root = f.root.clone();
    let revision = scope(&chat);
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    let (resume_tx, resume_rx) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        let service = SessionService::new(Database::open(db).unwrap()).unwrap();
        let import =
            PreparedChatImageImport::decode(revision, "pending.png".into(), &png()).unwrap();
        import.reserve(&service).unwrap();
        import.write(&root).unwrap();
        let receipt: (String, String) = service
            .database()
            .connection()
            .query_row(
                "SELECT relative_path,temp_path FROM chat_image_imports",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        ready_tx.send(receipt.clone()).unwrap();
        resume_rx
            .recv_timeout(std::time::Duration::from_secs(15))
            .unwrap();
        assert!(import.commit(&service).is_err());
        import.recover(&service, &root).unwrap();
        receipt
    });
    let (path, temp) = ready_rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    f.service
        .save_chat_composer(request(&chat, vec![]))
        .unwrap();
    f.retry();
    assert!(!f.root.join(&released.relative_path).exists());
    f.service.delete_session(&f.session).unwrap();
    f.retry();
    let during = fs::read(f.root.join(&path));
    let receipts = f
        .service
        .database()
        .connection()
        .query_row(
            "SELECT count(*) FROM chat_image_imports WHERE relative_path=?1 AND temp_path=?2",
            params![path, temp],
            |r| r.get::<_, i64>(0),
        )
        .unwrap();
    resume_tx.send(()).unwrap();
    worker.join().unwrap();
    assert_eq!(receipts, 1);
    assert_eq!(
        during.unwrap(),
        include_bytes!("../../../../e2e/fixtures/chat-image-pixels.png")
    );
    assert!(!f.root.join(path).exists());
    assert_eq!(
        f.service
            .database()
            .connection()
            .query_row("SELECT count(*) FROM chat_image_imports", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn cleanup_guards_both_import_paths_and_any_attachment_row_at_the_queued_path() {
    for owner in ["attachment", "receipt", "receipt_temp"] {
        let f = Fixture::new();
        let chat = f.import(&f.service.load_chat(&f.session).unwrap());
        let a = f.attachment(&chat);
        let c = f.service.database().connection();
        c.execute(
            "INSERT INTO chat_image_cleanup (relative_path,session_id) VALUES (?1,?2)",
            params![a.relative_path, f.session],
        )
        .unwrap();
        if owner != "attachment" {
            c.execute("DELETE FROM chat_composer_images", []).unwrap();
            c.execute("DELETE FROM attachments", []).unwrap();
            let other = format!("attachments/{}/other.png", f.session);
            let (path, temp) = if owner == "receipt" {
                (&a.relative_path, &other)
            } else {
                (&other, &a.relative_path)
            };
            c.execute("INSERT INTO chat_image_imports (relative_path,temp_path,session_id) VALUES (?1,?2,?3)", params![path,temp,f.session]).unwrap();
        }
        assert_eq!(
            retry_attachment_cleanup(&f.service, &f.root)
                .unwrap()
                .pending_files,
            Some(1),
            "{owner}"
        );
        assert_eq!(
            fs::read(f.root.join(a.relative_path)).unwrap(),
            include_bytes!("../../../../e2e/fixtures/chat-image-pixels.png")
        );
    }
}

#[test]
fn invalid_intents_and_unknown_files_are_untouched_and_retry_is_bounded() {
    let f = Fixture::new();
    let folder = f.root.join("attachments").join(&f.session);
    fs::create_dir_all(&folder).unwrap();
    let outside = f.root.join("outside");
    fs::write(&outside, b"outside").unwrap();
    fs::write(folder.join("unknown"), b"unknown").unwrap();
    for path in [
        "../outside".into(),
        format!("attachments/{}/../outside", f.session),
        "attachments/wrong/file".into(),
    ] {
        f.service
            .database()
            .connection()
            .execute(
                "INSERT INTO chat_image_cleanup (relative_path,session_id) VALUES (?1,?2)",
                params![path, f.session],
            )
            .unwrap();
    }
    for i in 0..53 {
        let relative = format!("attachments/{}/{i:03}.png", f.session);
        fs::write(f.root.join(&relative), b"owned orphan").unwrap();
        f.service
            .database()
            .connection()
            .execute(
                "INSERT INTO chat_image_cleanup (relative_path,session_id) VALUES (?1,?2)",
                params![relative, f.session],
            )
            .unwrap();
    }
    assert_eq!(
        retry_attachment_cleanup(&f.service, &f.root)
            .unwrap()
            .pending_files,
        Some(8)
    );
    assert_eq!(
        retry_attachment_cleanup(&f.service, &f.root)
            .unwrap()
            .pending_files,
        Some(3)
    );
    assert_eq!(fs::read(outside).unwrap(), b"outside");
    assert_eq!(fs::read(folder.join("unknown")).unwrap(), b"unknown");
}

#[cfg(unix)]
#[test]
fn symlink_targets_and_session_directories_are_untouched_until_safe_retry() {
    for parent_link in [false, true] {
        let f = Fixture::new();
        let chat = f.import(&f.service.load_chat(&f.session).unwrap());
        let a = f.attachment(&chat);
        let path = f.root.join(&a.relative_path);
        let session_dir = path.parent().unwrap();
        let external = f.root.join("external");
        fs::create_dir(&external).unwrap();
        let target = external.join(path.file_name().unwrap());
        fs::write(&target, b"external").unwrap();
        if parent_link {
            fs::remove_file(&path).unwrap();
            fs::remove_dir(session_dir).unwrap();
            std::os::unix::fs::symlink(&external, session_dir).unwrap();
        } else {
            fs::remove_file(&path).unwrap();
            std::os::unix::fs::symlink(&target, &path).unwrap();
        }
        qa_scribe_core::attachments::chat_cleanup::save_chat_composer_with_cleanup(
            &f.service,
            &f.root,
            request(&chat, vec![]),
        )
        .unwrap();
        assert_eq!(pending(&f.service), 1);
        assert_eq!(
            retry_attachment_cleanup(&f.service, &f.root)
                .unwrap()
                .pending_files,
            Some(1)
        );
        assert_eq!(fs::read(&target).unwrap(), b"external");
        fs::remove_file(if parent_link { session_dir } else { &path }).unwrap();
        f.retry();
        assert_eq!(fs::read(target).unwrap(), b"external");
    }
}

#[test]
fn session_cascade_cleans_remaining_images_and_pending_release_without_widening_old_intents() {
    let f = Fixture::new();
    let chat = f.import(&f.service.load_chat(&f.session).unwrap());
    let a = f.attachment(&chat);
    let chat = f.import(&chat);
    let b = f.attachment(&chat);
    f.service
        .save_chat_composer(request(&chat, vec![b.id.clone()]))
        .unwrap();
    assert_eq!(pending(&f.service), 1);
    f.service
        .database()
        .connection()
        .execute(
            "INSERT INTO attachment_cleanup (relative_path,session_id) VALUES (?1,?2)",
            params![b.relative_path, f.session],
        )
        .unwrap();
    assert_eq!(
        retry_attachment_cleanup(&f.service, &f.root)
            .unwrap()
            .pending_files,
        Some(1)
    );
    assert!(!f.root.join(&a.relative_path).exists());
    assert!(f.root.join(&b.relative_path).exists());
    f.service.delete_session(&f.session).unwrap();
    f.retry();
    assert!(!f.root.join(b.relative_path).exists());
}
