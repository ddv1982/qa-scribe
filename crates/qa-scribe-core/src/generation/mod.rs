mod html_projection;
mod prompt;
mod response;

pub use html_projection::project_html_to_prompt_text;
pub use prompt::{
    ActionPromptKind, SESSION_REPORT_PROMPT_VERSION, managed_attachment_ids_from_html,
    render_action_prompt, render_session_report_prompt,
};
pub use response::{
    parse_rich_html_fragment_response, parse_session_report_response,
    preserve_managed_attachment_images,
};

#[cfg(test)]
mod tests {
    use crate::domain::{
        AppSettings, Attachment, Entry, EntryType, Finding, FindingKind, SessionDraft,
    };
    use crate::services::SessionService;

    use super::*;

    #[test]
    fn prompt_includes_session_material_and_terms() {
        let service = SessionService::in_memory().expect("service should open");
        let session = service
            .create_session(SessionDraft {
                title: "Checkout".to_string(),
                session_context: Some("Cart flow".to_string()),
                ..SessionDraft::default()
            })
            .expect("session should create");
        let entry = service
            .create_entry(crate::domain::EntryDraft {
                session_id: session.id.clone(),
                entry_type: EntryType::Observation,
                title: None,
                body: "SAVE10 failed".to_string(),
                metadata_json: None,
                excluded_from_generation: false,
            })
            .expect("entry should create");
        let prompt =
            render_session_report_prompt(&AppSettings::default(), &session, &[entry], &[], &[]);
        assert!(prompt.contains("Session Report Draft"));
        assert!(prompt.contains("SAVE10 failed"));
        assert!(prompt.contains("Evidence"));
    }

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
    fn finding_prompt_is_note_local_html_and_compact() {
        let selected = test_entry(
            "entry-selected",
            EntryType::Note,
            Some("Selected note"),
            "<h2>Selected</h2><p>Guest checkout failed.</p><img src=\"data:image/png;base64,AAAA\" />",
        );
        let supporting = test_entry(
            "entry-support",
            EntryType::Observation,
            Some("Console"),
            "<p>Console showed <code>500</code>.</p>",
        );
        let finding = test_finding("finding-1", "Existing bug", "<p>Previous finding.</p>");
        let attachment = test_attachment("attachment-1", Some("entry-support"), "console.png");

        let prompt = render_action_prompt(
            &AppSettings::default(),
            "Checkout regression",
            Some(&selected),
            &[selected.clone(), supporting],
            &[finding],
            &[attachment],
            ActionPromptKind::Finding,
        );

        assert_eq!(prompt.matches("Guest checkout failed.").count(), 1);
        assert!(prompt.contains("clean HTML fragment"));
        assert!(prompt.contains("selected note only"));
        assert!(prompt.contains("Do not escape tags as &lt;p&gt;"));
        assert!(!prompt.contains("Console showed 500."));
        assert!(!prompt.contains("Previous finding."));
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
            std::slice::from_ref(&selected),
            &[],
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
        let supporting = test_entry(
            "entry-support",
            EntryType::Observation,
            Some("Console"),
            "<p>Console showed <code>500</code>.</p>",
        );
        let finding = test_finding("finding-1", "Existing bug", "<p>Previous finding.</p>");
        let attachment = test_attachment("attachment-1", Some("entry-support"), "console.png");

        let prompt = render_action_prompt(
            &AppSettings::default(),
            "Checkout regression",
            Some(&selected),
            &[selected.clone(), supporting],
            &[finding],
            &[attachment],
            ActionPromptKind::Testware,
        );

        assert!(prompt.contains("5-8"));
        assert!(prompt.contains("clean HTML fragment"));
        assert!(prompt.contains("Do not escape tags as &lt;p&gt;"));
        assert!(prompt.contains("Checkout fails after applying coupon."));
        assert!(!prompt.contains("Console showed 500."));
        assert!(!prompt.contains("Previous finding."));
        assert!(!prompt.contains("console.png"));
        assert!(!prompt.contains("sha256"));
        assert!(prompt.len() < 18_000);
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
            std::slice::from_ref(&selected),
            &[],
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
        let supporting = test_entry(
            "entry-support",
            EntryType::Observation,
            Some("Console"),
            "<p>Console showed <code>500</code>.</p>",
        );
        let finding = test_finding("finding-1", "Known bug", "<p>Existing finding.</p>");
        let attachment = test_attachment("attachment-1", Some("entry-selected"), "gmail-error.png");

        let prompt = render_action_prompt(
            &AppSettings::default(),
            "Gmail issue",
            Some(&selected),
            &[selected.clone(), supporting],
            &[finding],
            &[attachment],
            ActionPromptKind::Summary,
        );

        assert!(prompt.contains("Gmail failed."));
        assert!(prompt.contains("qa-scribe-attachment://attachment-1"));
        assert!(prompt.contains("data-attachment-id=\"attachment-1\""));
        assert!(prompt.contains("Do not escape tags as &lt;p&gt;"));
        assert!(!prompt.contains("Console showed 500."));
        assert!(!prompt.contains("Existing finding."));
        assert!(!prompt.contains("attachments/session/attachment-1_gmail-error.png"));
        assert!(!prompt.contains("sha256"));
    }

