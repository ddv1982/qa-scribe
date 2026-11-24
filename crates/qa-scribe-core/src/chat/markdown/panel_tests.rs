//! Panels read from GitHub alerts: each of the five alert kinds is one panel kind, and anything
//! else stays a quote, its first line literal text.
use super::{parse, to_html};
use serde_json::{Value, json};

fn paragraph(text: &str) -> Value {
    json!({"type":"paragraph","content":[{"type":"text","text":text}]})
}

#[test]
fn each_alert_kind_becomes_its_panel() {
    for (alert, kind) in [
        ("NOTE", "note"),
        ("IMPORTANT", "info"),
        ("TIP", "success"),
        ("WARNING", "warning"),
        ("CAUTION", "error"),
    ] {
        let nodes = parse(&format!("> [!{alert}]\n> Check the receipt."));
        assert_eq!(
            nodes,
            vec![
                json!({"type":"panel","attrs":{"kind":kind},"content":[paragraph("Check the receipt.")]})
            ],
            "{alert}"
        );
        assert_eq!(
            to_html(&nodes),
            format!("<aside data-panel=\"{kind}\"><p>Check the receipt.</p></aside>")
        );
    }
}

#[test]
fn an_alert_keeps_every_block_and_reads_its_kind_in_any_case() {
    let nodes = parse("> [!warning]\n> Card **4111** is declined.\n>\n> - Retry\n\nAfter.");
    assert_eq!(nodes[0]["type"], "panel");
    assert_eq!(nodes[0]["attrs"]["kind"], "warning");
    let children: Vec<&str> = nodes[0]["content"]
        .as_array()
        .unwrap()
        .iter()
        .map(|node| node["type"].as_str().unwrap())
        .collect();
    assert_eq!(children, ["paragraph", "bulletList"]);
    assert_eq!(nodes[1], paragraph("After."));
}

#[test]
fn an_empty_alert_is_a_panel_with_an_empty_paragraph() {
    assert_eq!(
        parse("> [!TIP]"),
        vec![
            json!({"type":"panel","attrs":{"kind":"success"},"content":[{"type":"paragraph","content":[]}]})
        ]
    );
}

#[test]
fn an_unknown_kind_or_text_after_the_marker_stays_a_quote() {
    for markdown in [
        "> [!DANGER]\n> Stop.",
        "> [!NOTE] Stop.",
        "> \\[!NOTE]\n> Stop.",
    ] {
        let nodes = parse(markdown);
        assert_eq!(nodes.len(), 1, "{markdown}");
        assert_eq!(nodes[0]["type"], "blockquote", "{markdown}");
        let text = nodes[0]["content"][0]["content"][0]["text"]
            .as_str()
            .unwrap();
        assert!(text.starts_with("[!"), "{markdown}: {text}");
    }
}

#[test]
fn an_unknown_panel_kind_renders_as_a_note() {
    let nodes = vec![
        json!({"type":"panel","attrs":{"kind":"evil\" onclick=\"x"},"content":[paragraph("A")]}),
    ];
    assert_eq!(
        to_html(&nodes),
        "<aside data-panel=\"note\"><p>A</p></aside>"
    );
}
