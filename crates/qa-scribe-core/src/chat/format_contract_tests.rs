//! The Rust half of the editor format contract in `shared/editor-format-contract.json`.
//! The frontend half is `frontend/src/editor/formatContract.test.tsx`.
use serde_json::{Value, json};

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../../shared/editor-format-contract.json"
    ))
    .expect("valid format contract fixture")
}

fn text(value: &Value) -> String {
    match value {
        Value::Array(lines) => lines
            .iter()
            .map(|line| line.as_str().expect("line"))
            .collect::<Vec<_>>()
            .join("\n"),
        other => other.as_str().expect("string").to_owned(),
    }
}

#[test]
fn markdown_parses_to_the_golden_document() {
    let fixture = fixture();
    let nodes = super::markdown::parse(&text(&fixture["markdown"]));
    assert_eq!(
        json!({"type":"doc","content":nodes}),
        fixture["parsedDocument"]
    );
}

#[test]
fn parsed_markdown_renders_the_expected_html() {
    let fixture = fixture();
    let nodes = fixture["parsedDocument"]["content"].as_array().unwrap();
    assert_eq!(super::markdown::to_html(nodes), text(&fixture["rustHtml"]));
}

#[test]
fn generation_sanitiser_keeps_every_node_and_strips_attributes() {
    let fixture = fixture();
    assert_eq!(
        crate::generation::sanitize_generated_rich_html(&text(&fixture["dirtyHtml"])),
        text(&fixture["rustSanitizedHtml"])
    );
}

#[test]
fn generate_prompt_projection_is_unchanged() {
    let fixture = fixture();
    assert_eq!(
        crate::generation::project_html_to_prompt_text(&text(&fixture["html"])),
        text(&fixture["generatePromptText"])
    );
}

#[test]
fn result_notes_text_keeps_every_block_on_its_own_line() {
    let fixture = fixture();
    let body = json!({"schemaVersion":1,"doc":fixture["document"]}).to_string();
    let notes = crate::services::session_service::test_run_notes::summarize(body);
    assert_eq!(notes.text, text(&fixture["notesText"]));
    assert_eq!(notes.image_count as u64, fixture["notesImageCount"]);
}

#[test]
fn ask_ai_notes_projection_writes_the_markdown_the_parser_reads_back() {
    let fixture = fixture();
    let markdown = text(&fixture["markdown"]);
    for html in [&fixture["html"], &fixture["rustHtml"]] {
        assert_eq!(
            crate::generation::project_html_to_prompt_markdown(&text(html)),
            markdown
        );
    }
}
