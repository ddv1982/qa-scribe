use crate::domain::{AppSettings, Attachment, Entry, Finding, Session};

pub const SESSION_REPORT_PROMPT_VERSION: &str = "session-report-v1";

pub fn render_session_report_prompt(
    settings: &AppSettings,
    session: &Session,
    entries: &[Entry],
    findings: &[Finding],
    attachments: &[Attachment],
) -> String {
    let mut prompt = String::new();
    prompt.push_str(&settings.generation_system_prompt);
    prompt.push_str("\n\nCreate a concise Session Report Draft as Markdown. Use qa-scribe terminology: Session, Entry, Evidence, Finding, Testware, Draft. Ground every conclusion in the selected Session material.\n\n");
    prompt.push_str(&format!("# Session\nTitle: {}\n", session.title));
    if let Some(context) = &session.session_context {
        prompt.push_str(&format!("Session Context: {context}\n"));
    }
    if let Some(notes) = &session.objective_notes {
        prompt.push_str(&format!("Objective Notes: {notes}\n"));
    }
    prompt.push_str("\n# Entries\n");
    for entry in entries
        .iter()
        .filter(|entry| !entry.excluded_from_generation)
    {
        prompt.push_str(&format!(
            "- {}: {}\n",
            entry.entry_type.as_str(),
            entry.body
        ));
    }
    prompt.push_str("\n# Findings\n");
    for finding in findings {
        prompt.push_str(&format!("- {}: {}\n", finding.title, finding.body));
    }
    prompt.push_str("\n# Attachments\n");
    for attachment in attachments {
        prompt.push_str(&format!(
            "- {} ({}, sha256: {})\n",
            attachment.filename, attachment.relative_path, attachment.sha256
        ));
    }
    prompt
}

pub fn parse_session_report_response(response: &str) -> String {
    let trimmed = response.trim();
    if let Some(stripped) = trimmed.strip_prefix("```markdown") {
        return stripped.trim_end_matches("```").trim().to_string();
    }
    if let Some(stripped) = trimmed.strip_prefix("```") {
        return stripped.trim_end_matches("```").trim().to_string();
    }
    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use crate::domain::{EntryType, SessionDraft};
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
    fn parser_strips_markdown_fence() {
        assert_eq!(
            parse_session_report_response("```markdown\n# Report\n```"),
            "# Report"
        );
    }
}
