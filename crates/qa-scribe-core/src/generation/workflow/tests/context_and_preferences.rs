use super::*;

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
            relative_path: format!("attachments/{}/unreferenced.png", session.id),
        })
        .expect("unreferenced attachment should create");
    let request = request_for(
        &service,
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
    let mut request = request_for(
        &service,
        &session.id,
        GenerateAiActionKind::Testware,
        Some(&note.id),
    );
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
fn added_techniques_render_their_guidance_and_persist_their_id() {
    use crate::generation::preferences::{testware_metadata_json, testware_preferences_prompt};

    for (technique, id, label, guidance) in [
        (
            TestwareTechnique::ClassificationTree,
            "classification_tree",
            "Technique: Classification tree",
            "disjoint classes",
        ),
        (
            TestwareTechnique::ErrorGuessing,
            "error_guessing",
            "Technique: Error guessing",
            "Derive one check per suspected error",
        ),
        (
            TestwareTechnique::ChecklistBased,
            "checklist_based",
            "Technique: Checklist-based",
            "answered yes or no",
        ),
    ] {
        let preferences = TestwareGenerationPreferences {
            technique,
            output_format: TestwareOutputFormat::QaCases,
            depth: TestwareDepth::Balanced,
            include_negative_cases: true,
            include_boundary_cases: true,
            include_test_data: true,
            preserve_evidence: true,
            custom_instructions: None,
        };
        let prompt = testware_preferences_prompt(Some(&preferences));
        assert!(prompt.contains(label), "{id} label missing");
        assert!(prompt.contains(guidance), "{id} guidance missing");
        let metadata = testware_metadata_json(Some(&preferences)).expect("metadata");
        assert!(metadata.contains(&format!("\"technique\":\"{id}\"")));
    }
}
