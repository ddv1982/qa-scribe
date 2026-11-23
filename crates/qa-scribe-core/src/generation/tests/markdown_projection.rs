use super::super::project_html_to_prompt_markdown as project;

#[test]
fn nested_lists_indent_under_their_item() {
    assert_eq!(
        project(
            "<ul><li><p>Parent</p><ol start=\"3\"><li><p>Third</p></li><li><p>Fourth</p></li></ol></li><li><p>Next</p></li></ul>"
        ),
        "- Parent\n  3. Third\n  4. Fourth\n- Next"
    );
}

#[test]
fn quotes_prefix_every_line_and_keep_paragraphs() {
    assert_eq!(
        project("<blockquote><p>First<br>line</p><p>Second</p></blockquote>"),
        "> First\n> line\n>\n> Second"
    );
}

#[test]
fn a_code_block_keeps_its_text_and_outgrows_a_fence_inside_it() {
    assert_eq!(
        project("<pre><code>a  b\n```\n&lt;tag&gt;</code></pre>"),
        "````\na  b\n```\n<tag>\n````"
    );
}

#[test]
fn only_managed_images_keep_an_image_form() {
    assert_eq!(
        project(
            "<img src=\"qa-scribe-attachment://att-2\" alt=\"Login [error]\"><img src=\"https://example.com/a.png\" alt=\"Remote\"><img src=\"data:image/png;base64,AAAA\">"
        ),
        "![Login (error)](qa-scribe-attachment://att-2)\n\n[Image: Remote]\n\n[Image]"
    );
}

#[test]
fn nested_marks_and_unsafe_links_stay_readable() {
    assert_eq!(
        project(
            "<p><strong><em>both</em></strong> <a href=\"javascript:x\">bad</a> <a href=\"https://e.com\">good</a> data:text/plain;base64,QUJD</p>"
        ),
        "***both*** bad [good](https://e.com) \\[data URL omitted\\]"
    );
}

#[test]
fn legacy_html_with_loose_text_becomes_paragraphs() {
    assert_eq!(
        project("Intro text\n<div>Block</div>\n<p>  Spaced   words </p>"),
        "Intro text\n\nBlock\n\nSpaced words"
    );
}

fn html_text(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// The editor nodes Ask AI gets back when it returns the projected Markdown unchanged.
fn round_trip(html: &str) -> Vec<serde_json::Value> {
    crate::chat::markdown::parse_with_images(&project(html), &[]).unwrap()
}

fn text_line(lines: &[&str]) -> serde_json::Value {
    let mut content = vec![];
    for (index, line) in lines.iter().enumerate() {
        if index > 0 {
            content.push(serde_json::json!({"type":"hardBreak"}));
        }
        content.push(serde_json::json!({"type":"text","text":line}));
    }
    serde_json::json!({"type":"paragraph","content":content})
}

#[test]
fn literal_markdown_in_text_survives_projection_and_parsing() {
    let samples: &[&[&str]] = &[
        &["# not a heading"],
        &["#hashtag and issue #12"],
        &["<u>literal</u> tags and <b>bold</b>"],
        &["*stars* and _underscores_ and snake_case_name"],
        &["`ticks` and ``double``"],
        &["[link](https://example.com) and ![img](x)"],
        &["~~not struck~~ and ~one~"],
        &["- not a list"],
        &["+ plus"],
        &["* star"],
        &["1. not ordered"],
        &["2) paren"],
        &["> not a quote"],
        &["---"],
        &["***"],
        &["___"],
        &["&amp; and &#65; stay entity names"],
        &["back\\slash \\* escaped"],
        &["a | b | c"],
        &["<https://example.com> autolink"],
        &["```"],
        &["~~~"],
        &["Title", "==="],
        &["Title", "---"],
        &["a | b", "--- | ---"],
        &["line", "# heading after a break"],
        &["trailing backslash\\", "next"],
    ];
    for lines in samples {
        let html = lines.iter().map(|line| html_text(line)).collect::<Vec<_>>();
        let expected = text_line(lines);
        for (wrapped, unwrap) in [
            (format!("<p>{}</p>", html.join("<br>")), 0),
            (format!("<ul><li><p>{}</p></li></ul>", html.join("<br>")), 1),
            (format!("<ol><li><p>{}</p></li></ol>", html.join("<br>")), 1),
            (
                format!("<blockquote><p>{}</p></blockquote>", html.join("<br>")),
                2,
            ),
        ] {
            let nodes = round_trip(&wrapped);
            let actual = match unwrap {
                0 => nodes[0].clone(),
                1 => nodes[0]["content"][0]["content"][0].clone(),
                _ => nodes[0]["content"][0].clone(),
            };
            assert_eq!(nodes.len(), 1, "{wrapped} -> {}", project(&wrapped));
            assert_eq!(actual, expected, "{wrapped} -> {}", project(&wrapped));
        }
    }
}

#[test]
fn literal_markdown_in_a_heading_stays_heading_text() {
    for text in ["# inner", "Uses C#", "Closing ##", "<u>x</u> *y*"] {
        let html = format!("<h2>{}</h2>", html_text(text));
        assert_eq!(
            round_trip(&html),
            vec![
                serde_json::json!({"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":text}]})
            ],
            "{html} -> {}",
            project(&html)
        );
    }
}

fn code_text(text: &str) -> serde_json::Value {
    serde_json::json!({"type":"text","text":text,"marks":[{"type":"code"}]})
}

#[test]
fn inline_code_with_backticks_and_edge_spaces_stays_one_code_span() {
    for code in ["a`b", "``x", "`edge`", "a ``` b", "*not bold* <u>x</u> \\"] {
        let html = format!("<p>Run <code>{}</code> now</p>", html_text(code));
        assert_eq!(
            round_trip(&html),
            vec![serde_json::json!({"type":"paragraph","content":[
                {"type":"text","text":"Run "}, code_text(code), {"type":"text","text":" now"},
            ]})],
            "{html} -> {}",
            project(&html)
        );
    }
}

#[test]
fn a_mark_selected_with_surrounding_spaces_keeps_its_mark() {
    for (tag, mark) in [
        ("strong", "bold"),
        ("em", "italic"),
        ("s", "strike"),
        ("u", "underline"),
        ("code", "code"),
    ] {
        let html = format!("<p>Result<{tag}> fail </{tag}>here</p>");
        assert_eq!(
            round_trip(&html),
            vec![serde_json::json!({"type":"paragraph","content":[
                {"type":"text","text":"Result "},
                {"type":"text","text":"fail","marks":[{"type":mark}]},
                {"type":"text","text":" here"},
            ]})],
            "{html} -> {}",
            project(&html)
        );
    }
}

#[test]
fn nested_marks_with_edge_spaces_keep_both_marks() {
    let html = "<p>a<strong><em> both </em></strong>b</p>";
    assert_eq!(
        round_trip(html),
        vec![serde_json::json!({"type":"paragraph","content":[
            {"type":"text","text":"a "},
            {"type":"text","text":"both","marks":[{"type":"bold"},{"type":"italic"}]},
            {"type":"text","text":" b"},
        ]})],
        "{html} -> {}",
        project(html)
    );
}
