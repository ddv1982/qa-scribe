use super::*;

#[test]
fn output_marker_uses_random_suffixes() {
    let first = OutputMarker::new();
    let second = OutputMarker::new();

    assert!(first.tag_name().starts_with("html_fragment_"));
    assert!(first.tag_name().len() > "html_fragment_".len());
    assert_ne!(
        first.tag_name(),
        second.tag_name(),
        "each generation must get its own marker"
    );
}

#[test]
fn rich_html_parser_extracts_sentinel_wrapped_fragment_and_drops_narration() {
    let parsed = parse_rich_html_fragment_response(
        "I analyzed the note and produced the fragment below.\n\
         <html_fragment_test1234><h2>Finding title</h2><p>Actual result.</p></html_fragment_test1234>\n\
         Let me know if you need anything else!",
        &test_marker(),
    );

    assert_eq!(parsed, "<h2>Finding title</h2><p>Actual result.</p>");
}

#[test]
fn rich_html_parser_nonce_marker_survives_plain_marker_text_in_body() {
    // The random suffix exists only in this generation's prompt, so a note
    // (or narration) that mentions the *generic* marker literally cannot be
    // mistaken for the real extraction boundary.
    let parsed = parse_rich_html_fragment_response(
        "<html_fragment_test1234><h2>Title</h2><p>Notes may mention </html_fragment> literally.</p></html_fragment_test1234>",
        &test_marker(),
    );

    assert_eq!(
        parsed,
        "<h2>Title</h2><p>Notes may mention </html_fragment> literally.</p>"
    );
}

#[test]
fn rich_html_parser_falls_back_to_generic_marker_when_model_drops_the_suffix() {
    let parsed = parse_rich_html_fragment_response(
        "Here it is:\n<html_fragment><h2>Title</h2></html_fragment>",
        &test_marker(),
    );

    assert_eq!(parsed, "<h2>Title</h2>");
}

#[test]
fn rich_html_parser_keeps_content_after_unclosed_sentinel() {
    // A truncated stream can lose the closing marker; the fragment itself
    // must survive.
    let parsed = parse_rich_html_fragment_response(
        "<html_fragment_test1234><h2>Title</h2><p>Body.</p>",
        &test_marker(),
    );

    assert_eq!(parsed, "<h2>Title</h2><p>Body.</p>");
}

#[test]
fn rich_html_parser_strips_fence_inside_sentinel() {
    let parsed = parse_rich_html_fragment_response(
        "<html_fragment_test1234>\n```html\n<h2>Title</h2>\n```\n</html_fragment_test1234>",
        &test_marker(),
    );

    assert_eq!(parsed, "<h2>Title</h2>");
}

#[test]
fn rich_html_parser_extracts_escaped_sentinel_markers() {
    // The model that escapes its HTML is exactly the model the sentinel is
    // guarding against, so the escaped marker form must extract too.
    let parsed = parse_rich_html_fragment_response(
        "Here you go: &lt;html_fragment_test1234&gt;&lt;h2&gt;Title&lt;/h2&gt;&lt;/html_fragment_test1234&gt;",
        &test_marker(),
    );

    assert_eq!(parsed, "<h2>Title</h2>");
}

#[test]
fn rich_html_parser_without_sentinel_keeps_current_behavior() {
    let parsed = parse_rich_html_fragment_response("<h2>Title</h2><p>Body.</p>", &test_marker());

    assert_eq!(parsed, "<h2>Title</h2><p>Body.</p>");
}

#[test]
fn rich_html_parser_repairs_escaped_editor_fragments() {
    let parsed = parse_rich_html_fragment_response(
        "```html\n&lt;h2&gt;Clean summary&lt;/h2&gt;\n&lt;p&gt;Gmail login failed &amp;amp; showed an error.&lt;/p&gt;\n```",
        &test_marker(),
    );

    assert!(parsed.contains("<h2>Clean summary</h2>"));
    assert!(parsed.contains("<p>Gmail login failed &amp; showed an error.</p>"));
    assert!(!parsed.contains("&lt;p&gt;"));
}

#[test]
fn rich_html_parser_repairs_mixed_literal_and_escaped_fragments() {
    let parsed = parse_rich_html_fragment_response(
        "<h2>Gmail login doesn't work</h2>\nGmail login doesn't work\n&lt;p&gt;Gmail displays an error message.&lt;/p&gt;\n&lt;ol&gt;&lt;li&gt;Go to Gmail.&lt;/li&gt;&lt;/ol&gt;",
        &test_marker(),
    );

    assert!(parsed.contains("<h2>Gmail login doesn't work</h2>"));
    assert!(parsed.contains("<p>Gmail displays an error message.</p>"));
    assert!(parsed.contains("<ol><li>Go to Gmail.</li></ol>"));
    assert!(!parsed.contains("&lt;ol&gt;"));
}

#[test]
fn rich_html_parser_does_not_decode_plain_text_tag_mentions() {
    let parsed = parse_rich_html_fragment_response(
        "Use &lt;p&gt; for paragraph tags in examples.",
        &test_marker(),
    );

    assert_eq!(parsed, "Use &lt;p&gt; for paragraph tags in examples.");
}

