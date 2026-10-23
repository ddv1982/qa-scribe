use super::*;

#[test]
fn reviewed_note_aba_rejects_before_context_or_run_creation() {
    for action in [
        GenerateAiActionKind::Finding,
        GenerateAiActionKind::Testware,
    ] {
        let service = SessionService::in_memory().unwrap();
        let session = create_session(&service, "ABA");
        let note = create_note(&service, &session.id, "Source", "<p>A</p>");
        let request = request_for(&service, &session.id, action, Some(&note.id));
        for body in ["<p>B</p>", "<p>A</p>"] {
            service
                .update_entry(
                    &note.id,
                    EntryPatch {
                        body: Some(body.into()),
                        ..Default::default()
                    },
                )
                .unwrap();
        }
        assert_eq!(
            service
                .note_source(&session.id, &note.id)
                .unwrap()
                .unwrap()
                .revision,
            2
        );
        assert!(
            prepare_ai_action_generation(&service, &request)
                .err()
                .unwrap()
                .to_string()
                .contains("reviewed Note changed")
        );
        for table in [
            "generation_contexts",
            "generation_context_entries",
            "generation_context_attachments",
            "ai_runs",
        ] {
            let count: i64 = service
                .database()
                .connection()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table}");
        }
    }
}

#[test]
fn reviewed_source_and_attachments_are_captured_before_later_writes() {
    let service = SessionService::in_memory().unwrap();
    let session = create_session(&service, "Capture");
    let (note, attachment) = create_note_with_attachment(&service, &session);
    let request = request_for(
        &service,
        &session.id,
        GenerateAiActionKind::Finding,
        Some(&note.id),
    );
    let prepared = prepare_ai_action_generation(&service, &request).unwrap();
    let captured = prepared.selected_note_body.clone().unwrap();
    service
        .update_entry(
            &note.id,
            EntryPatch {
                body: Some("<p>Later source</p>".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        prepared.selected_note_body.as_deref(),
        Some(captured.as_str())
    );
    assert!(
        prepared
            .attachments
            .iter()
            .any(|item| item.id == attachment.id)
    );
    assert!(!prepared.prompt.contains("Later source"));
    assert_eq!(
        service
            .database()
            .connection()
            .query_row("SELECT COUNT(*) FROM ai_runs", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    let linked: String = service
        .database()
        .connection()
        .query_row(
            "SELECT entry_id FROM generation_context_entries WHERE generation_context_id = ?1",
            [&prepared.generation_context.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(linked, note.id);
}

#[test]
fn invalid_run_rolls_back_captured_context_and_links() {
    let service = SessionService::in_memory().unwrap();
    let session = create_session(&service, "Rollback");
    let note = create_note(&service, &session.id, "Source", "<p>Source</p>");
    let mut request = request_for(
        &service,
        &session.id,
        GenerateAiActionKind::Testware,
        Some(&note.id),
    );
    request.reasoning_effort = Some("x".repeat(100));
    assert!(prepare_ai_action_generation(&service, &request).is_err());
    for table in [
        "generation_contexts",
        "generation_context_entries",
        "generation_context_attachments",
        "ai_runs",
    ] {
        let count: i64 = service
            .database()
            .connection()
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0, "{table}");
    }
}

#[test]
fn generation_requires_an_explicit_reviewed_source_token() {
    let service = SessionService::in_memory().unwrap();
    let session = create_session(&service, "Missing token");
    let note = create_note(&service, &session.id, "Source", "<p>Source</p>");
    let mut request = request_for(
        &service,
        &session.id,
        GenerateAiActionKind::Finding,
        Some(&note.id),
    );
    request.expected_note_revision = None;
    assert!(prepare_ai_action_generation(&service, &request).is_err());
    assert_eq!(
        service
            .database()
            .connection()
            .query_row("SELECT COUNT(*) FROM ai_runs", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn a_concurrent_note_writer_is_compared_before_any_generation_rows() {
    let path = std::env::temp_dir().join(format!(
        "qa-scribe-reviewed-source-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let service = SessionService::new(crate::storage::Database::open(&path).unwrap()).unwrap();
    let session = create_session(&service, "Concurrent source");
    let note = create_note(&service, &session.id, "Source", "<p>Before</p>");
    let request = request_for(
        &service,
        &session.id,
        GenerateAiActionKind::Finding,
        Some(&note.id),
    );
    let writer = rusqlite::Connection::open(&path).unwrap();
    writer.execute_batch("BEGIN IMMEDIATE").unwrap();
    writer
        .execute(
            "UPDATE entries SET body = '<p>After</p>' WHERE id = ?1",
            [&note.id],
        )
        .unwrap();
    let waiting = std::thread::spawn(move || {
        assert!(
            prepare_ai_action_generation(&service, &request)
                .err()
                .unwrap()
                .to_string()
                .contains("reviewed Note changed")
        );
        for table in [
            "generation_contexts",
            "generation_context_entries",
            "generation_context_attachments",
            "ai_runs",
        ] {
            let count: i64 = service
                .database()
                .connection()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table}");
        }
    });
    writer.execute_batch("COMMIT").unwrap();
    waiting.join().unwrap();
    drop(writer);
    std::fs::remove_file(path).unwrap();
}
