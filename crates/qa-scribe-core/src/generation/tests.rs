use crate::domain::{AppSettings, EntryType};

use super::test_support::{test_attachment, test_entry};
use super::*;

#[test]
fn projection_turns_editor_html_into_prompt_text() {
    let html = r#"
            <h2>Checkout &amp; payment</h2>
            <p>Login <strong>works</strong> with <a href="https://example.test/login">email</a>.</p>
            <ul>
              <li><input type="checkbox" checked /> Add item</li>
              <li><input type="checkbox" /> PayPal regression</li>
            </ul>
            <img src="data:image/png;base64,AAAAAAAAAAAA" alt="inline error.png" />
            <script>alert("ignore me")</script>
        "#;

    let text = project_html_to_prompt_text(html);

    assert!(text.contains("Checkout & payment"));
    assert!(text.contains("Login works with email (https://example.test/login)."));
    assert!(text.contains("- [x] Add item"));
    assert!(text.contains("- [ ] PayPal regression"));
    assert!(text.contains("[Image: inline error.png]"));
    assert!(!text.contains("<strong>"));
    assert!(!text.contains("data:image"));
    assert!(!text.contains("alert"));
}

#[test]
fn projection_preserves_tiptap_task_list_state() {
    let html = r#"
            <ul data-type="taskList">
              <li data-type="taskItem" data-checked="true">
                <input type="checkbox" checked />
                <p>Sign in to Gmail</p>
              </li>
              <li data-type="taskItem" data-checked="false">
                <input type="checkbox" />
                <p>Confirm the error message</p>
              </li>
            </ul>
        "#;

    let text = project_html_to_prompt_text(html);

    assert!(text.contains("- [x] Sign in to Gmail"));
    assert!(text.contains("- [ ] Confirm the error message"));
}

#[test]
fn managed_attachment_ids_accept_tiptap_image_markup() {
    let html = r#"
            <p>Evidence:</p>
            <img alt="gmail-error.png" data-attachment-id="attachment-1" src="qa-scribe-attachment://attachment-1" />
            <img alt="console.png" src="qa-scribe-attachment://attachment-2" />
        "#;

    let ids = managed_attachment_ids_from_html(html);

    assert_eq!(
        ids,
        vec!["attachment-1".to_string(), "attachment-2".to_string()]
    );
}

#[test]
fn finding_prompt_is_note_local_html_and_compact() {
    let selected = test_entry(
        "entry-selected",
        EntryType::Note,
        Some("Selected note"),
        "<h2>Selected</h2><p>Guest checkout failed.</p><img src=\"data:image/png;base64,AAAA\" />",
    );
    let attachment = test_attachment("attachment-1", Some("entry-support"), "console.png");

    let prompt = render_action_prompt(
        &AppSettings::default(),
        "Checkout regression",
        Some(&selected),
        &[attachment],
        ActionPromptKind::Finding,
    );

    assert_eq!(prompt.matches("Guest checkout failed.").count(), 1);
    assert!(prompt.contains("clean HTML fragment"));
    assert!(prompt.contains("selected note only"));
    assert!(prompt.contains("Create exactly one focused QA finding"));
    assert!(prompt.contains("Do not create test scenarios, test cases"));
    assert!(prompt.contains("Do not escape tags as &lt;p&gt;"));
    assert!(!prompt.contains("console.png"));
    assert!(!prompt.contains("sha256"));
    assert!(!prompt.contains("<h2>"));
    assert!(!prompt.contains("data:image"));
}

#[test]
fn finding_prompt_includes_selected_note_managed_image_refs() {
    let selected = test_entry(
        "entry-selected",
        EntryType::Note,
        Some("Selected note"),
        "<p>Gmail failed.</p><img src=\"qa-scribe-attachment://attachment-1\" data-attachment-id=\"attachment-1\" alt=\"gmail-error.png\" />",
    );
    let selected_attachment =
        test_attachment("attachment-1", Some("entry-selected"), "gmail-error.png");
    let supporting_attachment =
        test_attachment("attachment-2", Some("entry-support"), "console.png");

    let prompt = render_action_prompt(
        &AppSettings::default(),
        "Gmail issue",
        Some(&selected),
        &[selected_attachment, supporting_attachment],
        ActionPromptKind::Finding,
    );

    assert!(prompt.contains("Use only h2, h3, p, ul, ol, li, strong, em, a, and img."));
    assert!(prompt.contains("Preserve managed image placeholders"));
    assert!(prompt.contains("# Managed Images"));
    assert!(prompt.contains("qa-scribe-attachment://attachment-1"));
    assert!(prompt.contains("data-attachment-id=\"attachment-1\""));
    assert!(prompt.contains("gmail-error.png"));
    assert!(!prompt.contains("attachment-2"));
    assert!(!prompt.contains("console.png"));
}

