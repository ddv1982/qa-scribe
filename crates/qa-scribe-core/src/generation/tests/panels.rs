//! Panels outside the editor: the sanitiser keeps one validated kind, Ask AI's Notes projection
//! writes the GitHub alert the parser reads back, and Generate's plain text names the kind.
use super::super::{
    project_html_to_prompt_markdown as project_markdown, project_html_to_prompt_text,
    sanitize_generated_rich_html,
};

const KINDS: [(&str, &str, &str); 5] = [
    ("note", "NOTE", "Note"),
    ("info", "IMPORTANT", "Info"),
    ("success", "TIP", "Success"),
    ("warning", "WARNING", "Warning"),
    ("error", "CAUTION", "Error"),
];

#[test]
fn the_sanitiser_keeps_only_a_known_panel_kind() {
    assert_eq!(
        sanitize_generated_rich_html(
            r#"<aside data-panel="warning" class="x" onclick="alert(1)" role="note"><p>A</p></aside>"#
        ),
        r#"<aside data-panel="warning"><p>A</p></aside>"#
    );
    for tag in [
        r#"<aside data-panel="evil">"#,
        r#"<aside data-panel="WARNING">"#,
        "<aside>",
    ] {
        assert_eq!(
            sanitize_generated_rich_html(&format!("{tag}<p>A</p></aside>")),
            r#"<aside data-panel="note"><p>A</p></aside>"#,
            "{tag}"
        );
    }
}

#[test]
fn every_panel_kind_projects_as_its_alert_and_parses_back() {
    for (kind, alert, _) in KINDS {
        let html = format!(
            r#"<aside data-panel="{kind}"><p>Check <strong>it</strong>.</p><ul><li><p>Retry</p></li></ul></aside>"#
        );
        let markdown = project_markdown(&html);
        assert_eq!(
            markdown,
            format!("> [!{alert}]\n> Check **it**.\n>\n> - Retry")
        );
        let nodes = crate::chat::markdown::parse_with_images(&markdown, &[]).unwrap();
        assert_eq!(crate::chat::markdown::to_html(&nodes), html);
    }
}

#[test]
fn an_empty_panel_projects_as_its_alert_line_alone() {
    assert_eq!(
        project_markdown(r#"<p>A</p><aside data-panel="error"><p></p></aside><p>B</p>"#),
        "A\n\n> [!CAUTION]\n\nB"
    );
}

#[test]
fn a_quote_starting_with_alert_text_stays_a_quote() {
    let markdown = project_markdown("<blockquote><p>[!WARNING]</p><p>Text</p></blockquote>");
    let nodes = crate::chat::markdown::parse_with_images(&markdown, &[]).unwrap();
    assert_eq!(nodes[0]["type"], "blockquote", "{markdown}");
}

#[test]
fn generate_names_the_panel_kind_on_its_own_line() {
    for (kind, _, label) in KINDS {
        assert_eq!(
            project_html_to_prompt_text(&format!(
                r#"<p>Before</p><aside data-panel="{kind}"><p>Inside</p></aside><p>After</p>"#
            )),
            format!("Before\n{label}:\nInside\nAfter")
        );
    }
}
