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
