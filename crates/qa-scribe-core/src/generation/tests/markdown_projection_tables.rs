//! Tables in the Ask AI Notes projection: what a cell holds reads back as the same cell. Text
//! escapes its own `|`, and the cell escapes every `|` once more, since a GFM parser drops one
//! backslash before each `|` when it splits a row, before inline parsing.
use super::super::project_html_to_prompt_markdown as project;
use serde_json::{Value, json};

fn html_text(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// The inline content of the one body cell after the projection is parsed back.
fn body_cell(cell_html: &str) -> Value {
    let html = format!(
        "<table><tbody><tr><th><p>Head</p></th></tr><tr><td><p>{cell_html}</p></td></tr></tbody></table>"
    );
    let markdown = project(&html);
    let nodes = crate::chat::markdown::parse_with_images(&markdown, &[]).unwrap();
    assert_eq!(nodes.len(), 1, "{html} -> {markdown}");
    assert_eq!(nodes[0]["type"], "table", "{html} -> {markdown}");
    nodes[0]["content"][1]["content"][0]["content"][0]["content"].clone()
}

fn text(value: &str) -> Value {
    json!({"type":"text","text":value})
}

fn code(value: &str) -> Value {
    json!({"type":"text","text":value,"marks":[{"type":"code"}]})
}

#[test]
fn a_literal_pipe_in_a_cell_stays_cell_text() {
    for literal in ["a | b", "end |", "| start", "back\\|slash", "a || b"] {
        assert_eq!(
            body_cell(&html_text(literal)),
            json!([text(literal)]),
            "{literal}"
        );
    }
}

#[test]
fn inline_code_in_a_cell_keeps_its_spaces_and_pipes() {
    for value in ["echo    hello", " fail ", "  x  ", "a | b", " `tick` "] {
        assert_eq!(
            body_cell(&format!("Run<code>{}</code>now", html_text(value))),
            json!([text("Run"), code(value), text("now")]),
            "{value}"
        );
    }
}

#[test]
fn a_link_in_a_cell_keeps_its_destination() {
    for href in [
        "https://example.test/a(b",
        "https://example.test/?q=)",
        "https://example.test/a|b",
        "https://example.test/a)&copy;",
    ] {
        let content = body_cell(&format!("<a href=\"{}\">ticket</a>", html_text(href)));
        assert_eq!(content[0]["text"], "ticket", "{href}: {content}");
        assert_eq!(
            content[0]["marks"][0]["attrs"]["href"], href,
            "{href}: {content}"
        );
    }
}

#[test]
fn code_inside_bold_in_a_cell_keeps_only_its_code_mark() {
    let bold = |value: &str| json!({"type":"text","text":value,"marks":[{"type":"bold"}]});
    assert_eq!(
        body_cell("<strong>Run <code>a | b</code> now</strong>"),
        json!([bold("Run "), code("a | b"), bold(" now")])
    );
}
