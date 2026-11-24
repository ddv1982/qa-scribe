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

#[test]
fn a_managed_image_in_a_checklist_item_stays_in_that_item() {
    let image = json!({"type":"image","attrs":{"src":"qa-scribe-attachment://att-1","alt":"shot.png","attachmentId":"att-1"}});
    let note = "<ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"true\"><label><input type=\"checkbox\" checked></label><div><p>Logged in</p><img src=\"qa-scribe-attachment://att-1\" data-attachment-id=\"att-1\" alt=\"shot.png\"><p>After</p></div></li><li data-type=\"taskItem\" data-checked=\"false\"><label><input type=\"checkbox\"></label><div><p>Next</p></div></li></ul>";
    let markdown = crate::generation::project_html_to_prompt_markdown(note);
    let nodes = super::parse_with_images(&markdown, std::slice::from_ref(&image)).unwrap();
    let paragraph = |value: &str| json!({"type":"paragraph","content":[text(value)]});
    assert_eq!(
        nodes,
        vec![json!({"type":"taskList","content":[
            {"type":"taskItem","attrs":{"checked":true},"content":[paragraph("Logged in"), image, paragraph("After")]},
            {"type":"taskItem","attrs":{"checked":false},"content":[paragraph("Next")]},
        ]})],
        "{markdown}"
    );
}

/// A task item holds only paragraphs and images, so a code block in one keeps its text as lines.
#[test]
fn a_code_block_in_a_checklist_item_keeps_its_text() {
    assert_eq!(
        parse("- [ ] Run\n\n  ```\n  az login\n  az account show\n  ```"),
        vec![json!({"type":"taskList","content":[
            {"type":"taskItem","attrs":{"checked":false},"content":[
                {"type":"paragraph","content":[text("Run")]},
                {"type":"paragraph","content":[text("az login"), {"type":"hardBreak"}, text("az account show")]},
            ]},
        ]})]
    );
}

#[test]
fn a_code_block_in_a_checklist_item_keeps_its_trailing_blank_lines() {
    let nodes = parse("- [ ] Run\n\n  ```\n  az login\n\n  ```");
    assert_eq!(
        nodes[0]["content"][0]["content"][1],
        json!({"type":"paragraph","content":[text("az login"), {"type":"hardBreak"}]})
    );
}

/// Images are blocks, so a managed image in a flattened table row splits the row's paragraph.
#[test]
fn a_managed_image_in_a_table_cell_is_not_nested_in_a_paragraph() {
    let image = json!({"type":"image","attrs":{"src":"qa-scribe-attachment://att-1","alt":"shot.png","attachmentId":"att-1"}});
    let nodes = super::parse_with_images(
        "| Step | Shot |\n| --- | --- |\n| Login | ![shot.png](qa-scribe-attachment://att-1) |",
        std::slice::from_ref(&image),
    )
    .unwrap();
    for block in &nodes {
        for child in block["content"].as_array().into_iter().flatten() {
            assert_ne!(child["type"], "image", "{nodes:?}");
        }
    }
    assert!(nodes.contains(&image), "{nodes:?}");
}

#[test]
fn a_checklist_item_starting_with_an_image_gets_its_leading_paragraph() {
    let image = json!({"type":"image","attrs":{"src":"qa-scribe-attachment://att-1","alt":"shot.png","attachmentId":"att-1"}});
    let nodes = super::parse_with_images(
        "- [ ] ![shot.png](qa-scribe-attachment://att-1)",
        std::slice::from_ref(&image),
    )
    .unwrap();
    assert_eq!(
        nodes,
        vec![json!({"type":"taskList","content":[
            {"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[]}, image]},
        ]})]
    );
}