#[test]
fn rich_html_parser_repair_path_leaves_typographic_entities_literal() {
    // The repair path only undoes the six structural entities an LLM might
    // use to double-escape editor HTML (&lt;, &gt;, &amp;, &quot;, &apos;,
    // &#39;). It must not widen into decoding typographic entities, since
    // that would silently alter stored note content that was never meant to
    // be touched by this repair pass.
    let parsed = parse_rich_html_fragment_response(
        "&lt;p&gt;Caption&nbsp;&mdash; almost done&hellip; she said &#8217;great&#8217;&lt;/p&gt;",
        &test_marker(),
    );

    assert!(parsed.contains("<p>"));
    assert!(parsed.contains("</p>"));
    assert!(parsed.contains("&nbsp;"));
    assert!(parsed.contains("&mdash;"));
    assert!(parsed.contains("&hellip;"));
    assert!(parsed.contains("&#8217;"));
}

#[test]
fn generated_rich_html_drops_malformed_managed_attachment_ids() {
    let sanitized = sanitize_generated_rich_html(
        r#"
        <p>Evidence.</p>
        <img data-attachment-id="attachment-1&quot; onerror=&quot;alert(1)" alt="Injected" />
        <img src="qa-scribe-attachment://attachment-2&quot; onerror=&quot;alert(1)" alt="Injected" />
        "#,
    );

    assert!(sanitized.contains("<p>Evidence.</p>"));
    assert!(!sanitized.contains("onerror"));
    assert!(!sanitized.contains("qa-scribe-attachment://attachment-1"));
    assert!(!sanitized.contains("qa-scribe-attachment://attachment-2"));
    assert!(!sanitized.contains("<img"));
}

#[test]
fn generated_rich_html_uses_valid_managed_src_when_attachment_id_attribute_is_malformed() {
    let sanitized = sanitize_generated_rich_html(
        r#"<img data-attachment-id="bad&quot; onerror=&quot;alert(1)" src="qa-scribe-attachment://attachment-2" alt="Evidence" />"#,
    );

    assert!(sanitized.contains("src=\"qa-scribe-attachment://attachment-2\""));
    assert!(sanitized.contains("data-attachment-id=\"attachment-2\""));
    assert!(!sanitized.contains("onerror"));
}

#[test]
fn project_html_to_prompt_text_still_decodes_typographic_entities() {
    // In contrast to the repair path above, projecting stored HTML into
    // plain prompt text for the model should decode as much as possible,
    // including typographic entities that decode to multi-byte Unicode
    // characters (e.g. the curly quote from &#8217;).
    let projected = project_html_to_prompt_text(
        "<p>Caption&nbsp;almost done&hellip; she said &#8217;great&#8217;</p>",
    );

    assert!(!projected.contains("&nbsp;"));
    assert!(!projected.contains("&hellip;"));
    assert!(!projected.contains("&#8217;"));
    assert!(projected.contains("Caption almost done... she said \u{2019}great\u{2019}"));
}

#[test]
fn decode_html_entities_projection_decoder_handles_numeric_curly_quote() {
    // `&#8217;` is the numeric reference for U+2019 RIGHT SINGLE QUOTATION
    // MARK ('\u{2019}'), decoded to the literal Unicode character (not
    // folded to an ASCII apostrophe). Exercised through the full
    // HTML-to-prompt-text pipeline (which also runs decoded text through
    // `redact_data_urls`'s "data:" scan) to confirm the multi-byte character
    // survives projection end to end, not just the decoder in isolation.
    let projected = project_html_to_prompt_text("<p>&#8217;great&#8217;</p>");

    assert!(projected.contains("\u{2019}great\u{2019}"));
}

#[test]
fn project_html_to_prompt_text_does_not_panic_on_entity_decoded_apostrophe_near_data_scan() {
    // Regression test for the find_case_insensitive char-boundary panic:
    // decoding `&#8217;` (numeric reference for U+2019 RIGHT SINGLE
    // QUOTATION MARK, '\u{2019}') injects a multi-byte character into the
    // projected text, which `redact_data_urls`'s unconditional "data:" scan
    // over that text used to panic on when the multi-byte character
    // overlapped the fixed-width match window. This must complete without
    // panicking and must decode the entity the same way the literal
    // character would project.
    let projected = project_html_to_prompt_text("<p>see data&#8217;s value</p>");
    assert!(projected.contains("see data\u{2019}s value"));
}

#[test]
fn escaped_summary_response_can_restore_attachment_images() {
    let attachment = test_attachment("attachment-1", Some("entry-selected"), "gmail-error.png");
    let original = "<p>Original evidence.</p><img src=\"qa-scribe-attachment://attachment-1\" data-attachment-id=\"attachment-1\" alt=\"Gmail screenshot\" />";
    let response = "&lt;h2&gt;Clean summary&lt;/h2&gt;&lt;p&gt;Screenshot:&lt;/p&gt;&lt;img src=&quot;attachments/session/attachment-1_gmail-error.png&quot; alt=&quot;Updated alt&quot;&gt;";

    let parsed = parse_rich_html_fragment_response(response, &test_marker());
    let preserved =
        preserve_managed_attachment_images(&parsed, original, std::slice::from_ref(&attachment));

    assert!(preserved.contains("<h2>Clean summary</h2>"));
    assert!(preserved.contains("src=\"qa-scribe-attachment://attachment-1\""));
    assert!(preserved.contains("data-attachment-id=\"attachment-1\""));
    assert!(!preserved.contains("&lt;img"));
    assert!(!preserved.contains("src=\"attachments/session/attachment-1_gmail-error.png\""));
}
