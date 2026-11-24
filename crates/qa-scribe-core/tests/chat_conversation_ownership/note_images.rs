//! Images keep their position when Ask AI rewrites the Session Note. The fake reply is the Note
//! Markdown taken from the actual provider prompt, with one line reworded.
use super::*;
use serde_json::{Value, json};

fn image(id: &str, alt: &str) -> Value {
    json!({"type":"image","attrs":{"src":format!("qa-scribe-attachment://{id}"),"alt":alt,"title":null,"width":null,"height":null,"attachmentId":id,"visualSource":null}})
}

fn paragraph(content: Value) -> Value {
    json!({"type":"paragraph","content":content})
}

fn note_with_images(service: &SessionService, session_id: &str) -> Entry {
    let note = service.get_or_create_note_entry(session_id).unwrap();
    let document = json!({"schemaVersion":1,"doc":{"type":"doc","content":[
        paragraph(json!([{"type":"text","text":"Intro","marks":[{"type":"bold"}]}])),
        image("att-a", "first.png"),
        paragraph(json!([{"type":"text","text":"Middle"}])),
        image("att-b", "second.png"),
        paragraph(json!([{"type":"text","text":"End","marks":[{"type":"strike"}]}])),
    ]}});
    service
        .update_entry(
            &note.id,
            EntryPatch {
                body: Some("<p><strong>Intro</strong></p><img data-attachment-id=\"att-a\" src=\"qa-scribe-attachment://att-a\" alt=\"first.png\"><p>Middle</p><img data-attachment-id=\"att-b\" src=\"qa-scribe-attachment://att-b\" alt=\"second.png\"><p><s>End</s></p>".into()),
                body_json: Some(Some(document.to_string())),
                body_format: Some(Some("tiptap_json".into())),
                ..Default::default()
            },
        )
        .unwrap()
}

/// The Note as the provider prompt carries it, after the SESSION_NOTE label.
fn prompt_markdown(note: &Entry) -> String {
    let context = qa_scribe_core::chat::notes_session_context("", &note.body);
    context.split_once('\n').unwrap().1.to_string()
}

fn rewrite(service: &SessionService, session_id: &str, body: &str) -> ChatState {
    notes_turn(
        service,
        session_id,
        json!({"kind":"edit","patch":{"kind":"note","bodyMarkdown":body}}),
    )
}

fn apply(service: &SessionService, session_id: &str, chat: &ChatState) -> Vec<Value> {
    let applied = service
        .apply_note_refinement(ApplyNoteRefinementRequest {
            reference: ChatRef {
                session_id: session_id.into(),
                draft_id: chat.draft_id.clone(),
            },
            proposal_id: chat.proposals[0].id.clone(),
            undo: false,
        })
        .unwrap();
    let document: Value = serde_json::from_str(applied.note.body_json.as_ref().unwrap()).unwrap();
    document["doc"]["content"].as_array().unwrap().clone()
}

#[test]
fn a_note_rewrite_keeps_marks_and_each_image_in_place() {
    let service = SessionService::in_memory().unwrap();
    let session_id = session(&service);
    let note = note_with_images(&service, &session_id);
    let markdown = prompt_markdown(&note);
    assert_eq!(
        markdown,
        "**Intro**\n\n![first.png](qa-scribe-attachment://att-a)\n\nMiddle\n\n![second.png](qa-scribe-attachment://att-b)\n\n~~End~~"
    );
    let chat = rewrite(
        &service,
        &session_id,
        &markdown.replace("Middle", "Middle, reworded"),
    );
    assert_eq!(
        apply(&service, &session_id, &chat),
        vec![
            paragraph(json!([{"type":"text","text":"Intro","marks":[{"type":"bold"}]}])),
            image("att-a", "first.png"),
            paragraph(json!([{"type":"text","text":"Middle, reworded"}])),
            image("att-b", "second.png"),
            paragraph(json!([{"type":"text","text":"End","marks":[{"type":"strike"}]}])),
        ]
    );
}

#[test]
fn a_note_rewrite_appends_only_the_images_it_leaves_out() {
    let service = SessionService::in_memory().unwrap();
    let session_id = session(&service);
    note_with_images(&service, &session_id);
    let chat = rewrite(
        &service,
        &session_id,
        "![second.png](qa-scribe-attachment://att-b)\n\nShorter",
    );
    assert_eq!(
        apply(&service, &session_id, &chat),
        vec![
            image("att-b", "second.png"),
            paragraph(json!([{"type":"text","text":"Shorter"}])),
            image("att-a", "first.png"),
        ]
    );
}

#[test]
fn a_note_rewrite_with_an_unknown_image_id_is_not_offered() {
    let service = SessionService::in_memory().unwrap();
    let session_id = session(&service);
    note_with_images(&service, &session_id);
    let chat = rewrite(
        &service,
        &session_id,
        "![other.png](qa-scribe-attachment://att-x)\n\nText",
    );
    assert!(chat.proposals.is_empty());
    let response = chat.messages.last().unwrap().response.as_ref().unwrap();
    assert!(response.warning.is_some());
}
