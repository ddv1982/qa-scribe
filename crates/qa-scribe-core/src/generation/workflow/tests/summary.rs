use super::*;

#[test]
fn summary_completion_preserves_managed_screenshots_on_note_overwrite() {
    let service = SessionService::in_memory().expect("service should open");
    let session = create_session(&service, "Gmail login");
    let (note, attachment) = create_note_with_attachment(&service, &session);
    let request = request_for(&session.id, GenerateAiActionKind::Summary, Some(&note.id));
    let prepared =
        prepare_ai_action_generation(&service, &request).expect("generation should prepare");

    let result = finish_ai_action_generation(
        &service,
        &request,
        prepared,
        Ok(success_generation_output(
            "<h2>Summary</h2><p>Gmail login fails with an error.</p>",
        )),
    )
    .expect("generation should finish");

    let note_entry = result.note_entry.expect("note entry should update");
    assert!(
        note_entry
            .body
            .contains(&format!("qa-scribe-attachment://{}", attachment.id))
    );
    assert!(
        note_entry
            .body
            .contains(&format!("data-attachment-id=\"{}\"", attachment.id))
    );
    assert!(note_entry.body.contains("alt=\"Gmail error\""));
}

#[test]
fn summary_generation_rejects_note_id_from_another_session() {
    let service = SessionService::in_memory().expect("service should open");
    let session = create_session(&service, "Target session");
    let other_session = create_session(&service, "Other session");
    let other_note = create_note(
        &service,
        &other_session.id,
        "Other note",
        "<p>Other session content.</p>",
    );
    create_note(
        &service,
        &session.id,
        "Fallback note",
        "<p>This note must not be used as a fallback.</p>",
    );
    let request = request_for(
        &session.id,
        GenerateAiActionKind::Summary,
        Some(&other_note.id),
    );
    let ai_run_count = count_table_rows(&service, "ai_runs");
    let generation_context_count = count_table_rows(&service, "generation_contexts");

    let error = match prepare_ai_action_generation(&service, &request) {
        Ok(_) => panic!("cross-session note must be rejected"),
        Err(error) => error,
    };

    assert!(
        error
            .to_string()
            .contains("Selected note entry was not found in this Session")
    );
    assert_eq!(count_table_rows(&service, "ai_runs"), ai_run_count);
    assert_eq!(
        count_table_rows(&service, "generation_contexts"),
        generation_context_count
    );
}

#[test]
fn summary_generation_without_note_does_not_persist_ai_run() {
    let service = SessionService::in_memory().expect("service should open");
    let session = create_session(&service, "Target session");
    create_note(
        &service,
        &session.id,
        "Fallback note",
        "<p>This note must not be used as a fallback.</p>",
    );
    let request = request_for(&session.id, GenerateAiActionKind::Summary, None);

    let error = match prepare_ai_action_generation(&service, &request) {
        Ok(_) => panic!("summary without a selected note must be rejected"),
        Err(error) => error,
    };

    assert!(
        error
            .to_string()
            .contains("Summarize notes requires an editable note entry")
    );
    assert_eq!(count_table_rows(&service, "ai_runs"), 0);
    assert_eq!(count_table_rows(&service, "generation_contexts"), 0);
}

#[test]
fn summary_completion_updates_the_selected_note_only() {
    let service = SessionService::in_memory().expect("service should open");
    let session = create_session(&service, "Gmail login");
    let first_note = create_note(&service, &session.id, "First note", "<p>First note.</p>");
    let selected_note = create_note(
        &service,
        &session.id,
        "Selected note",
        "<p>Selected note.</p>",
    );
    let request = request_for(
        &session.id,
        GenerateAiActionKind::Summary,
        Some(&selected_note.id),
    );
    let prepared =
        prepare_ai_action_generation(&service, &request).expect("generation should prepare");

    let result = finish_ai_action_generation(
        &service,
        &request,
        prepared,
        Ok(success_generation_output("<p>Selected summary.</p>")),
    )
    .expect("generation should finish");

    assert_eq!(
        result.note_entry.expect("updated note").id,
        selected_note.id
    );
    let first_note = service
        .list_entries(&first_note.session_id)
        .expect("entries should list")
        .into_iter()
        .find(|entry| entry.id == first_note.id)
        .expect("first note still exists");
    assert_eq!(first_note.body, "<p>First note.</p>");
}

#[test]
fn summary_completion_rejects_stale_note_overwrite() {
    let service = SessionService::in_memory().expect("service should open");
    let session = create_session(&service, "Gmail login");
    let note = create_note(
        &service,
        &session.id,
        "Selected note",
        "<p>Original note.</p>",
    );
    let request = request_for(&session.id, GenerateAiActionKind::Summary, Some(&note.id));
    let prepared =
        prepare_ai_action_generation(&service, &request).expect("generation should prepare");
    let ai_run_id = prepared.ai_run.id.clone();
    service
        .update_entry(
            &note.id,
            EntryPatch {
                body: Some("<p>User edited while generation ran.</p>".to_string()),
                ..EntryPatch::default()
            },
        )
        .expect("user edit should persist");

    let error = finish_ai_action_generation(
        &service,
        &request,
        prepared,
        Ok(success_generation_output("<p>Generated summary.</p>")),
    )
    .expect_err("stale summary should not overwrite a newer note edit");

    assert!(
        error.to_string().contains("Selected Note changed"),
        "expected stale-note validation error, got: {error}"
    );
    let current_note = service
        .list_entries(&session.id)
        .expect("entries should list")
        .into_iter()
        .find(|entry| entry.id == note.id)
        .expect("note still exists");
    assert_eq!(
        current_note.body,
        "<p>User edited while generation ran.</p>"
    );
    assert_eq!(
        service
            .get_ai_run(&ai_run_id)
            .expect("AI Run should read")
            .expect("AI Run should exist")
            .status
            .as_str(),
        "failed"
    );
}
