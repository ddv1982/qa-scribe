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

#[path = "tests/completion.rs"]
mod completion;
#[path = "tests/context_and_preferences.rs"]
mod context_and_preferences;
#[path = "tests/summary.rs"]
mod summary;

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
            relative_path: format!("attachments/{}/gmail-error.png", session.id),
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