#[test]
fn testware_prompt_is_note_local_html_and_compact() {
    let selected = test_entry(
        "entry-selected",
        EntryType::Note,
        Some("Selected note"),
        "<p>Checkout fails after applying coupon.</p>",
    );
    let attachment = test_attachment("attachment-1", Some("entry-support"), "console.png");

    let prompt = render_action_prompt(
        &AppSettings::default(),
        "Checkout regression",
        Some(&selected),
        &[attachment],
        ActionPromptKind::Testware,
    );

    assert!(prompt.contains("Create test scenarios with test cases"));
    assert!(prompt.contains("Do not create a bug finding"));
    assert!(prompt.contains("clean HTML fragment"));
    assert!(prompt.contains("Preserve managed image placeholders"));
    assert!(prompt.contains("Do not escape tags as &lt;p&gt;"));
    assert_eq!(
        prompt
            .matches("Checkout fails after applying coupon.")
            .count(),
        1
    );
    assert!(!prompt.contains("Session Report Draft"));
    assert!(!prompt.contains("Finding Draft"));
    assert!(prompt.contains("Checkout fails after applying coupon."));
    assert!(!prompt.contains("console.png"));
    assert!(!prompt.contains("sha256"));
    assert!(prompt.len() < 18_000);
}

#[test]
fn testware_prompt_includes_selected_note_managed_image_refs() {
    let selected = test_entry(
        "entry-selected",
        EntryType::Note,
        Some("Selected note"),
        "<p>Gmail failed.</p><img src=\"qa-scribe-attachment://attachment-1\" data-attachment-id=\"attachment-1\" alt=\"gmail-error.png\" />",
    );
    let selected_attachment =
        test_attachment("attachment-1", Some("entry-selected"), "gmail-error.png");
    let supporting_attachment =
        test_attachment("attachment-2", Some("entry-support"), "console.png");

    let prompt = render_action_prompt(
        &AppSettings::default(),
        "Gmail issue",
        Some(&selected),
        &[selected_attachment, supporting_attachment],
        ActionPromptKind::Testware,
    );

    assert!(prompt.contains("Use only h2, h3, p, ul, ol, li, strong, em, a, img"));
    assert!(prompt.contains("# Managed Images"));
    assert!(prompt.contains("qa-scribe-attachment://attachment-1"));
    assert!(prompt.contains("data-attachment-id=\"attachment-1\""));
    assert!(prompt.contains("gmail-error.png"));
    assert!(!prompt.contains("attachment-2"));
    assert!(!prompt.contains("console.png"));
}

#[test]
fn action_prompt_reports_material_truncation() {
    let selected = test_entry(
        "entry-selected",
        EntryType::Note,
        Some("Selected note"),
        &"a ".repeat(30_000),
    );

    let prompt = render_action_prompt(
        &AppSettings::default(),
        "Large note",
        Some(&selected),
        &[],
        ActionPromptKind::Summary,
    );

    assert!(prompt.contains("[Truncated for prompt budget.]"));
    assert!(prompt.contains("selected note: truncated"));
    assert!(prompt.len() < 25_000);
}

#[test]
fn summary_prompt_is_note_local_and_uses_compact_managed_image_refs() {
    let selected = test_entry(
        "entry-selected",
        EntryType::Note,
        Some("Selected note"),
        "<p>Gmail failed.</p><img src=\"qa-scribe-attachment://attachment-1\" data-attachment-id=\"attachment-1\" alt=\"gmail-error.png\" />",
    );
    let attachment = test_attachment("attachment-1", Some("entry-selected"), "gmail-error.png");

    let prompt = render_action_prompt(
        &AppSettings::default(),
        "Gmail issue",
        Some(&selected),
        &[attachment],
        ActionPromptKind::Summary,
    );

    assert!(prompt.contains("Gmail failed."));
    assert!(prompt.contains("qa-scribe-attachment://attachment-1"));
    assert!(prompt.contains("data-attachment-id=\"attachment-1\""));
    assert!(prompt.contains("Do not escape tags as &lt;p&gt;"));
    assert!(prompt.contains("Keep the output as a summarized QA note"));
    assert!(prompt.contains("Do not create findings, test scenarios, test cases"));
    assert!(!prompt.contains("attachments/session/attachment-1_gmail-error.png"));
    assert!(!prompt.contains("sha256"));
}

