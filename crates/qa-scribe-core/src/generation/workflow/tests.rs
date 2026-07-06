use crate::{
    ai::ProviderGenerationOutput,
    domain::{
        AiProvider, Attachment, AttachmentDraft, Entry, EntryDraft, EntryPatch, EntryType, Session,
        SessionDraft,
    },
    generation::preferences::{
        TestwareDepth, TestwareGenerationPreferences, TestwareOutputFormat, TestwareTechnique,
    },
    services::SessionService,
};

use super::{
    GenerateAiActionKind, GenerateAiActionRequest, GenerateAiActionResult,
    finish_ai_action_generation, prepare_ai_action_generation,
};

#[test]
fn action_completion_repairs_escaped_rich_html_before_persistence() {
    for action in [
        GenerateAiActionKind::Testware,
        GenerateAiActionKind::Finding,
        GenerateAiActionKind::Summary,
    ] {
        let result = finish_action_with_output(
            action,
            "&lt;h2&gt;Escaped Title&lt;/h2&gt;&lt;p&gt;Generated rich content.&lt;/p&gt;",
        );
        let body = match action {
            GenerateAiActionKind::Testware => result.draft.expect("draft").body,
            GenerateAiActionKind::Finding => {
                let finding = result.finding.expect("finding");
                assert_eq!(finding.title, "Escaped Title");
                finding.body
            }
            GenerateAiActionKind::Summary => result.note_entry.expect("note entry").body,
        };

        assert!(body.contains("<h2>Escaped Title</h2>"));
        assert!(body.contains("<p>Generated rich content.</p>"));
        assert!(!body.contains("&lt;p&gt;"));
        assert!(!body.contains("&lt;h2&gt;"));
    }
}

#[test]
fn finding_completion_preserves_managed_screenshots_and_links_evidence() {
    let service = SessionService::in_memory().expect("service should open");
    let session = create_session(&service, "Gmail login");
    let (note, attachment) = create_note_with_attachment(&service, &session);
    let request = request_for(&session.id, GenerateAiActionKind::Finding, Some(&note.id));
    let prepared =
        prepare_ai_action_generation(&service, &request).expect("generation should prepare");
    let response = format!(
        "<h2>Gmail login fails</h2><p>Evidence:</p><img src=\"{}\" alt=\"Updated evidence\" />",
        attachment.relative_path
    );

    let result = finish_ai_action_generation(
        &service,
        &request,
        prepared,
        Ok(success_generation_output(&response)),
    )
    .expect("generation should finish");

    let finding = result.finding.expect("finding should be created");
    assert!(
        finding
            .body
            .contains(&format!("qa-scribe-attachment://{}", attachment.id))
    );
    assert!(
        finding
            .body
            .contains(&format!("data-attachment-id=\"{}\"", attachment.id))
    );
    assert!(
        !finding
            .body
            .contains(&format!("src=\"{}\"", attachment.relative_path))
    );

    let evidence_links = service
        .list_evidence_links(&session.id)
        .expect("evidence links should list");
    assert!(evidence_links.iter().any(|link| {
        link.finding_id == finding.id && link.entry_id.as_deref() == Some(note.id.as_str())
    }));
    assert!(evidence_links.iter().any(|link| {
        link.finding_id == finding.id
            && link.attachment_id.as_deref() == Some(attachment.id.as_str())
    }));
}

#[test]
fn testware_completion_preserves_managed_screenshots() {
    let service = SessionService::in_memory().expect("service should open");
    let session = create_session(&service, "Gmail login");
    let (note, attachment) = create_note_with_attachment(&service, &session);
    let request = request_for(&session.id, GenerateAiActionKind::Testware, Some(&note.id));
    let prepared =
        prepare_ai_action_generation(&service, &request).expect("generation should prepare");

    let result = finish_ai_action_generation(
        &service,
        &request,
        prepared,
        Ok(success_generation_output(
            "<h2>Login test</h2><p>Verify the login error.</p>",
        )),
    )
    .expect("generation should finish");

    let draft = result.draft.expect("testware draft should be created");
    assert!(
        draft
            .body
            .contains(&format!("qa-scribe-attachment://{}", attachment.id))
    );
    assert!(
        draft
            .body
            .contains(&format!("data-attachment-id=\"{}\"", attachment.id))
    );
    assert!(draft.body.contains("alt=\"Gmail error\""));
}

