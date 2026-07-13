use super::*;

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
fn action_completion_sanitizes_generated_rich_html_before_persistence() {
    for action in [
        GenerateAiActionKind::Testware,
        GenerateAiActionKind::Finding,
        GenerateAiActionKind::Summary,
    ] {
        let result = finish_action_with_output(
            action,
            r#"<script>alert(1)</script><h2 onclick="steal()">Safe Title</h2><p><a href="javascript:alert(1)" onclick="steal()">bad link</a> <a href="https://example.test/evidence" onclick="steal()">good link</a></p><img src="javascript:alert(1)" alt="bad image" /><img src="data:image/png;base64,abc" onerror="steal()" alt="inline image" /><ul data-type="taskList" onclick="steal()"><li data-type="taskItem" data-checked="true" onclick="steal()"><input type="checkbox" checked onclick="steal()" />Task</li></ul>"#,
        );
        let body = match action {
            GenerateAiActionKind::Testware => result.draft.expect("draft").body,
            GenerateAiActionKind::Finding => result.finding.expect("finding").body,
            GenerateAiActionKind::Summary => result.note_entry.expect("note entry").body,
        };

        assert!(body.contains("<h2>Safe Title</h2>"));
        assert!(body.contains("<a>bad link</a>"));
        assert!(body.contains(
            "<a href=\"https://example.test/evidence\" target=\"_blank\" rel=\"noreferrer\">good link</a>"
        ));
        assert!(body.contains("<img src=\"data:image/png;base64,abc\" alt=\"inline image\" />"));
        assert!(body.contains("<ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"true\"><input type=\"checkbox\" checked />Task</li></ul>"));
        assert!(!body.contains("script"));
        assert!(!body.contains("alert"));
        assert!(!body.contains("onclick"));
        assert!(!body.contains("onerror"));
        assert!(!body.contains("javascript:"));
        assert!(!body.contains("bad image"));
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
fn testware_output_rolls_back_when_ai_run_completion_cannot_transition() {
    let service = SessionService::in_memory().expect("service should open");
    let session = create_session(&service, "Already failed run");
    let note = create_note(
        &service,
        &session.id,
        "Input note",
        "<p>Generate output.</p>",
    );
    let request = request_for(&session.id, GenerateAiActionKind::Testware, Some(&note.id));
    let prepared =
        prepare_ai_action_generation(&service, &request).expect("generation should prepare");
    let ai_run_id = prepared.ai_run.id.clone();
    service
        .fail_ai_run(&ai_run_id, "cancelled before provider returned")
        .expect("run should fail before finish");

    let error = finish_ai_action_generation(
        &service,
        &request,
        prepared,
        Ok(success_generation_output("<h2>Generated</h2><p>Body.</p>")),
    )
    .expect_err("completed run transition should fail and roll back output");

    assert!(
        error.to_string().contains("AI Run is not running"),
        "expected AI Run transition error, got: {error}"
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