#[test]
fn default_action_prompts_do_not_inherit_testware_specific_global_instructions() {
    let selected = test_entry(
        "entry-selected",
        EntryType::Note,
        Some("Selected note"),
        "<p>Gmail login fails with Something went wrong.</p>",
    );
    let settings = AppSettings::default();

    for action in [
        ActionPromptKind::Finding,
        ActionPromptKind::Summary,
        ActionPromptKind::Testware,
    ] {
        let prompt = render_action_prompt(&settings, "Gmail issue", Some(&selected), &[], action);

        assert!(!prompt.contains(
            "Turn the selected Session material into concise, evidence-grounded Testware."
        ));
    }
}

#[test]
fn summary_response_restores_attachment_paths_and_missing_managed_images() {
    let attachment = test_attachment("attachment-1", Some("entry-selected"), "gmail-error.png");
    let original = "<p>Original evidence.</p><img src=\"qa-scribe-attachment://attachment-1\" data-attachment-id=\"attachment-1\" alt=\"Gmail screenshot\" />";
    let response = "<h2>Clean summary</h2><img src=\"attachments/session/attachment-1_gmail-error.png\" alt=\"Updated alt\" />";

    let preserved =
        preserve_managed_attachment_images(response, original, std::slice::from_ref(&attachment));

    assert!(preserved.contains("src=\"qa-scribe-attachment://attachment-1\""));
    assert!(preserved.contains("data-attachment-id=\"attachment-1\""));
    assert!(!preserved.contains("src=\"attachments/session/attachment-1_gmail-error.png\""));

    let dropped = preserve_managed_attachment_images(
        "<p>No image here.</p>",
        original,
        std::slice::from_ref(&attachment),
    );

    assert!(dropped.contains("<p>No image here.</p>"));
    assert!(dropped.contains("src=\"qa-scribe-attachment://attachment-1\""));
    assert!(dropped.contains("alt=\"Gmail screenshot\""));

    let broken_original = "<p>Original evidence.</p><img src=\"attachments/session/attachment-1_gmail-error.png\" alt=\"Broken before repair\" />";
    let repaired_from_broken =
        preserve_managed_attachment_images("<p>No image here.</p>", broken_original, &[attachment]);

    assert!(repaired_from_broken.contains("src=\"qa-scribe-attachment://attachment-1\""));
    assert!(repaired_from_broken.contains("alt=\"Broken before repair\""));
}

#[test]
fn summary_response_restores_multiple_mixed_case_external_images_in_order() {
    // Regression test for the preservable_images_from_html O(n^2) scan
    // migration to the shared find_case_insensitive helper: verifies that
    // per-<img>-tag offset arithmetic still finds every image (including
    // mixed-case "<IMG"/"<Img" tags) and preserves all of them, not just the
    // first.
    let original = "<p>Evidence.</p>\
        <IMG src=\"https://example.com/one.png\" alt=\"One\" />\
        <p>More.</p>\
        <img src=\"https://example.com/two.png\" alt=\"Two\" />\
        <Img src=\"https://example.com/three.png\" alt=\"Three\" />";

    let preserved = preserve_managed_attachment_images("<p>Summary only.</p>", original, &[]);

    assert!(preserved.contains("https://example.com/one.png"));
    assert!(preserved.contains("https://example.com/two.png"));
    assert!(preserved.contains("https://example.com/three.png"));
    assert_eq!(preserved.matches("<img").count(), 3);
}

#[test]
fn summary_response_restores_missing_external_images() {
    let original = "<p>Original evidence.</p><img src=\"https://example.com/gmail-error.png\" alt=\"Gmail screenshot\" />";

    let preserved =
        preserve_managed_attachment_images("<p>Summary without image.</p>", original, &[]);

    assert!(preserved.contains("<p>Summary without image.</p>"));
    assert!(preserved.contains("src=\"https://example.com/gmail-error.png\""));
    assert!(preserved.contains("alt=\"Gmail screenshot\""));

    let already_present = preserve_managed_attachment_images(
        "<p>Summary.</p><img src=\"https://example.com/gmail-error.png\" alt=\"Updated\" />",
        original,
        &[],
    );
    assert_eq!(
        already_present
            .match_indices("https://example.com/gmail-error.png")
            .count(),
        1
    );
}

