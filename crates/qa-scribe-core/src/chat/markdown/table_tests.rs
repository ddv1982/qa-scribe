use super::{parse, parse_with_images, to_html};
use serde_json::{Value, json};

fn text(value: &str) -> Value {
    json!({"type":"text","text":value})
}

fn cell(kind: &str, content: Vec<Value>) -> Value {
    json!({"type":kind,"attrs":{"colspan":1,"rowspan":1,"colwidth":null},
        "content":[{"type":"paragraph","content":content}]})
}

fn row(kind: &str, cells: Vec<Vec<Value>>) -> Value {
    let cells: Vec<Value> = cells.into_iter().map(|c| cell(kind, c)).collect();
    json!({"type":"tableRow","content":cells})
}

#[test]
fn a_pipe_table_becomes_a_table_with_a_header_row() {
    let nodes =
        parse("| Field | Value |\n| --- | :-: |\n| **Card** | `4111 \\| 1111` |\n| Note |  |");
    assert_eq!(
        nodes,
        vec![json!({"type":"table","content":[
            row("tableHeader", vec![vec![text("Field")], vec![text("Value")]]),
            row("tableCell", vec![
                vec![json!({"type":"text","text":"Card","marks":[{"type":"bold"}]})],
                vec![json!({"type":"text","text":"4111 | 1111","marks":[{"type":"code"}]})],
            ]),
            row("tableCell", vec![vec![text("Note")], vec![]]),
        ]})]
    );
    assert_eq!(
        to_html(&nodes),
        "<table><tbody><tr><th><p>Field</p></th><th><p>Value</p></th></tr>\
<tr><td><p><strong>Card</strong></p></td><td><p><code>4111 | 1111</code></p></td></tr>\
<tr><td><p>Note</p></td><td><p></p></td></tr></tbody></table>"
    );
}

#[test]
fn a_br_tag_in_a_cell_is_a_line_break_and_an_escaped_pipe_is_text() {
    let nodes = parse("| A |\n| --- |\n| one<br>two \\| three<BR/>four |\n\nkeep <br> here");
    assert_eq!(
        nodes,
        vec![
            json!({"type":"table","content":[
                row("tableHeader", vec![vec![text("A")]]),
                row("tableCell", vec![vec![
                    text("one"), json!({"type":"hardBreak"}), text("two | three"),
                    json!({"type":"hardBreak"}), text("four"),
                ]]),
            ]}),
            json!({"type":"paragraph","content":[text("keep <br> here")]}),
        ]
    );
    assert_eq!(
        to_html(&nodes[..1]),
        "<table><tbody><tr><th><p>A</p></th></tr><tr><td><p>one<br>two | three<br>four</p></td></tr></tbody></table>"
    );
}

#[test]
fn a_short_row_is_padded_and_an_extra_cell_is_dropped() {
    let nodes = parse("| A | B |\n| - | - |\n| 1 |\n| 1 | 2 | 3 |");
    assert_eq!(
        nodes,
        vec![json!({"type":"table","content":[
            row("tableHeader", vec![vec![text("A")], vec![text("B")]]),
            row("tableCell", vec![vec![text("1")], vec![]]),
            row("tableCell", vec![vec![text("1")], vec![text("2")]]),
        ]})]
    );
}

#[test]
fn a_managed_image_in_a_cell_becomes_its_alt_text_since_a_cell_holds_no_image() {
    let image = json!({"type":"image","attrs":{"src":"qa-scribe-attachment://att-1","attachmentId":"att-1","alt":"shot"}});
    let nodes = parse_with_images(
        "| A |\n| - |\n| ![shot](qa-scribe-attachment://att-1) |",
        &[image],
    )
    .unwrap();
    assert_eq!(
        nodes,
        vec![json!({"type":"table","content":[
            row("tableHeader", vec![vec![text("A")]]),
            row("tableCell", vec![vec![text("shot")]]),
        ]})]
    );
}

/// An empty text node is not a valid editor node, so an image without alt text reads as "Image".
#[test]
fn a_managed_image_without_alt_text_in_a_cell_reads_as_image() {
    let image = json!({"type":"image","attrs":{"src":"qa-scribe-attachment://att-1","attachmentId":"att-1","alt":""}});
    let nodes = parse_with_images(
        "| A |\n| - |\n| ![](qa-scribe-attachment://att-1) |",
        &[image],
    )
    .unwrap();
    assert_eq!(
        nodes,
        vec![json!({"type":"table","content":[
            row("tableHeader", vec![vec![text("A")]]),
            row("tableCell", vec![vec![text("Image")]]),
        ]})]
    );
}
