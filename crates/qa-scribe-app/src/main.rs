use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

use qa_scribe_core::{
    attachments::{
        attachment_preview_data_url, delete_session_with_attachment_files,
        import_managed_attachment, reconcile_attachment_files,
    },
    domain::{
        DraftCreate, DraftKind, EntryDraft, EntryType, FindingDraft, FindingKind, SessionDraft,
    },
    export::{ExportFormat, export_session},
    services::SessionService,
};

fn main() {
    run_smoke().expect("qa-scribe smoke should pass");
}

fn run_smoke() -> qa_scribe_core::Result<()> {
    let status = qa_scribe_core::app_status();
    let json = serde_json::to_string_pretty(&status).expect("status should serialize");
    println!("{json}");

    let service = SessionService::in_memory()?;
    let temp_dir = std::env::temp_dir().join(format!(
        "qa-scribe-smoke-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos()
    ));
    fs::create_dir_all(&temp_dir)?;

    let session = service.create_session(SessionDraft {
        title: "Smoke checkout note".to_string(),
        ..SessionDraft::default()
    })?;
    let entry = service.create_entry(EntryDraft {
        session_id: session.id.clone(),
        entry_type: EntryType::Note,
        title: Some("Smoke note body".to_string()),
        body: "<p>Checkout shows a network error after payment.</p>".to_string(),
        metadata_json: None,
        excluded_from_generation: false,
    })?;

    let source_path = temp_dir.join("checkout-log.txt");
    fs::write(&source_path, "POST /checkout 500")?;
    let attachment = import_managed_attachment(
        &service,
        &temp_dir,
        &session.id,
        Some(entry.id),
        &source_path,
    )?;
    attachment_preview_data_url(&service, &temp_dir, &attachment.id)?
        .expect("attachment preview should exist");

    service.create_draft(DraftCreate {
        session_id: session.id.clone(),
        ai_run_id: None,
        kind: DraftKind::Testware,
        title: "Checkout regression cases".to_string(),
        body: "<ol><li>Submit payment and verify confirmation.</li></ol>".to_string(),
    })?;
    service.create_finding(FindingDraft {
        session_id: session.id.clone(),
        title: "Checkout returns 500".to_string(),
        body: "<p>Payment submission fails with a server error.</p>".to_string(),
        kind: FindingKind::Bug,
        metadata_json: None,
    })?;

    service.create_generation_context(&session.id)?;
    let markdown = export_session(&service, &session.id, ExportFormat::Markdown)?;
    assert!(markdown.body.contains("Checkout returns 500"));
    assert!(markdown.body.contains("checkout-log.txt"));
    let report = reconcile_attachment_files(&service, &temp_dir)?;
    assert!(report.missing_files.is_empty());
    assert!(report.stray_files.is_empty());

    delete_session_with_attachment_files(&service, &temp_dir, &session.id)?;
    assert!(service.get_session(&session.id)?.is_none());
    fs::remove_dir_all(temp_dir)?;
    Ok(())
}
