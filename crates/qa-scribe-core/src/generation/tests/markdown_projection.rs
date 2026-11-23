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
        "***both*** bad [good](https://e.com) [data URL omitted]"
    );
}

#[test]
fn legacy_html_with_loose_text_becomes_paragraphs() {
    assert_eq!(
        project("Intro text\n<div>Block</div>\n<p>  Spaced   words </p>"),
        "Intro text\n\nBlock\n\nSpaced words"
    );
}
