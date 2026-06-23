mod html_projection;
mod prompt;
mod response;

pub use html_projection::project_html_to_prompt_text;
pub use prompt::{
    ActionPromptKind, SESSION_REPORT_PROMPT_VERSION, render_action_prompt,
    render_session_report_prompt,
};
pub use response::parse_session_report_response;

#[cfg(test)]
mod tests {
    use crate::domain::{AppSettings, Entry, EntryType, Finding, FindingKind, SessionDraft};
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
    fn action_prompt_projects_html_and_skips_selected_note_duplication() {
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

        let prompt = render_action_prompt(
            &AppSettings::default(),
            "Checkout regression",
            Some(&selected),
            &[selected.clone(), supporting],
            &[],
            &[],
            ActionPromptKind::Finding,
        );

        assert_eq!(prompt.matches("Guest checkout failed.").count(), 1);
        assert!(prompt.contains("Console showed 500."));
        assert!(!prompt.contains("<h2>"));
        assert!(!prompt.contains("data:image"));
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
}
