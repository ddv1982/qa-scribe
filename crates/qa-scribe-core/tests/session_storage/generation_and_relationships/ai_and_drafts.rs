#[test]
fn settings_generation_context_ai_run_and_draft_round_trip() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let default_settings = service
        .get_settings()
        .expect("default settings should load");
    assert_eq!(default_settings.schema_version, 1);
    assert_eq!(
        default_settings.generation_system_prompt,
        default_generation_system_prompt()
    );
    assert!(!default_settings.generation_system_prompt.contains("Testware"));

    let updated_settings = service
        .update_settings(AppSettings {
            schema_version: 1,
            generation_system_prompt: "Summarize the selected Session into Testware.".to_string(),
            ..AppSettings::default()
        })
        .expect("settings should update");
    assert_eq!(
        service.get_settings().expect("settings should reload"),
        updated_settings
    );

    service
        .update_settings(AppSettings {
            schema_version: 1,
            generation_system_prompt: legacy_testware_generation_system_prompt().to_string(),
            ..AppSettings::default()
        })
        .expect("legacy default settings should save");
    assert_eq!(
        service
            .get_settings()
            .expect("legacy default should normalize")
            .generation_system_prompt,
        default_generation_system_prompt()
    );

    let session = service
        .create_session(SessionDraft {
            title: "Generation flow".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let entry = service
        .create_entry(EntryDraft {
            session_id: session.id.clone(),
            entry_type: EntryType::Note,
            title: None,
            body: "Checkout works for guest users.".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("entry should be created");
    let excluded_entry = service
        .create_entry(EntryDraft {
            session_id: session.id.clone(),
            entry_type: EntryType::Note,
            title: None,
            body: "Do not include this setup note.".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("entry should be created");
    service
        .update_entry(
            &excluded_entry.id,
            EntryPatch {
                excluded_from_generation: Some(true),
                ..EntryPatch::default()
            },
        )
        .expect("entry should update");

    let context = service
        .create_generation_context(&session.id)
        .expect("generation context should be created");
    assert_eq!(context.session_id, session.id);
    assert_eq!(
        count_rows(service.database().connection(), "generation_context_entries"),
        1
    );

    let ai_run = service
        .create_ai_run(AiRunCreate {
            session_id: session.id.clone(),
            generation_context_id: Some(context.id),
            provider: AiProvider::CodexCli,
            model: "gpt-test".to_string(),
            reasoning_effort: Some("low".to_string()),
            prompt_version: "session-report-v1".to_string(),
        })
        .expect("AI Run should be created");
    assert_eq!(ai_run.session_id, session.id);
    assert_eq!(
        service
            .complete_ai_run(&ai_run.id)
            .expect("AI Run should complete")
            .status
            .as_str(),
        "completed"
    );

    let draft = service
        .create_draft(DraftCreate {
            session_id: session.id.clone(),
            ai_run_id: Some(ai_run.id.clone()),
            kind: DraftKind::SessionReport,
            title: "Session Report Draft".to_string(),
            body: format!("Entry used: {}", entry.id),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
        })
        .expect("Draft should be created");
    assert_eq!(draft.kind, DraftKind::SessionReport);

    let updated_draft = service
        .update_draft(
            &draft.id,
            DraftPatch {
                title: None,
                body: Some("Edited Session Report Draft".to_string()),
                ..DraftPatch::default()
            },
        )
        .expect("Draft should update");
    assert_eq!(updated_draft.body, "Edited Session Report Draft");

    let failed = service
        .create_ai_run(AiRunCreate {
            session_id: session.id.clone(),
            generation_context_id: None,
            provider: AiProvider::CodexCli,
            model: "gpt-test".to_string(),
            reasoning_effort: None,
            prompt_version: "session-report-v1".to_string(),
        })
        .expect("AI Run should be created");
    assert_eq!(
        service
            .fail_ai_run(&failed.id, "provider unavailable")
            .expect("AI Run should fail")
            .status
            .as_str(),
        "failed"
    );
    assert_eq!(
        service
            .list_drafts(&session.id)
            .expect("Drafts should list")
            .first()
            .expect("updated Draft should exist")
            .body,
        "Edited Session Report Draft"
    );

    service
        .delete_session(&session.id)
        .expect("session should delete");
    let connection = service.database().connection();
    assert_eq!(count_rows(connection, "generation_contexts"), 0);
    assert_eq!(count_rows(connection, "generation_context_entries"), 0);
    assert_eq!(count_rows(connection, "ai_runs"), 0);
    assert_eq!(count_rows(connection, "drafts"), 0);
}
#[test]
fn body_format_null_resets_to_default_html_for_rich_records() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Body format reset".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");

    let entry = service
        .create_entry(EntryDraft {
            session_id: session.id.clone(),
            entry_type: EntryType::Note,
            title: Some("Entry".to_string()),
            body: "<p>Entry</p>".to_string(),
            body_json: Some(r#"{"type":"doc"}"#.to_string()),
            body_format: Some("tiptap_json".to_string()),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("entry should create");
    let entry = service
        .update_entry(
            &entry.id,
            EntryPatch {
                body_format: Some(None),
                ..EntryPatch::default()
            },
        )
        .expect("entry body format should reset");
    assert_eq!(entry.body_format.as_deref(), Some("html"));

    let finding = service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Finding".to_string(),
            body: "<p>Finding</p>".to_string(),
            body_json: Some(r#"{"type":"doc"}"#.to_string()),
            body_format: Some("tiptap_json".to_string()),
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .expect("finding should create");
    let finding = service
        .update_finding(
            &finding.id,
            FindingPatch {
                body_format: Some(None),
                ..FindingPatch::default()
            },
        )
        .expect("finding body format should reset");
    assert_eq!(finding.body_format.as_deref(), Some("html"));

    let draft = service
        .create_draft(DraftCreate {
            session_id: session.id,
            ai_run_id: None,
            kind: DraftKind::SessionReport,
            title: "Draft".to_string(),
            body: "<p>Draft</p>".to_string(),
            body_json: Some(r#"{"type":"doc"}"#.to_string()),
            body_format: Some("tiptap_json".to_string()),
            metadata_json: None,
        })
        .expect("draft should create");
    let draft = service
        .update_draft(
            &draft.id,
            DraftPatch {
                body_format: Some(None),
                ..DraftPatch::default()
            },
        )
        .expect("draft body format should reset");
    assert_eq!(draft.body_format.as_deref(), Some("html"));
}


#[test]
fn deleting_draft_preserves_ai_run_and_other_drafts() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Draft cleanup".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let context = service
        .create_generation_context(&session.id)
        .expect("generation context should be created");
    let ai_run = service
        .create_ai_run(AiRunCreate {
            session_id: session.id.clone(),
            generation_context_id: Some(context.id),
            provider: AiProvider::CodexCli,
            model: "gpt-test".to_string(),
            reasoning_effort: None,
            prompt_version: "draft-delete-v1".to_string(),
        })
        .expect("AI Run should be created");
    let testware = service
        .create_draft(DraftCreate {
            session_id: session.id.clone(),
            ai_run_id: Some(ai_run.id.clone()),
            kind: DraftKind::Testware,
            title: "Checkout testware".to_string(),
            body: "Scenario: checkout completion".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
        })
        .expect("Testware Draft should be created");
    let report = service
        .create_draft(DraftCreate {
            session_id: session.id.clone(),
            ai_run_id: Some(ai_run.id),
            kind: DraftKind::SessionReport,
            title: "Session report".to_string(),
            body: "Report stays available.".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            metadata_json: None,
        })
        .expect("Session Report Draft should be created");
    let testware_id = testware.id.clone();

    service
        .delete_draft(&testware_id)
        .expect("Testware Draft should delete");
    let drafts = service
        .list_drafts(&session.id)
        .expect("Drafts should list after delete");
    assert_eq!(drafts.len(), 1);
    assert_eq!(drafts[0].id, report.id);
    let connection = service.database().connection();
    assert_eq!(count_rows(connection, "ai_runs"), 1);
    assert_eq!(count_rows(connection, "generation_contexts"), 1);
    assert!(matches!(
        service.delete_draft(&testware_id),
        Err(QaScribeError::NotFound(missing_id)) if missing_id == testware_id
    ));
}