#[test]
fn testware_persistence_failure_marks_ai_run_failed_not_completed() {
    let service = SessionService::in_memory().expect("service should open");
    let session = create_session(&service, "Oversized output");
    let note = create_note(
        &service,
        &session.id,
        "Input note",
        "<p>Generate too much output.</p>",
    );
    let request = request_for(&session.id, GenerateAiActionKind::Testware, Some(&note.id));
    let prepared =
        prepare_ai_action_generation(&service, &request).expect("generation should prepare");
    let ai_run_id = prepared.ai_run.id.clone();
    let oversized_response = format!("<p>{}</p>", "x".repeat(300_000));

    let error = finish_ai_action_generation(
        &service,
        &request,
        prepared,
        Ok(success_generation_output(&oversized_response)),
    )
    .expect_err("oversized generated body should fail persistence");

    assert!(
        error.to_string().contains("Draft body"),
        "expected draft body validation error, got: {error}"
    );
    assert_eq!(count_table_rows(&service, "drafts"), 0);
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

#[test]
fn action_generation_context_contains_only_prompt_material() {
    let service = SessionService::in_memory().expect("service should open");
    let session = create_session(&service, "Selected context");
    let (selected_note, selected_attachment) = create_note_with_attachment(&service, &session);
    create_note(
        &service,
        &session.id,
        "Unselected note",
        "<p>This note is not part of the prompt.</p>",
    );
    service
        .create_attachment(AttachmentDraft {
            session_id: session.id.clone(),
            entry_id: None,
            filename: "unreferenced.png".to_string(),
            mime_type: Some("image/png".to_string()),
            size_bytes: 456,
            sha256: "b".repeat(64),
            relative_path: "attachments/session/unreferenced.png".to_string(),
        })
        .expect("unreferenced attachment should create");
    let request = request_for(
        &session.id,
        GenerateAiActionKind::Finding,
        Some(&selected_note.id),
    );

    let prepared =
        prepare_ai_action_generation(&service, &request).expect("generation should prepare");

    assert!(prepared.prompt.contains("Gmail login fails."));
    assert!(prepared.prompt.contains(&selected_attachment.id));
    assert_eq!(
        count_context_rows(
            &service,
            "generation_context_entries",
            "generation_context_id",
            &prepared.generation_context.id,
        ),
        1
    );
    assert_eq!(
        count_context_rows(
            &service,
            "generation_context_attachments",
            "generation_context_id",
            &prepared.generation_context.id,
        ),
        1
    );
}

#[test]
fn testware_preferences_are_added_to_prompt_and_draft_metadata() {
    let service = SessionService::in_memory().expect("service should open");
    let session = create_session(&service, "Checkout rules");
    let note = create_note(
        &service,
        &session.id,
        "Checkout rules",
        "<p>Discounts depend on country and basket total.</p>",
    );
    let preferences = TestwareGenerationPreferences {
        technique: TestwareTechnique::DecisionTable,
        output_format: TestwareOutputFormat::CoverageOutline,
        depth: TestwareDepth::Thorough,
        include_negative_cases: true,
        include_boundary_cases: true,
        include_test_data: false,
        preserve_evidence: true,
        custom_instructions: Some("Prioritize country and basket total combinations.".to_string()),
    };
    let mut request = request_for(&session.id, GenerateAiActionKind::Testware, Some(&note.id));
    request.testware_preferences = Some(preferences);
    let prepared =
        prepare_ai_action_generation(&service, &request).expect("generation should prepare");

    assert!(prepared.prompt.contains("Decision table"));
    assert!(prepared.prompt.contains("Coverage outline"));
    assert!(
        prepared
            .prompt
            .contains("Prioritize country and basket total combinations.")
    );

    let result = finish_ai_action_generation(
        &service,
        &request,
        prepared,
        Ok(success_generation_output("<h2>Coverage</h2><p>Case.</p>")),
    )
    .expect("generation should finish");
    let metadata = result
        .draft
        .expect("testware draft")
        .metadata_json
        .expect("testware metadata");
    assert!(metadata.contains("\"technique\":\"decision_table\""));
    assert!(metadata.contains("\"outputFormat\":\"coverage_outline\""));
    assert!(metadata.contains("\"includeTestData\":false"));
}

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

fn finish_action_with_output(
    action: GenerateAiActionKind,
    response: &str,
) -> GenerateAiActionResult {
    let service = SessionService::in_memory().expect("service should open");
    let session = create_session(&service, "Gmail login");
    let note = create_note(
        &service,
        &session.id,
        "Gmail login",
        "<p>Gmail login fails.</p>",
    );
    let request = request_for(&session.id, action, Some(&note.id));
    let prepared =
        prepare_ai_action_generation(&service, &request).expect("generation should prepare");

    finish_ai_action_generation(
        &service,
        &request,
        prepared,
        Ok(success_generation_output(response)),
    )
    .expect("generation should finish")
}

fn request_for(
    session_id: &str,
    action: GenerateAiActionKind,
    note_entry_id: Option<&str>,
) -> GenerateAiActionRequest {
    GenerateAiActionRequest {
        session_id: session_id.to_string(),
        provider: AiProvider::CodexCli,
        model: "test-model".to_string(),
        reasoning_effort: None,
        action,
        note_entry_id: note_entry_id.map(ToString::to_string),
        testware_preferences: None,
    }
}

fn create_session(service: &SessionService, title: &str) -> Session {
    service
        .create_session(SessionDraft {
            title: title.to_string(),
            ..SessionDraft::default()
        })
        .expect("session should create")
}

fn create_note(service: &SessionService, session_id: &str, title: &str, body: &str) -> Entry {
    service
        .create_entry(EntryDraft {
            session_id: session_id.to_string(),
            entry_type: EntryType::Note,
            title: Some(title.to_string()),
            body: body.to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("note should create")
}

fn create_note_with_attachment(service: &SessionService, session: &Session) -> (Entry, Attachment) {
    let note = create_note(
        service,
        &session.id,
        "Gmail login",
        "<p>Gmail login fails.</p>",
    );
    let attachment = service
        .create_attachment(AttachmentDraft {
            session_id: session.id.clone(),
            entry_id: Some(note.id.clone()),
            filename: "gmail-error.png".to_string(),
            mime_type: Some("image/png".to_string()),
            size_bytes: 123,
            sha256: "a".repeat(64),
            relative_path: "attachments/session/gmail-error.png".to_string(),
        })
        .expect("attachment should create");
    let note = service
        .update_entry(
            &note.id,
            EntryPatch {
                body: Some(format!(
                    "<p>Gmail login fails.</p><img src=\"qa-scribe-attachment://{}\" data-attachment-id=\"{}\" alt=\"Gmail error\" />",
                    attachment.id, attachment.id
                )),
                ..EntryPatch::default()
            },
        )
        .expect("note should update");
    (note, attachment)
}

fn success_generation_output(response: &str) -> ProviderGenerationOutput {
    ProviderGenerationOutput {
        exit_success: Some(true),
        stdout: response.as_bytes().to_vec(),
        stderr: Vec::new(),
        assistant_text: None,
        cancelled: false,
    }
}

fn count_table_rows(service: &SessionService, table: &str) -> i64 {
    service
        .database()
        .connection()
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .expect("table row count")
}

fn count_context_rows(service: &SessionService, table: &str, column: &str, id: &str) -> i64 {
    service
        .database()
        .connection()
        .query_row(
            &format!("SELECT COUNT(*) FROM {table} WHERE {column} = ?1"),
            [id],
            |row| row.get(0),
        )
        .expect("context row count")
}
