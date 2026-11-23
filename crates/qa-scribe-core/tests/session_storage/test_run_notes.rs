fn notes_json(image_ids: &[&str]) -> String {
    let mut content = vec![
        serde_json::json!({"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Actual result"}]}),
        serde_json::json!({"type":"paragraph","content":[{"type":"text","text":"The bank window stayed open."}]}),
    ];
    content.extend(image_ids.iter().map(|id| {
        serde_json::json!({"type":"image","attrs":{"attachmentId":id,"src":format!("qa-scribe-attachment://{id}")}})
    }));
    serde_json::json!({"schemaVersion":1,"doc":{"type":"doc","content":content}}).to_string()
}

fn notes_image(id: &str) -> qa_scribe_core::domain::TestCaseNoteImage {
    use base64::Engine;
    use image::{ImageFormat, RgbImage};

    let image = RgbImage::from_pixel(4, 3, image::Rgb([40, 50, 60]));
    let mut png = std::io::Cursor::new(Vec::new());
    image.write_to(&mut png, ImageFormat::Png).unwrap();
    let encoded = base64::engine::general_purpose::STANDARD.encode(png.into_inner());
    qa_scribe_core::domain::TestCaseNoteImage {
        id: id.into(),
        filename: "bank-window.png".into(),
        data_url: format!("data:image/png;base64,{encoded}"),
    }
}

fn save_case_notes(
    service: &SessionService,
    root: &std::path::Path,
    case_id: &str,
    body: String,
    images: Vec<qa_scribe_core::domain::TestCaseNoteImage>,
) -> qa_scribe_core::Result<qa_scribe_core::domain::TestRunCase> {
    let mut prepared = qa_scribe_core::services::PreparedTestCaseNotes::new(
        root,
        service.test_case_session_id(case_id)?, case_id.into(), body, images,
    )?;
    prepared.reserve(service)?;
    let result = prepared.write(root).and_then(|()| prepared.commit(service));
    if result.is_err() {
        prepared.recover(service, root);
    }
    result
}

