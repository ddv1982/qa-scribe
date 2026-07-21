use super::*;

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
fn summary_response_leaves_ambiguous_duplicate_filename_images_unrestored() {
    // Two attachments share a filename (e.g. re-uploaded screenshots both
    // named "screenshot.png"). If the AI response echoes back the bare
    // filename instead of the full managed markup with `data-attachment-id`,
    // there is no reliable way to know which attachment it meant, so neither
    // should be guessed at: rewriting both references to the first attachment
    // iterated would silently attribute attachment-2's evidence to
    // attachment-1's id.
    let first = test_attachment("attachment-1", Some("entry-selected"), "screenshot.png");
    let second = test_attachment("attachment-2", Some("entry-selected"), "screenshot.png");
    let original = "<p>Original evidence.</p>";
    let response = "<h2>Summary</h2><img src=\"screenshot.png\" alt=\"Ambiguous\" />";

    let preserved = preserve_managed_attachment_images(response, original, &[first, second]);

    assert!(
        !preserved.contains("qa-scribe-attachment://"),
        "an ambiguous bare filename must not be rewritten to either attachment's id, got: {preserved}"
    );
    assert!(preserved.contains("src=\"screenshot.png\""));
}

#[test]
fn summary_response_does_not_treat_variant_or_ambiguous_paths_as_managed_evidence() {
    let first = test_attachment("attachment-1", Some("entry-selected"), "screenshot.png");
    let second = test_attachment("attachment-2", Some("entry-selected"), "screenshot.png");
    let original = r#"<img src="qa-scribe-attachment://attachment-2" data-attachment-id="attachment-2" alt="Evidence" />"#;
    let response = r#"<IMG SRC = "screenshot.png" alt="Ambiguous" />"#;

    let preserved = preserve_managed_attachment_images(response, original, &[first, second]);

    assert!(preserved.contains("src=\"screenshot.png\""));
    assert!(preserved.contains("data-attachment-id=\"attachment-2\""));
    assert!(!preserved.contains("data-attachment-id=\"attachment-1\""));
    assert_eq!(preserved.matches("<img").count(), 2);
}

#[test]
fn summary_response_does_not_rewrite_non_source_attributes_as_evidence() {
    let attachment = test_attachment("attachment-1", Some("entry-selected"), "evidence.png");
    let original = r#"<img src="qa-scribe-attachment://attachment-1" data-attachment-id="attachment-1" alt="Evidence" />"#;
    let response = r#"<img data-src="evidence.png" alt="Lazy provider image" />"#;

    let preserved =
        preserve_managed_attachment_images(response, original, std::slice::from_ref(&attachment));

    assert!(!preserved.contains("data-src"));
    assert_eq!(
        preserved
            .matches("data-attachment-id=\"attachment-1\"")
            .count(),
        1
    );
    assert_eq!(preserved.matches("<img").count(), 1);
}

#[test]
fn summary_response_does_not_attribute_ambiguous_original_filenames() {
    let first = test_attachment("attachment-1", Some("entry-selected"), "screenshot.png");
    let second = test_attachment("attachment-2", Some("entry-selected"), "screenshot.png");
    let original = r#"<img src="screenshot.png" alt="Ambiguous original" />"#;

    let preserved =
        preserve_managed_attachment_images("<p>Summary.</p>", original, &[first, second]);

    assert!(!preserved.contains("qa-scribe-attachment://"));
    assert!(!preserved.contains("data-attachment-id"));
}

#[test]
fn summary_response_restores_only_cross_field_unique_attachment_sources() {
    let mut first = test_attachment("attachment-1", Some("entry-selected"), "first.png");
    first.relative_path = "shared.png".to_string();
    let second = test_attachment("attachment-2", Some("entry-selected"), "shared.png");
    let original = r#"<img src="qa-scribe-attachment://attachment-1" data-attachment-id="attachment-1" alt="Evidence" />"#;

    let preserved = preserve_managed_attachment_images(
        r#"<img src="shared.png" alt="Ambiguous provider path" />"#,
        original,
        &[first, second],
    );

    assert!(preserved.contains("src=\"shared.png\""));
    assert_eq!(
        preserved
            .matches("data-attachment-id=\"attachment-1\"")
            .count(),
        1
    );
    assert!(!preserved.contains("data-attachment-id=\"attachment-2\""));
    assert_eq!(preserved.matches("<img").count(), 2);
}

#[test]
fn summary_response_does_not_rewrite_source_like_text() {
    let attachment = test_attachment("attachment-1", Some("entry-selected"), "evidence.png");
    let response = r#"<p>Literal src="evidence.png" text.</p>"#;

    let preserved =
        preserve_managed_attachment_images(response, "", std::slice::from_ref(&attachment));

    assert_eq!(preserved, response);
}

