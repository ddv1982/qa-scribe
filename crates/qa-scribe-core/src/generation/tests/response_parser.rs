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
fn generated_rich_html_preserves_quoted_delimiters_and_sanitizes_attributes() {
    let sanitized = sanitize_generated_rich_html(
        r#"<h2 onclick="if (a > b) unsafe()">café 比較</h2>
<a href='https://example.test/compare?left=5>3&amp;mode=full' onmouseover='unsafe("x > y")'>Comparison</a>
<img src="qa-scribe-attachment://attachment-1" data-attachment-id="attachment-1" alt="Evidence A > B <script>marker</script>" onerror="unsafe()" />"#,
    );

    assert!(sanitized.contains("<h2>café 比較</h2>"));
    assert!(sanitized.contains(
        "<a href=\"https://example.test/compare?left=5&gt;3&amp;mode=full\" target=\"_blank\" rel=\"noreferrer\">Comparison</a>"
    ));
    assert!(sanitized.contains(
        "<img src=\"qa-scribe-attachment://attachment-1\" data-attachment-id=\"attachment-1\" alt=\"Evidence A &gt; B &lt;script&gt;marker&lt;/script&gt;\" />"
    ));
    assert!(!sanitized.contains("onclick"));
    assert!(!sanitized.contains("onmouseover"));
    assert!(!sanitized.contains("onerror"));
    assert_eq!(sanitized.matches("<img").count(), 1);
}

#[test]
fn generated_rich_html_keeps_existing_url_scheme_allowlist_with_quoted_delimiters() {
    let cases = [
        (
            r#"<a href="https://example.test/a>b">link</a>"#,
            "href=\"https://example.test/a&gt;b\"",
            true,
        ),
        (
            r#"<a href='mailto:qa@example.test?subject=A>B'>link</a>"#,
            "href=\"mailto:qa@example.test?subject=A&gt;B\"",
            true,
        ),
        (
            r#"<a href="/relative/a>b">link</a>"#,
            "href=\"/relative/a&gt;b\"",
            true,
        ),
        (
            r#"<a href="javascript:alert('A>B')">link</a>"#,
            "href=",
            false,
        ),
        (r#"<a href="data:text/html,A>B">link</a>"#, "href=", false),
    ];

    for (input, expected, allowed) in cases {
        let sanitized = sanitize_generated_rich_html(input);
        assert_eq!(
            sanitized.contains(expected),
            allowed,
            "unexpected link sanitization for {input:?}: {sanitized:?}"
        );
        assert!(sanitized.ends_with("link</a>"));
    }

    let images = sanitize_generated_rich_html(
        r#"<img src="https://example.test/a>b.png" alt="https" />
<img src='data:image/png;base64,AA>BB' alt='inline' />
<img src="/relative/a>b.png" alt="relative" />
<img src="javascript:alert('A>B')" alt="unsafe" />
<img src="data:text/html,A>B" alt="unsafe data" />"#,
    );
    assert!(images.contains("src=\"https://example.test/a&gt;b.png\""));
    assert!(images.contains("src=\"data:image/png;base64,AA&gt;BB\""));
    assert!(images.contains("src=\"/relative/a&gt;b.png\""));
    assert!(!images.contains("javascript:"));
    assert!(!images.contains("data:text/html"));
    assert_eq!(images.matches("<img").count(), 3);
}

#[test]
fn generated_rich_html_treats_unclosed_quoted_tag_as_text_and_removes_nested_script() {
    let sanitized = sanitize_generated_rich_html(
        r#"<p>Before</p><img src="https://example.test/evidence.png" alt="unclosed > <script>alert(1)</script><p>After</p>"#,
    );

    assert!(sanitized.starts_with("<p>Before</p>&lt;img"));
    assert!(sanitized.contains("alt=\"unclosed > "));
    assert!(sanitized.contains("<p>After</p>"));
    assert!(!sanitized.contains("<script"));
    assert!(!sanitized.contains("alert(1)"));
}

#[test]
fn generated_rich_html_quote_scanner_handles_payload_matrix_without_attribute_escape() {
    let payloads = [
        "A > B",
        "café > naïve",
        "日本語 > ✅",
        "nested <strong>value</strong> > boundary",
        "&gt; and >",
    ];

    for quote in ['"', '\''] {
        for payload in payloads {
            let input = format!(
                "<img src={quote}https://example.test/evidence.png{quote} alt={quote}{payload}{quote} onerror={quote}unsafe > call{quote}>"
            );
            let sanitized = sanitize_generated_rich_html(&input);

            assert_eq!(sanitized.matches("<img").count(), 1, "input: {input}");
            assert!(!sanitized.contains("onerror"), "input: {input}");
            assert!(!sanitized.contains("unsafe"), "input: {input}");
            assert!(sanitized.ends_with(" />"), "input: {input}");
        }
    }
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
