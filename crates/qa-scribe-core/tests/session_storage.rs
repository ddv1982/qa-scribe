use qa_scribe_core::{
    QaScribeError,
    attachments::{
        attachment_preview_data_url, delete_session_attachment_files,
        import_clipboard_screenshot_data_url, import_managed_attachment,
    },
    domain::{
        AiProvider, AiRunCreate, AppSettings, DraftCreate, DraftKind, DraftPatch, EntryDraft,
        EntryPatch, EntryType, EvidenceLinkDraft, FindingDraft, FindingKind, FindingPatch,
        SessionDraft, SessionPatch,
    },
    export::{ExportFormat, export_session},
    services::SessionService,
    storage::Database,
};
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn session_library_create_reopen_update_delete_flow() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: " Checkout testing ".to_string(),
            session_context: Some("Cart and payment flow".to_string()),
            objective_notes: Some("Verify coupon edge cases".to_string()),
            environment: Some("staging".to_string()),
            build_version: Some("2026.06.22".to_string()),
            related_reference: Some("QA-42".to_string()),
        })
        .expect("session should be created");

    assert_eq!(session.title, "Checkout testing");
    assert_eq!(
        service.list_sessions().expect("sessions should list").len(),
        1
    );

    let reopened = service
        .reopen_session(&session.id)
        .expect("session should reopen");
    assert_eq!(reopened.id, session.id);
    assert!(reopened.last_opened_at >= session.last_opened_at);

    let updated = service
        .update_session(
            &session.id,
            SessionPatch {
                title: Some("Checkout regression".to_string()),
                environment: Some(Some("prod-like".to_string())),
                ..SessionPatch::default()
            },
        )
        .expect("session should update");

    assert_eq!(updated.title, "Checkout regression");
    assert_eq!(updated.environment.as_deref(), Some("prod-like"));

    service
        .delete_session(&session.id)
        .expect("session should delete");
    assert!(
        service
            .get_session(&session.id)
            .expect("query should succeed")
            .is_none()
    );
}