#[test]
fn summary_response_restores_a_unique_filename_even_when_other_attachments_share_a_different_filename()
 {
    let unique = test_attachment("attachment-1", Some("entry-selected"), "unique.png");
    let other_a = test_attachment("attachment-2", Some("entry-selected"), "shared.png");
    let other_b = test_attachment("attachment-3", Some("entry-selected"), "shared.png");
    let original = "<p>Original evidence.</p>";
    let response = "<h2>Summary</h2><img src=\"unique.png\" alt=\"Unique\" />";

    let preserved =
        preserve_managed_attachment_images(response, original, &[unique, other_a, other_b]);

    assert!(preserved.contains("src=\"qa-scribe-attachment://attachment-1\""));
    assert!(preserved.contains("data-attachment-id=\"attachment-1\""));
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
fn summary_response_preserves_quoted_tag_delimiters_in_image_attributes() {
    let original =
        r#"<p>Evidence.</p><img src="https://example.com/comparison.png" alt="Before > after" />"#;

    let preserved = preserve_managed_attachment_images("<p>Summary.</p>", original, &[]);

    assert!(preserved.contains("src=\"https://example.com/comparison.png\""));
    assert!(preserved.contains("alt=\"Before &gt; after\""));
    assert_eq!(preserved.matches("<img").count(), 1);
}

#[test]
fn summary_response_deduplicates_only_exact_managed_img_identities() {
    let attachment = test_attachment("attachment-1", Some("entry-selected"), "evidence.png");
    let original = r#"<p>Evidence.</p><img src="qa-scribe-attachment://attachment-1" data-attachment-id="attachment-1" alt="Evidence" />"#;

    for (response, expected_image_count) in [
        (
            r#"<p>Mentions qa-scribe-attachment://attachment-1 in text.</p>"#,
            1,
        ),
        (
            r#"<a href="qa-scribe-attachment://attachment-1">Evidence link</a>"#,
            1,
        ),
        (
            r#"<p data-attachment-id="attachment-1">Removed attribute</p>"#,
            1,
        ),
        (
            r#"<img src="qa-scribe-attachment://attachment-10" data-attachment-id="attachment-10" alt="Different image" />"#,
            2,
        ),
    ] {
        let preserved = preserve_managed_attachment_images(
            response,
            original,
            std::slice::from_ref(&attachment),
        );
        assert!(
            preserved.contains("data-attachment-id=\"attachment-1\""),
            "missing exact Evidence image for {response:?}: {preserved:?}"
        );
        assert_eq!(
            preserved.matches("<img").count(),
            expected_image_count,
            "unexpected exact Evidence identity count for {response:?}: {preserved:?}"
        );
    }

    let exact = preserve_managed_attachment_images(
        r#"<p>Summary.</p><img src="qa-scribe-attachment://attachment-1" data-attachment-id="attachment-1" alt="Updated" />"#,
        original,
        &[attachment],
    );
    assert_eq!(
        exact
            .match_indices("data-attachment-id=\"attachment-1\"")
            .count(),
        1
    );
    assert_eq!(exact.matches("<img").count(), 1);
}

#[test]
fn summary_response_deduplicates_only_exact_external_img_sources() {
    let source = "https://example.com/evidence.png";
    let original = format!(r#"<p>Evidence.</p><img src="{source}" alt="Evidence" />"#);

    for response in [
        format!("<p>Mentions {source} in text.</p>"),
        format!(r#"<a href="{source}">Evidence link</a>"#),
        format!(r#"<p data-source="{source}">Removed attribute</p>"#),
        format!(r#"<img src="{source}.backup" alt="Different image" />"#),
    ] {
        let preserved = preserve_managed_attachment_images(&response, &original, &[]);
        assert!(
            preserved.contains(&format!("src=\"{source}\"")),
            "missing exact external Evidence image for {response:?}: {preserved:?}"
        );
    }

    let exact = preserve_managed_attachment_images(
        &format!(r#"<p>Summary.</p><img src="{source}" alt="Updated" />"#),
        &original,
        &[],
    );
    assert_eq!(exact.matches("<img").count(), 1);
}

#[test]
fn summary_response_ignores_img_prefixes_and_comments_when_deduplicating() {
    let source = "https://example.com/evidence.png";
    let original = format!(r#"<img src="{source}" alt="Evidence" />"#);

    for response in [
        format!(r#"<image src="{source}">Not an img tag</image>"#),
        format!(r#"<img-placeholder src="{source}"></img-placeholder>"#),
        format!(r#"<!-- <img src="{source}" alt="Comment only" /> -->"#),
    ] {
        let preserved = preserve_managed_attachment_images(&response, &original, &[]);
        assert_eq!(
            preserved.matches(&format!("src=\"{source}\"")).count(),
            1,
            "the original image should be restored for {response:?}: {preserved:?}"
        );
        assert!(preserved.contains(&format!("<p><img src=\"{source}\" alt=\"Evidence\" /></p>")));
        assert_eq!(preserved.matches("<p><img src=").count(), 1);
    }
}

#[test]
fn summary_response_does_not_deduplicate_images_removed_by_sanitization() {
    let attachment = test_attachment("attachment-1", Some("entry-selected"), "evidence.png");
    let original = r#"<img src="qa-scribe-attachment://attachment-1" data-attachment-id="attachment-1" alt="Evidence" />"#;
    let response = r#"<script><img src="qa-scribe-attachment://attachment-1" data-attachment-id="attachment-1" /></script>"#;

    let preserved =
        preserve_managed_attachment_images(response, original, std::slice::from_ref(&attachment));

    assert!(!preserved.contains("script"));
    assert_eq!(
        preserved
            .matches("data-attachment-id=\"attachment-1\"")
            .count(),
        1
    );
    assert_eq!(preserved.matches("<img").count(), 1);
}

#[test]
fn summary_response_recovers_after_non_ascii_and_malformed_image_prefixes() {
    let first_source = "https://example.com/first.png";
    let second_source = "https://example.com/second.png";
    let original = format!(
        "<\u{1F600}><img src=\"{first_source}\" alt=\"First\" />\
         <img alt=\"unterminated <img src=\"{second_source}\" alt=\"Second\" />"
    );

    let preserved = preserve_managed_attachment_images("<p>Summary.</p>", &original, &[]);

    assert!(preserved.contains(&format!("src=\"{first_source}\"")));
    assert!(preserved.contains(&format!("src=\"{second_source}\"")));
    assert_eq!(preserved.matches("<img").count(), 2);
}
