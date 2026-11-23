use super::{parse, to_html};
use serde_json::{Value, json};

fn text(value: &str) -> Value {
    json!({"type":"text","text":value})
}

fn marked(value: &str, mark: &str) -> Value {
    json!({"type":"text","text":value,"marks":[{"type":mark}]})
}

#[test]
fn headings_keep_their_level_from_one_to_six() {
    for level in 1..=6 {
        let nodes = parse(&format!("{} A", "#".repeat(level)));
        assert_eq!(
            nodes,
            vec![json!({"type":"heading","attrs":{"level":level},"content":[text("A")]})]
        );
        assert_eq!(to_html(&nodes), format!("<h{level}>A</h{level}>"));
    }
}

#[test]
fn a_fenced_code_block_keeps_its_newlines_and_drops_its_language() {
    let nodes = parse("```sql\nSELECT 1;\n\n  <b>2</b>\n```");
    assert_eq!(
        nodes,
        vec![
            json!({"type":"codeBlock","attrs":{"language":null},"content":[text("SELECT 1;\n\n  <b>2</b>")]})
        ]
    );
    assert_eq!(
        to_html(&nodes),
        "<pre><code>SELECT 1;\n\n  &lt;b&gt;2&lt;/b&gt;</code></pre>"
    );
}

#[test]
fn an_empty_code_block_has_no_text_node() {
    assert_eq!(
        parse("```\n```"),
        vec![json!({"type":"codeBlock","attrs":{"language":null},"content":[]})]
    );
}

#[test]
fn quotes_and_rules_become_their_own_nodes() {
    let nodes = parse("> First\n>\n> Second\n\n---\n\nAfter");
    assert_eq!(
        nodes,
        vec![
            json!({"type":"blockquote","content":[
                {"type":"paragraph","content":[text("First")]},
                {"type":"paragraph","content":[text("Second")]}
            ]}),
            json!({"type":"horizontalRule"}),
            json!({"type":"paragraph","content":[text("After")]}),
        ]
    );
    assert_eq!(
        to_html(&nodes),
        "<blockquote><p>First</p><p>Second</p></blockquote><hr><p>After</p>"
    );
}

#[test]
fn strike_inline_code_and_underline_become_marks() {
    let nodes = parse("~~old~~ `run()` <u>under</u>");
    assert_eq!(
        nodes,
        vec![json!({"type":"paragraph","content":[
            marked("old", "strike"),
            text(" "),
            marked("run()", "code"),
            text(" "),
            marked("under", "underline"),
        ]})]
    );
    assert_eq!(
        to_html(&nodes),
        "<p><s>old</s> <code>run()</code> <u>under</u></p>"
    );
}

#[test]
fn underline_nests_with_other_marks() {
    let nodes = parse("<U>**bold** plain</U>");
    assert_eq!(
        nodes,
        vec![json!({"type":"paragraph","content":[
            {"type":"text","text":"bold","marks":[{"type":"bold"},{"type":"underline"}]},
            marked(" plain", "underline"),
        ]})]
    );
}

#[test]
fn other_inline_html_and_unclosed_underline_stay_literal_text() {
    assert_eq!(
        parse("<b>bold</b> and <u>open"),
        vec![json!({"type":"paragraph","content":[text("<b>bold</b> and <u>open")]})]
    );
    assert_eq!(
        parse("stray </u> close"),
        vec![json!({"type":"paragraph","content":[text("stray </u> close")]})]
    );
}