#[test]
fn rich_html_parser_repairs_escaped_editor_fragments() {
    let parsed = parse_rich_html_fragment_response(
        "```html\n&lt;h2&gt;Clean summary&lt;/h2&gt;\n&lt;p&gt;Gmail login failed &amp;amp; showed an error.&lt;/p&gt;\n```",
    );

    assert!(parsed.contains("<h2>Clean summary</h2>"));
    assert!(parsed.contains("<p>Gmail login failed &amp; showed an error.</p>"));
    assert!(!parsed.contains("&lt;p&gt;"));
}

#[test]
fn rich_html_parser_repairs_mixed_literal_and_escaped_fragments() {
    let parsed = parse_rich_html_fragment_response(
        "<h2>Gmail login doesn't work</h2>\nGmail login doesn't work\n&lt;p&gt;Gmail displays an error message.&lt;/p&gt;\n&lt;ol&gt;&lt;li&gt;Go to Gmail.&lt;/li&gt;&lt;/ol&gt;",
    );

    assert!(parsed.contains("<h2>Gmail login doesn't work</h2>"));
    assert!(parsed.contains("<p>Gmail displays an error message.</p>"));
    assert!(parsed.contains("<ol><li>Go to Gmail.</li></ol>"));
    assert!(!parsed.contains("&lt;ol&gt;"));
}

#[test]
fn rich_html_parser_does_not_decode_plain_text_tag_mentions() {
    let parsed = parse_rich_html_fragment_response("Use &lt;p&gt; for paragraph tags in examples.");

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
    );

    assert!(parsed.contains("<p>"));
    assert!(parsed.contains("</p>"));
    assert!(parsed.contains("&nbsp;"));
    assert!(parsed.contains("&mdash;"));
    assert!(parsed.contains("&hellip;"));
    assert!(parsed.contains("&#8217;"));
}

#[test]
fn project_html_to_prompt_text_still_decodes_typographic_entities() {
    // In contrast to the repair path above, projecting stored HTML into
    // plain prompt text for the model should decode as much as possible.
    //
    // Note: this deliberately avoids mixing a decoded multi-byte character
    // (e.g. the curly quote from &#8217;) into the same projected string as
    // an unrelated pre-existing `find_case_insensitive` char-boundary bug in
    // `redact_data_urls`'s "data:" scan (out of scope for this fix; not
    // introduced by it — reproducible on the pre-fix branch too).
    let projected = project_html_to_prompt_text("<p>Caption&nbsp;almost done&hellip;</p>");

    assert!(!projected.contains("&nbsp;"));
    assert!(!projected.contains("&hellip;"));
    assert!(projected.contains("Caption almost done..."));
}

#[test]
fn decode_html_entities_projection_decoder_handles_numeric_curly_quote() {
    // Narrower unit-level check for the numeric curly-quote case, exercising
    // the wide (projection) decoder function directly rather than through
    // the full HTML-to-prompt-text pipeline (which independently calls
    // `redact_data_urls`, hitting the unrelated char-boundary issue noted
    // above whenever the decoded text contains a multi-byte character).
    // `&#8217;` is the numeric reference for U+2019 RIGHT SINGLE QUOTATION
    // MARK ('\u{2019}'), decoded to the literal Unicode character (not
    // folded to an ASCII apostrophe).
    assert_eq!(
        super::html::decode_html_entities("&#8217;great&#8217;"),
        "\u{2019}great\u{2019}"
    );
}

#[test]
fn escaped_summary_response_can_restore_attachment_images() {
    let attachment = test_attachment("attachment-1", Some("entry-selected"), "gmail-error.png");
    let original = "<p>Original evidence.</p><img src=\"qa-scribe-attachment://attachment-1\" data-attachment-id=\"attachment-1\" alt=\"Gmail screenshot\" />";
    let response = "&lt;h2&gt;Clean summary&lt;/h2&gt;&lt;p&gt;Screenshot:&lt;/p&gt;&lt;img src=&quot;attachments/session/attachment-1_gmail-error.png&quot; alt=&quot;Updated alt&quot;&gt;";

    let parsed = parse_rich_html_fragment_response(response);
    let preserved =
        preserve_managed_attachment_images(&parsed, original, std::slice::from_ref(&attachment));

    assert!(preserved.contains("<h2>Clean summary</h2>"));
    assert!(preserved.contains("src=\"qa-scribe-attachment://attachment-1\""));
    assert!(preserved.contains("data-attachment-id=\"attachment-1\""));
    assert!(!preserved.contains("&lt;img"));
    assert!(!preserved.contains("src=\"attachments/session/attachment-1_gmail-error.png\""));
}