#[test]
fn result_notes_and_shared_screenshot_survive_reopen_and_result_changes() {
    let root = unique_temp_dir();
    fs::create_dir_all(&root).unwrap();
    let database_path = root.join("notes.sqlite");
    let service = SessionService::new(Database::open(&database_path).unwrap()).unwrap();
    let run = started_run(&service);
    let second = service.start_test_run(&run.draft_id, run_cases(2)).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let case = &run.cases[0];
    let body = notes_json(&[&id]);

    for images in [vec![notes_image(&id)], vec![notes_image(&id)]] {
        let saved = save_case_notes(&service, &root, &case.id, body.clone(), images).unwrap();
        assert_eq!(saved.result, TestCaseResult::NotRun);
        assert_eq!(saved.body_json, case.body_json);
        assert_eq!(saved.notes.as_ref().unwrap().image_count, 1);
    }
    let attachment = service.get_attachment(&id).unwrap().unwrap();
    assert_eq!(service.list_attachments(&run.session_id).unwrap().len(), 1);
    save_case_notes(&service, &root, &second.cases[0].id, body.clone(), vec![]).unwrap();
    assert!(service.set_test_case_result(&case.id, TestCaseResult::Blocked, None).unwrap().notes.is_some());
    drop(service);

    let service = SessionService::new(Database::open(&database_path).unwrap()).unwrap();
    let report = service.test_run_report(&run.session_id, &run.id).unwrap();
    assert!(report.contains("  Result notes:\n    Actual result\n    The bank window stayed open.\n  Evidence: 1 image"));
    assert_eq!(service.get_test_run(&run.id).unwrap().cases[0].notes.as_ref().unwrap().body_json, body);
    assert!(attachment_preview_data_url(&service, &root, &id).unwrap().is_some());

    service.delete_test_run(&run.id).unwrap();
    service.reclaim_test_run_note_images().unwrap();
    assert!(root.join(&attachment.relative_path).exists());
    assert!(service.get_attachment(&id).unwrap().is_some());

    service.delete_draft(&run.draft_id).unwrap();
    service.reclaim_test_run_note_images().unwrap();
    qa_scribe_core::attachments::retry_attachment_cleanup(&service, &root).unwrap();
    assert!(!root.join(attachment.relative_path).exists());
    assert!(service.get_attachment(&id).unwrap().is_none());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_failed_result_notes_commit_recovers_files_and_keeps_the_previous_case() {
    let root = unique_temp_dir();
    fs::create_dir_all(&root).unwrap();
    let service = SessionService::in_memory().unwrap();
    let run = started_run(&service);
    let other = started_run(&service);
    let case_id = &run.cases[0].id;
    let foreign_id = uuid::Uuid::new_v4().to_string();
    save_case_notes(&service, &root, &other.cases[0].id, notes_json(&[&foreign_id]), vec![notes_image(&foreign_id)]).unwrap();
    let saved = service.set_test_case_result(case_id, TestCaseResult::Failed, Some("Legacy remark".into())).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let error = save_case_notes(&service, &root, case_id, notes_json(&[&id, &foreign_id]), vec![notes_image(&id)]).unwrap_err();
    assert!(error.to_string().contains("must belong to the test run's Session"), "{error}");
    assert_eq!(service.get_test_run(&run.id).unwrap().cases[0], saved);
    assert!(service.list_attachments(&run.session_id).unwrap().is_empty());
    let directory = root.join("attachments").join(run.session_id);
    assert!(!directory.exists() || fs::read_dir(directory).unwrap().next().is_none());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn schema_24_upgrade_preserves_existing_results_remarks_and_links() {
    let root = unique_temp_dir();
    fs::create_dir_all(&root).unwrap();
    let path = root.join("legacy.sqlite");
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let run = started_run(&service);
    let case_id = &run.cases[0].id;
    let finding = run_finding(&service, &run.session_id);
    service.set_test_case_result(case_id, TestCaseResult::Failed, Some("Already recorded".into())).unwrap();
    let original = service.link_test_case_finding(case_id, Some(finding.id)).unwrap();
    service.database().connection().execute_batch(
        "DROP TABLE test_run_note_images;
         ALTER TABLE test_run_cases DROP COLUMN notes_json;
         PRAGMA user_version = 24;",
    ).unwrap();
    drop(service);

    let service = SessionService::new(Database::open(path).unwrap()).unwrap();
    assert_eq!(service.get_test_run(&run.id).unwrap().cases[0], original);
    let saved = save_case_notes(&service, &root, case_id, notes_json(&[]), vec![]).unwrap();
    assert_eq!(saved.result, original.result);
    assert_eq!(saved.finding_id, original.finding_id);
    assert_eq!(saved.remark, original.remark);
    assert!(saved.notes.is_some());
    assert_no_foreign_key_violations(service.database().connection());
    drop(service);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn startup_recovery_leaves_a_live_result_notes_import_alone() {
    let root = unique_temp_dir();
    fs::create_dir_all(&root).unwrap();
    let path = root.join("notes.sqlite");
    let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let run = started_run(&service);
    let case_id = &run.cases[0].id;
    let id = uuid::Uuid::new_v4().to_string();
    let mut prepared = qa_scribe_core::services::PreparedTestCaseNotes::new(
        &root, run.session_id, case_id.into(), notes_json(&[&id]), vec![notes_image(&id)],
    ).unwrap();
    prepared.reserve(&service).unwrap();
    prepared.write(&root).unwrap();

    let other = SessionService::new(Database::open(&path).unwrap()).unwrap();
    let remaining = qa_scribe_core::attachments::chat_imports::recover_chat_image_imports(&other, &root).unwrap();
    assert_eq!(remaining, 1);
    prepared.commit(&service).unwrap();
    assert!(attachment_preview_data_url(&other, &root, &id).unwrap().is_some());
    drop(prepared);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn losing_an_image_reservation_cannot_commit_result_notes() {
    let root = unique_temp_dir();
    fs::create_dir_all(&root).unwrap();
    let service = SessionService::in_memory().unwrap();
    let run = started_run(&service);
    let case_id = &run.cases[0].id;
    let id = uuid::Uuid::new_v4().to_string();
    let mut prepared = qa_scribe_core::services::PreparedTestCaseNotes::new(
        &root, run.session_id, case_id.into(), notes_json(&[&id]), vec![notes_image(&id)],
    ).unwrap();
    prepared.reserve(&service).unwrap();
    prepared.write(&root).unwrap();
    service.database().connection().execute("DELETE FROM chat_image_imports", []).unwrap();

    assert!(prepared.commit(&service).is_err());
    assert!(service.get_attachment(&id).unwrap().is_none());
    assert!(service.get_test_run(&run.id).unwrap().cases[0].notes.is_none());
    drop(prepared);
    fs::remove_dir_all(root).unwrap();
}
