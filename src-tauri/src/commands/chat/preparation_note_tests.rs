use qa_scribe_core::attachments::chat::resolve_chat_image_source;

use super::preparation_tests::{fixture, request};
use super::*;

#[test]
fn notes_conversation_input_carries_the_saved_note_text() {
    let (state, before, dir) = fixture();
    state
        .with_service(|service| {
            let note = service.get_or_create_note_entry(&before.session_id)?;
            service.update_entry(
                &note.id,
                EntryPatch {
                    body: Some("<h2>Setup</h2><p>Saved note body 4419</p>".into()),
                    ..Default::default()
                },
            )
        })
        .unwrap();
    let jobs = JobStore::default();
    let request = request(&before);
    let (prepared, _, _) = prepare_chat_job_with(
        &state,
        &jobs,
        &request,
        "note-context",
        |snapshot, control| {
            snapshot
                .verify_with(
                    request.provider,
                    || control.is_cancelled(),
                    |source| resolve_chat_image_source(&dir, source),
                )
                .map_err(CommandError::from)
        },
    )
    .unwrap();
    let text =
        serde_json::to_string(&prepared.input.content_blocks(AiProvider::CopilotCli)).unwrap();
    assert!(text.contains("SESSION_NOTE"), "{text}");
    assert!(text.contains("Saved note body 4419"), "{text}");
    assert!(!text.contains("<p>Saved"), "{text}");
    std::fs::remove_dir_all(dir).unwrap();
}
