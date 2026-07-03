// Covers the error-kind strengthening from Task 9: referenced-row lookups
// that used to hand-roll `query_row` without `.optional()` (raising a raw
// `QueryReturnedNoRows` for a missing row) now go through the shared
// `require_row_in_session` helper and surface `QaScribeError::NotFound`
// instead.

#[test]
fn create_entry_returns_not_found_for_missing_session() {
    let service = SessionService::in_memory().expect("in-memory service should open");

    assert!(
        matches!(
            service.create_entry(EntryDraft {
                session_id: "missing-session".to_string(),
                entry_type: EntryType::Note,
                title: None,
                body: "orphaned entry attempt".to_string(),
                body_json: None,
                body_format: Some("html".to_string()),
                metadata_json: None,
                excluded_from_generation: false,
            }),
            Err(QaScribeError::NotFound(id)) if id == "missing-session"
        ),
        "creating an Entry under a missing Session must surface as NotFound, not a raw foreign-key Sqlite error"
    );
}

#[test]
fn create_evidence_link_returns_not_found_for_missing_referenced_rows() {
    let service = SessionService::in_memory().expect("in-memory service should open");

    assert!(
        matches!(
            service.create_evidence_link(EvidenceLinkDraft {
                finding_id: "missing-finding".to_string(),
                entry_id: Some("missing-entry".to_string()),
                attachment_id: None,
            }),
            Err(QaScribeError::NotFound(id)) if id == "missing-finding"
        ),
        "a missing Finding must surface as NotFound, not a raw Sqlite error"
    );

    let session = service
        .create_session(SessionDraft {
            title: "Evidence link not-found checks".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let finding = service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Real finding".to_string(),
            body: "Body".to_string(),
            body_json: None,
            body_format: Some("html".to_string()),
            kind: FindingKind::Note,
            metadata_json: None,
        })
        .expect("finding should be created");

    assert!(
        matches!(
            service.create_evidence_link(EvidenceLinkDraft {
                finding_id: finding.id.clone(),
                entry_id: Some("missing-entry".to_string()),
                attachment_id: None,
            }),
            Err(QaScribeError::NotFound(id)) if id == "missing-entry"
        ),
        "a missing Entry reference must surface as NotFound, not a raw Sqlite error"
    );

    assert!(
        matches!(
            service.create_evidence_link(EvidenceLinkDraft {
                finding_id: finding.id,
                entry_id: None,
                attachment_id: Some("missing-attachment".to_string()),
            }),
            Err(QaScribeError::NotFound(id)) if id == "missing-attachment"
        ),
        "a missing attachment reference must surface as NotFound, not a raw Sqlite error"
    );
}

#[test]
fn create_draft_returns_not_found_for_missing_ai_run() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Draft not-found check".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");

    assert!(
        matches!(
            service.create_draft(DraftCreate {
                session_id: session.id,
                ai_run_id: Some("missing-ai-run".to_string()),
                kind: DraftKind::SessionReport,
                title: "Report".to_string(),
                body: "Body".to_string(),
                body_json: None,
                body_format: Some("html".to_string()),
                metadata_json: None,
            }),
            Err(QaScribeError::NotFound(id)) if id == "missing-ai-run"
        ),
        "a missing AI Run reference must surface as NotFound, not a raw Sqlite error"
    );
}

#[test]
fn create_ai_run_returns_not_found_for_missing_generation_context() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "AI Run not-found check".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");

    assert!(
        matches!(
            service.create_ai_run(AiRunCreate {
                session_id: session.id,
                generation_context_id: Some("missing-context".to_string()),
                provider: AiProvider::ClaudeCode,
                model: "test-model".to_string(),
                reasoning_effort: None,
                prompt_version: "v1".to_string(),
            }),
            Err(QaScribeError::NotFound(id)) if id == "missing-context"
        ),
        "a missing Generation Context reference must surface as NotFound, not a raw Sqlite error"
    );
}
