#[test]
fn live_session_live_path_unknown_siblings_and_malformed_queue_are_preserved() {
    let root = Temp::new();
    let service = SessionService::in_memory().unwrap();
    let a = attachment(&service, &root.0);
    queue(&service, &a.session_id, &a.relative_path);
    let unknown = root.0.join(&a.relative_path).parent().unwrap().join("unknown.txt");
    fs::write(&unknown, "unknown").unwrap();
    let b = attachment(&service, &root.0);
    let referenced = "attachments/deleted/claimed.txt";
    fs::create_dir_all(root.0.join("attachments/deleted")).unwrap();
    fs::write(root.0.join(referenced), "live reference").unwrap();
    service.database().connection().execute(
        "UPDATE attachments SET relative_path = ?1 WHERE id = ?2", params![referenced, b.id],
    ).unwrap();
    queue(&service, "deleted", referenced);
    for bad in ["../outside", "attachments/deleted/../escape", "attachments/deleted/nested/file",
        "attachments/wrong/file", "attachments/deleted//file", "attachments/deleted/./file"] {
        queue(&service, "deleted", bad);
    }
    fs::write(root.0.join("outside"), "outside").unwrap();
    assert_eq!(retry_attachment_cleanup(&service, &root.0).unwrap().pending_files, Some(8));
    assert!(root.0.join(&a.relative_path).is_file());
    assert!(root.0.join(referenced).is_file());
    assert_eq!(fs::read_to_string(&unknown).unwrap(), "unknown");
    assert_eq!(fs::read_to_string(root.0.join("outside")).unwrap(), "outside");
}

#[test]
fn bounded_batches_rotate_past_failures_without_sweeping_unknown_files() {
    let root = Temp::new();
    let db = root.0.join("session.sqlite");
    let service = SessionService::new(Database::open(&db).unwrap()).unwrap();
    let parent = root.0.join("attachments/deleted");
    fs::create_dir_all(&parent).unwrap();
    for index in 0..50 {
        let name = format!("a-blocked-{index:03}");
        fs::create_dir(parent.join(&name)).unwrap();
        queue(&service, "deleted", &format!("attachments/deleted/{name}"));
    }
    for index in 0..5 {
        let name = format!("z-ready-{index:03}");
        fs::write(parent.join(&name), "queued").unwrap();
        queue(&service, "deleted", &format!("attachments/deleted/{name}"));
    }
    fs::write(parent.join("unknown"), "unknown").unwrap();
    assert_eq!(retry_attachment_cleanup(&service, &root.0).unwrap().pending_files, Some(55));
    assert!(parent.join("z-ready-000").exists(), "first batch must stop at 50 attempts");
    drop(service);
    let service = SessionService::new(Database::open(&db).unwrap()).unwrap();
    assert_eq!(retry_attachment_cleanup(&service, &root.0).unwrap().pending_files, Some(50));
    assert!(!parent.join("z-ready-000").exists(), "failed paths must not starve untouched paths");
    assert_eq!(fs::read_to_string(parent.join("unknown")).unwrap(), "unknown");
}

#[test]
fn database_free_helper_can_only_remove_empty_directories() {
    let root = Temp::new();
    let parent = root.0.join("attachments/session");
    fs::create_dir_all(&parent).unwrap();
    fs::write(parent.join("unknown"), "unknown").unwrap();
    assert!(delete_session_attachment_files(&root.0, "session").is_err());
    assert!(parent.join("unknown").is_file());
    assert!(delete_session_attachment_files(&root.0, "session/nested").is_err());
    fs::remove_file(parent.join("unknown")).unwrap();
    delete_session_attachment_files(&root.0, "session").unwrap();
    assert!(!parent.exists());
}

#[cfg(unix)]
#[test]
fn symlinked_root_parent_and_file_are_preserved() {
    use std::os::unix::fs::symlink;
    for level in ["root", "parent", "file"] {
        let root = Temp::new();
        let service = SessionService::in_memory().unwrap();
        let a = attachment(&service, &root.0);
        service.delete_session(&a.session_id).unwrap();
        let outside = root.0.join("outside");
        fs::create_dir(&outside).unwrap();
        let target = match level {
            "root" => root.0.join("attachments"),
            "parent" => root.0.join("attachments").join(&a.session_id),
            _ => root.0.join(&a.relative_path),
        };
        if level == "file" {
            fs::remove_file(&target).unwrap();
            fs::write(outside.join("evidence"), "outside").unwrap();
            symlink(outside.join("evidence"), &target).unwrap();
        } else {
            fs::rename(&target, outside.join("saved")).unwrap();
            symlink(outside.join("saved"), &target).unwrap();
        }
        assert_eq!(retry_attachment_cleanup(&service, &root.0).unwrap().pending_files, Some(1), "{level}");
        assert!(fs::symlink_metadata(&target).unwrap().file_type().is_symlink());
        assert!(root.0.join(&a.relative_path).is_file(), "symlink target must survive: {level}");
        fs::remove_file(&target).unwrap();
        if level == "file" {
            assert_eq!(fs::read_to_string(outside.join("evidence")).unwrap(), "outside");
        } else {
            fs::rename(outside.join("saved"), &target).unwrap();
        }
        assert_eq!(retry_attachment_cleanup(&service, &root.0).unwrap().pending_files, Some(0));
    }
}

#[cfg(unix)]
#[test]
fn broken_symlink_is_not_acknowledged_as_a_missing_file() {
    use std::os::unix::fs::symlink;
    let root = Temp::new();
    let service = SessionService::in_memory().unwrap();
    let a = attachment(&service, &root.0);
    service.delete_session(&a.session_id).unwrap();
    let path = root.0.join(&a.relative_path);
    fs::remove_file(&path).unwrap();
    symlink(root.0.join("missing-target"), &path).unwrap();
    assert_eq!(retry_attachment_cleanup(&service, &root.0).unwrap().pending_files, Some(1));
    assert!(fs::symlink_metadata(&path).unwrap().file_type().is_symlink());
    fs::remove_file(&path).unwrap();
    assert_eq!(retry_attachment_cleanup(&service, &root.0).unwrap().pending_files, Some(0));
}