    #[test]
    fn summary_response_restores_attachment_paths_and_missing_managed_images() {
        let attachment = test_attachment("attachment-1", Some("entry-selected"), "gmail-error.png");
        let original = "<p>Original evidence.</p><img src=\"qa-scribe-attachment://attachment-1\" data-attachment-id=\"attachment-1\" alt=\"Gmail screenshot\" />";
        let response = "<h2>Clean summary</h2><img src=\"attachments/session/attachment-1_gmail-error.png\" alt=\"Updated alt\" />";

        let preserved = preserve_managed_attachment_images(
            response,
            original,
            std::slice::from_ref(&attachment),
        );

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
        let repaired_from_broken = preserve_managed_attachment_images(
            "<p>No image here.</p>",
            broken_original,
            &[attachment],
        );

        assert!(repaired_from_broken.contains("src=\"qa-scribe-attachment://attachment-1\""));
        assert!(repaired_from_broken.contains("alt=\"Broken before repair\""));
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
        let parsed =
            parse_rich_html_fragment_response("Use &lt;p&gt; for paragraph tags in examples.");

        assert_eq!(parsed, "Use &lt;p&gt; for paragraph tags in examples.");
    }

    #[test]
    fn escaped_summary_response_can_restore_attachment_images() {
        let attachment = test_attachment("attachment-1", Some("entry-selected"), "gmail-error.png");
        let original = "<p>Original evidence.</p><img src=\"qa-scribe-attachment://attachment-1\" data-attachment-id=\"attachment-1\" alt=\"Gmail screenshot\" />";
        let response = "&lt;h2&gt;Clean summary&lt;/h2&gt;&lt;p&gt;Screenshot:&lt;/p&gt;&lt;img src=&quot;attachments/session/attachment-1_gmail-error.png&quot; alt=&quot;Updated alt&quot;&gt;";

        let parsed = parse_rich_html_fragment_response(response);
        let preserved = preserve_managed_attachment_images(
            &parsed,
            original,
            std::slice::from_ref(&attachment),
        );

        assert!(preserved.contains("<h2>Clean summary</h2>"));
        assert!(preserved.contains("src=\"qa-scribe-attachment://attachment-1\""));
        assert!(preserved.contains("data-attachment-id=\"attachment-1\""));
        assert!(!preserved.contains("&lt;img"));
        assert!(!preserved.contains("src=\"attachments/session/attachment-1_gmail-error.png\""));
    }

    #[test]
    fn session_report_prompt_projects_entry_and_finding_bodies() {
        let service = SessionService::in_memory().expect("service should open");
        let session = service
            .create_session(SessionDraft {
                title: "Checkout".to_string(),
                ..SessionDraft::default()
            })
            .expect("session should create");
        let entry = test_entry(
            "entry-html",
            EntryType::Note,
            None,
            "<p>Screenshot attached</p><img src=\"data:image/png;base64,AAAA\" alt=\"gmail-error.png\" />",
        );
        let finding = test_finding(
            "finding-1",
            "Gmail error",
            "<p>Login failed &amp; retried.</p>",
        );

        let prompt = render_session_report_prompt(
            &AppSettings::default(),
            &session,
            &[entry],
            &[finding],
            &[],
        );

        assert!(prompt.contains("Screenshot attached / [Image: gmail-error.png]"));
        assert!(prompt.contains("Login failed & retried."));
        assert!(!prompt.contains("<p>"));
        assert!(!prompt.contains("data:image"));
    }

    #[test]
    fn parser_strips_markdown_fence() {
        assert_eq!(
            parse_session_report_response("```markdown\n# Report\n```"),
            "# Report"
        );
    }

    fn test_entry(id: &str, entry_type: EntryType, title: Option<&str>, body: &str) -> Entry {
        Entry {
            id: id.to_string(),
            session_id: "session-1".to_string(),
            entry_type,
            title: title.map(ToOwned::to_owned),
            body: body.to_string(),
            metadata_json: None,
            excluded_from_generation: false,
            created_at: "2026-06-23T00:00:00Z".to_string(),
            updated_at: "2026-06-23T00:00:00Z".to_string(),
        }
    }

    fn test_finding(id: &str, title: &str, body: &str) -> Finding {
        Finding {
            id: id.to_string(),
            session_id: "session-1".to_string(),
            title: title.to_string(),
            body: body.to_string(),
            kind: FindingKind::Bug,
            metadata_json: None,
            created_at: "2026-06-23T00:00:00Z".to_string(),
            updated_at: "2026-06-23T00:00:00Z".to_string(),
        }
    }

    fn test_attachment(id: &str, entry_id: Option<&str>, filename: &str) -> Attachment {
        Attachment {
            id: id.to_string(),
            session_id: "session-1".to_string(),
            entry_id: entry_id.map(ToOwned::to_owned),
            filename: filename.to_string(),
            mime_type: Some("image/png".to_string()),
            size_bytes: 123,
            sha256: "a".repeat(64),
            relative_path: format!("attachments/session/{id}_{filename}"),
            created_at: "2026-06-23T00:00:00Z".to_string(),
        }
    }
}