#[test]
fn settings_generation_context_ai_run_and_draft_round_trip() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let default_settings = service
        .get_settings()
        .expect("default settings should load");
    assert_eq!(default_settings.schema_version, 1);

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
        count_rows(
            service.database().connection(),
            "generation_context_entries"
        ),
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
        })
        .expect("Draft should be created");
    assert_eq!(draft.kind, DraftKind::SessionReport);

    let updated_draft = service
        .update_draft(
            &draft.id,
            DraftPatch {
                title: None,
                body: Some("Edited Session Report Draft".to_string()),
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
fn entries_findings_and_evidence_links_cascade_with_session() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Timeline capture".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let entry = service
        .create_entry(EntryDraft {
            session_id: session.id.clone(),
            entry_type: EntryType::Observation,
            title: Some("Coupon failure".to_string()),
            body: "Applying SAVE10 returns a 500.".to_string(),
            metadata_json: Some(r#"{"url":"https://example.test/cart"}"#.to_string()),
            excluded_from_generation: false,
        })
        .expect("entry should be created");
    let finding = service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Coupon crashes checkout".to_string(),
            body: "SAVE10 produces an internal error.".to_string(),
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .expect("finding should be created");
    let finding = service
        .update_finding(
            &finding.id,
            FindingPatch {
                title: Some("Coupon blocks checkout".to_string()),
                body: Some("<p>SAVE10 produces an internal error.</p>".to_string()),
            },
        )
        .expect("finding should update");
    assert_eq!(finding.title, "Coupon blocks checkout");
    assert_eq!(finding.body, "<p>SAVE10 produces an internal error.</p>");
    let link = service
        .create_evidence_link(EvidenceLinkDraft {
            finding_id: finding.id,
            entry_id: Some(entry.id),
            attachment_id: None,
        })
        .expect("evidence link should be created");

    assert!(!link.id.is_empty());
    assert_eq!(
        service
            .list_entries(&session.id)
            .expect("entries should list")
            .len(),
        1
    );
    assert_eq!(
        service
            .list_findings(&session.id)
            .expect("findings should list")
            .len(),
        1
    );

    service
        .delete_session(&session.id)
        .expect("session should delete");
    let connection = service.database().connection();
    assert_eq!(count_rows(connection, "entries"), 0);
    assert_eq!(count_rows(connection, "findings"), 0);
    assert_eq!(count_rows(connection, "evidence_links"), 0);
}

#[test]
fn deleting_finding_removes_evidence_links_but_keeps_entries() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Finding cleanup".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let entry = service
        .create_entry(EntryDraft {
            session_id: session.id.clone(),
            entry_type: EntryType::Observation,
            title: Some("Checkout observation".to_string()),
            body: "The checkout confirmation did not render.".to_string(),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("entry should be created");
    let finding = service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Checkout confirmation missing".to_string(),
            body: "The confirmation screen stays blank after payment.".to_string(),
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .expect("finding should be created");
    let finding_id = finding.id.clone();
    service
        .create_evidence_link(EvidenceLinkDraft {
            finding_id: finding.id,
            entry_id: Some(entry.id),
            attachment_id: None,
        })
        .expect("evidence link should be created");

    service
        .delete_finding(&finding_id)
        .expect("finding should delete");
    assert!(
        service
            .list_findings(&session.id)
            .expect("findings should list")
            .is_empty()
    );
    let connection = service.database().connection();
    assert_eq!(count_rows(connection, "evidence_links"), 0);
    assert_eq!(count_rows(connection, "entries"), 1);
    assert!(matches!(
        service.delete_finding(&finding_id),
        Err(QaScribeError::NotFound(missing_id)) if missing_id == finding_id
    ));
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
        })
        .expect("Testware Draft should be created");
    let report = service
        .create_draft(DraftCreate {
            session_id: session.id.clone(),
            ai_run_id: Some(ai_run.id),
            kind: DraftKind::SessionReport,
            title: "Session report".to_string(),
            body: "Report stays available.".to_string(),
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

#[test]
fn rich_text_bodies_can_be_blank() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let session = service
        .create_session(SessionDraft {
            title: "Blank body flow".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");

    let entry = service
        .create_entry(EntryDraft {
            session_id: session.id.clone(),
            entry_type: EntryType::Note,
            title: Some("Editable note".to_string()),
            body: "".to_string(),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("blank entry body should be accepted");
    assert_eq!(entry.body, "");

    let entry = service
        .update_entry(
            &entry.id,
            EntryPatch {
                body: Some("   ".to_string()),
                ..EntryPatch::default()
            },
        )
        .expect("blank entry update should be accepted");
    assert_eq!(entry.body, "");

    let finding = service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Blank finding".to_string(),
            body: "".to_string(),
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .expect("blank finding body should be accepted");
    assert_eq!(finding.body, "");

    let finding = service
        .update_finding(
            &finding.id,
            FindingPatch {
                title: None,
                body: Some("   ".to_string()),
            },
        )
        .expect("blank finding update should be accepted");
    assert_eq!(finding.body, "");

    let draft = service
        .create_draft(DraftCreate {
            session_id: session.id,
            ai_run_id: None,
            kind: DraftKind::Testware,
            title: "Blank testware".to_string(),
            body: "".to_string(),
        })
        .expect("blank draft body should be accepted");
    assert_eq!(draft.body, "");

    let draft = service
        .update_draft(
            &draft.id,
            DraftPatch {
                title: None,
                body: Some("   ".to_string()),
            },
        )
        .expect("blank draft update should be accepted");
    assert_eq!(draft.body, "");
}

#[test]
fn migration_removes_body_length_checks_without_losing_dependents() {
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let database_path = temp_dir.join("legacy.sqlite");

    {
        let connection =
            rusqlite::Connection::open(&database_path).expect("legacy database should open");
        connection
            .execute_batch(
                r#"
                PRAGMA foreign_keys = ON;

                CREATE TABLE sessions (
                  id TEXT PRIMARY KEY,
                  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
                  session_context TEXT,
                  objective_notes TEXT,
                  environment TEXT,
                  build_version TEXT,
                  related_reference TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  last_opened_at TEXT NOT NULL
                );

                CREATE TABLE entries (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  type TEXT NOT NULL CHECK (type IN ('note', 'observation', 'api_response', 'log', 'screenshot', 'finding_candidate')),
                  title TEXT,
                  body TEXT NOT NULL CHECK (length(body) > 0),
                  metadata_json TEXT,
                  excluded_from_generation INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE attachments (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
                  filename TEXT NOT NULL,
                  mime_type TEXT,
                  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
                  sha256 TEXT NOT NULL,
                  relative_path TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );

                CREATE TABLE findings (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
                  body TEXT NOT NULL CHECK (length(body) > 0),
                  kind TEXT NOT NULL CHECK (kind IN ('bug', 'question', 'risk', 'follow_up', 'note')),
                  metadata_json TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );

                CREATE TABLE evidence_links (
                  id TEXT PRIMARY KEY,
                  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
                  entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
                  attachment_id TEXT REFERENCES attachments(id) ON DELETE CASCADE,
                  created_at TEXT NOT NULL,
                  CHECK (entry_id IS NOT NULL OR attachment_id IS NOT NULL)
                );

                CREATE TABLE generation_contexts (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                  created_at TEXT NOT NULL
                );

                CREATE TABLE generation_context_entries (
                  id TEXT PRIMARY KEY,
                  generation_context_id TEXT NOT NULL REFERENCES generation_contexts(id) ON DELETE CASCADE,
                  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
                  included INTEGER NOT NULL DEFAULT 1
                );

                PRAGMA user_version = 2;

                INSERT INTO sessions (
                  id, title, session_context, objective_notes, environment, build_version,
                  related_reference, created_at, updated_at, last_opened_at
                )
                VALUES (
                  'session-1', 'Legacy session', NULL, NULL, NULL, NULL, NULL,
                  '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z'
                );

                INSERT INTO entries (
                  id, session_id, type, title, body, metadata_json, excluded_from_generation,
                  created_at, updated_at
                )
                VALUES (
                  'entry-1', 'session-1', 'note', 'Legacy note', '<p>Legacy note body</p>',
                  NULL, 0, '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z'
                );

                INSERT INTO attachments (
                  id, session_id, entry_id, filename, mime_type, size_bytes, sha256,
                  relative_path, created_at
                )
                VALUES (
                  'attachment-1', 'session-1', 'entry-1', 'evidence.png', 'image/png', 10,
                  'abc', 'session-1/evidence.png', '2026-06-22T00:00:00.000Z'
                );

                INSERT INTO findings (
                  id, session_id, title, body, kind, metadata_json, created_at, updated_at
                )
                VALUES (
                  'finding-1', 'session-1', 'Legacy finding', '<p>Legacy finding body</p>',
                  'bug', NULL, '2026-06-22T00:00:00.000Z', '2026-06-22T00:00:00.000Z'
                );

                INSERT INTO evidence_links (
                  id, finding_id, entry_id, attachment_id, created_at
                )
                VALUES (
                  'link-1', 'finding-1', 'entry-1', 'attachment-1',
                  '2026-06-22T00:00:00.000Z'
                );

                INSERT INTO generation_contexts (id, session_id, created_at)
                VALUES ('context-1', 'session-1', '2026-06-22T00:00:00.000Z');

                INSERT INTO generation_context_entries (
                  id, generation_context_id, entry_id, included
                )
                VALUES ('context-entry-1', 'context-1', 'entry-1', 1);
                "#,
            )
            .expect("legacy schema fixture should be created");
    }

    let service =
        SessionService::new(Database::open(&database_path).expect("database should migrate"));
    let connection = service.database().connection();
    assert_no_foreign_key_violations(connection);

    let entries_sql: String = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'entries'",
            [],
            |row| row.get(0),
        )
        .expect("entries schema should load");
    let findings_sql: String = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'findings'",
            [],
            |row| row.get(0),
        )
        .expect("findings schema should load");
    assert!(!entries_sql.replace(' ', "").contains("length(body)>0"));
    assert!(!findings_sql.replace(' ', "").contains("length(body)>0"));

    assert_eq!(count_rows(connection, "attachments"), 1);
    assert_eq!(count_rows(connection, "evidence_links"), 1);
    assert_eq!(count_rows(connection, "generation_context_entries"), 1);
    let attachment_entry_id: Option<String> = connection
        .query_row(
            "SELECT entry_id FROM attachments WHERE id = 'attachment-1'",
            [],
            |row| row.get(0),
        )
        .expect("attachment should survive migration");
    assert_eq!(attachment_entry_id.as_deref(), Some("entry-1"));

    let entry = service
        .update_entry(
            "entry-1",
            EntryPatch {
                body: Some("".to_string()),
                ..EntryPatch::default()
            },
        )
        .expect("migrated entry should accept blank body");
    assert_eq!(entry.body, "");

    let finding = service
        .update_finding(
            "finding-1",
            FindingPatch {
                title: None,
                body: Some("".to_string()),
            },
        )
        .expect("migrated finding should accept blank body");
    assert_eq!(finding.body, "");

    drop(service);
    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}

#[test]
fn managed_attachments_preview_generation_context_and_export_flow() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let source_path = temp_dir.join("browser log.txt");
    fs::write(&source_path, "network error at checkout").expect("source attachment should write");

    let session = service
        .create_session(SessionDraft {
            title: "Attachment export".to_string(),
            session_context: Some("Checkout evidence".to_string()),
            ..SessionDraft::default()
        })
        .expect("session should be created");
    let entry = service
        .create_entry(EntryDraft {
            session_id: session.id.clone(),
            entry_type: EntryType::Log,
            title: None,
            body: "Console showed a checkout error.".to_string(),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("entry should be created");

    let attachment = import_managed_attachment(
        &service,
        &temp_dir,
        &session.id,
        Some(entry.id),
        &source_path,
    )
    .expect("attachment should import");
    assert_eq!(attachment.filename, "browser_log.txt");
    assert_eq!(attachment.sha256.len(), 64);
    assert!(temp_dir.join(&attachment.relative_path).is_file());
    assert_eq!(
        service
            .list_attachments(&session.id)
            .expect("attachments should list")
            .len(),
        1
    );

    let pasted = import_clipboard_screenshot_data_url(
        &service,
        &temp_dir,
        &session.id,
        None,
        "clipboard.png".to_string(),
        "data:image/png;base64,aGVsbG8=",
    )
    .expect("clipboard screenshot should import");
    assert_eq!(pasted.mime_type.as_deref(), Some("image/png"));

    let preview = attachment_preview_data_url(&service, &temp_dir, &attachment.id)
        .expect("preview should load")
        .expect("preview should exist");
    assert!(preview.starts_with("data:text/plain;base64,"));

    service
        .create_generation_context(&session.id)
        .expect("generation context should create");
    assert_eq!(
        count_rows(
            service.database().connection(),
            "generation_context_attachments"
        ),
        2
    );

    let finding = service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Checkout log evidence".to_string(),
            body: "The imported log supports the Finding.".to_string(),
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .expect("finding should be created");
    service
        .create_evidence_link(EvidenceLinkDraft {
            finding_id: finding.id,
            entry_id: None,
            attachment_id: Some(attachment.id.clone()),
        })
        .expect("attachment Evidence link should be created");

    let markdown = export_session(&service, &session.id, ExportFormat::Markdown)
        .expect("markdown export should render");
    assert!(markdown.filename.ends_with(".md"));
    assert!(markdown.body.contains("browser_log.txt"));
    assert!(markdown.body.contains("Evidence Attachment"));
    let json = export_session(&service, &session.id, ExportFormat::Json)
        .expect("json export should render");
    assert!(json.body.contains("browser_log.txt"));
    assert!(json.body.contains("evidenceLinks"));

    delete_session_attachment_files(&temp_dir, &session.id)
        .expect("managed attachment files should clean up");
    assert!(!temp_dir.join("attachments").join(&session.id).exists());

    fs::remove_dir_all(temp_dir).expect("temp dir should be removed");
}

#[test]
fn validation_rejects_blank_session_titles_and_non_object_metadata() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    assert!(
        service
            .create_session(SessionDraft {
                title: "   ".to_string(),
                ..SessionDraft::default()
            })
            .is_err(),
        "blank Session titles should be rejected"
    );

    let session = service
        .create_session(SessionDraft {
            title: "Metadata check".to_string(),
            ..SessionDraft::default()
        })
        .expect("session should be created");

    assert!(
        service
            .create_entry(EntryDraft {
                session_id: session.id,
                entry_type: EntryType::Log,
                title: None,
                body: "console output".to_string(),
                metadata_json: Some("[]".to_string()),
                excluded_from_generation: false,
            })
            .is_err(),
        "metadata JSON must be an object"
    );
}

#[test]
fn evidence_links_must_stay_within_one_session() {
    let service = SessionService::in_memory().expect("in-memory service should open");
    let first = service
        .create_session(SessionDraft {
            title: "First Session".to_string(),
            ..SessionDraft::default()
        })
        .expect("first Session should be created");
    let second = service
        .create_session(SessionDraft {
            title: "Second Session".to_string(),
            ..SessionDraft::default()
        })
        .expect("second Session should be created");
    let entry = service
        .create_entry(EntryDraft {
            session_id: first.id,
            entry_type: EntryType::Note,
            title: None,
            body: "Evidence from another Session".to_string(),
            metadata_json: None,
            excluded_from_generation: false,
        })
        .expect("entry should be created");
    let finding = service
        .create_finding(FindingDraft {
            session_id: second.id.clone(),
            title: "Cross-session risk".to_string(),
            body: "Should not link to another Session.".to_string(),
            kind: FindingKind::Risk,
            metadata_json: None,
        })
        .expect("finding should be created");

    assert!(
        service
            .create_evidence_link(EvidenceLinkDraft {
                finding_id: finding.id,
                entry_id: Some(entry.id.clone()),
                attachment_id: None,
            })
            .is_err(),
        "Evidence links must not cross Session boundaries"
    );

    service
        .database()
        .connection()
        .execute(
            "INSERT INTO attachments (
                id, session_id, entry_id, filename, mime_type, size_bytes, sha256, relative_path, created_at
            ) VALUES ('attachment-1', ?1, NULL, 'screenshot.png', 'image/png', 10, 'abc', 'first/attachment-1.png', '2026-06-22T00:00:00.000Z')",
            [&entry.session_id],
        )
        .expect("attachment fixture should insert");

    let same_session_finding = service
        .create_finding(FindingDraft {
            session_id: second.id,
            title: "Attachment cross-session risk".to_string(),
            body: "Should not link to another Session attachment.".to_string(),
            kind: FindingKind::Risk,
            metadata_json: None,
        })
        .expect("finding should be created");

    assert!(
        service
            .create_evidence_link(EvidenceLinkDraft {
                finding_id: same_session_finding.id,
                entry_id: None,
                attachment_id: Some("attachment-1".to_string()),
            })
            .is_err(),
        "Evidence links must not reference attachments from another Session"
    );
}

fn count_rows(connection: &rusqlite::Connection, table: &str) -> i64 {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    connection
        .query_row(&sql, [], |row| row.get(0))
        .expect("count query should succeed")
}

fn assert_no_foreign_key_violations(connection: &rusqlite::Connection) {
    let mut statement = connection
        .prepare("PRAGMA foreign_key_check")
        .expect("foreign key check should prepare");
    let mut rows = statement.query([]).expect("foreign key check should run");
    assert!(
        rows.next()
            .expect("foreign key check row should be readable")
            .is_none(),
        "database should not have foreign key violations"
    );
}

fn unique_temp_dir() -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("qa-scribe-test-{nanos}"))
}
