use crate::domain::{AppSettings, Attachment, Entry, Finding, Session};

use super::html_projection::project_html_to_prompt_text;

pub const SESSION_REPORT_PROMPT_VERSION: &str = "session-report-v1";
const SELECTED_NOTE_PROMPT_CHAR_LIMIT: usize = 20_000;
const SUPPORTING_ENTRY_PROMPT_CHAR_LIMIT: usize = 6_000;
const FINDING_PROMPT_CHAR_LIMIT: usize = 4_000;
const TOTAL_PROMPT_MATERIAL_CHAR_LIMIT: usize = 40_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActionPromptKind {
    Testware,
    Finding,
    Summary,
}

pub fn render_session_report_prompt(
    settings: &AppSettings,
    session: &Session,
    entries: &[Entry],
    findings: &[Finding],
    attachments: &[Attachment],
) -> String {
    let mut budget = PromptMaterialBudget::new();
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
        let label = format!("{} entry", entry.entry_type.as_str());
        let body = budget.take(&label, &entry.body, SUPPORTING_ENTRY_PROMPT_CHAR_LIMIT);
        if body.is_empty() {
            continue;
        }
        prompt.push_str(&format!(
            "- {}: {}\n",
            entry.entry_type.as_str(),
            inline_prompt_material(&body)
        ));
    }
    prompt.push_str("\n# Findings\n");
    for finding in findings {
        let body = budget.take(
            &format!("finding {}", finding.title),
            &finding.body,
            FINDING_PROMPT_CHAR_LIMIT,
        );
        if body.is_empty() {
            continue;
        }
        prompt.push_str(&format!(
            "- {}: {}\n",
            finding.title,
            inline_prompt_material(&body)
        ));
    }
    prompt.push_str("\n# Attachments\n");
    for attachment in attachments {
        prompt.push_str(&format!(
            "- {} ({}, sha256: {})\n",
            attachment.filename, attachment.relative_path, attachment.sha256
        ));
    }
    budget.append_omissions(&mut prompt);
    prompt
}

pub fn render_action_prompt(
    settings: &AppSettings,
    session_title: &str,
    note_entry: Option<&Entry>,
    entries: &[Entry],
    findings: &[Finding],
    attachments: &[Attachment],
    action: ActionPromptKind,
) -> String {
    let action_template = match action {
        ActionPromptKind::Testware => &settings.testware_template,
        ActionPromptKind::Finding => &settings.finding_template,
        ActionPromptKind::Summary => &settings.note_summary_template,
    };
    let mut budget = PromptMaterialBudget::new();
    let mut prompt = String::new();
    prompt.push_str(&settings.generation_system_prompt);
    prompt.push_str("\n\n");
    prompt.push_str(action_template);
    prompt.push_str(&format!("\n\n# Note\nTitle: {session_title}\n"));
    match note_entry {
        Some(entry) => {
            let note = budget.take(
                "selected note",
                &entry.body,
                SELECTED_NOTE_PROMPT_CHAR_LIMIT,
            );
            if note.is_empty() {
                prompt.push_str("(No note text available.)\n");
            } else {
                prompt.push_str(&note);
                prompt.push('\n');
            }
        }
        None => prompt.push_str("(No note selected.)\n"),
    }

    let selected_note_id = note_entry.map(|entry| entry.id.as_str());
    prompt.push_str("\n# Supporting Entries\n");
    let mut supporting_count = 0usize;
    for entry in entries
        .iter()
        .filter(|entry| !entry.excluded_from_generation)
        .filter(|entry| Some(entry.id.as_str()) != selected_note_id)
    {
        let body = budget.take(
            &format!("{} entry", entry.entry_type.as_str()),
            &entry.body,
            SUPPORTING_ENTRY_PROMPT_CHAR_LIMIT,
        );
        if body.is_empty() {
            continue;
        }
        supporting_count += 1;
        prompt.push_str(&format!(
            "- {}{}: {}\n",
            entry.entry_type.as_str(),
            entry
                .title
                .as_deref()
                .map(|title| format!(" / {title}"))
                .unwrap_or_default(),
            inline_prompt_material(&body)
        ));
    }
    if supporting_count == 0 {
        prompt.push_str("(No additional entries.)\n");
    }

    prompt.push_str("\n# Existing Findings\n");
    if findings.is_empty() {
        prompt.push_str("(No existing findings.)\n");
    }
    for finding in findings {
        let body = budget.take(
            &format!("finding {}", finding.title),
            &finding.body,
            FINDING_PROMPT_CHAR_LIMIT,
        );
        if body.is_empty() {
            continue;
        }
        prompt.push_str(&format!(
            "- {}: {}\n",
            finding.title,
            inline_prompt_material(&body)
        ));
    }

    prompt.push_str("\n# Attachments\n");
    if attachments.is_empty() {
        prompt.push_str("(No managed attachments.)\n");
    }
    for attachment in attachments {
        prompt.push_str(&format!(
            "- {} ({}, sha256: {})\n",
            attachment.filename, attachment.relative_path, attachment.sha256
        ));
    }

    budget.append_omissions(&mut prompt);
    prompt
}

struct PromptMaterialBudget {
    remaining: usize,
    omissions: Vec<String>,
}

impl PromptMaterialBudget {
    fn new() -> Self {
        Self {
            remaining: TOTAL_PROMPT_MATERIAL_CHAR_LIMIT,
            omissions: Vec::new(),
        }
    }

    fn take(&mut self, label: &str, body: &str, item_limit: usize) -> String {
        if self.remaining == 0 {
            self.omissions.push(format!(
                "{label}: omitted because prompt material budget was exhausted."
            ));
            return String::new();
        }

        let material = project_html_to_prompt_text(body);
        let material_len = material.chars().count();
        let limit = item_limit.min(self.remaining);
        if material_len <= limit {
            self.remaining -= material_len;
            return material;
        }

        let truncated = truncate_chars(&material, limit);
        self.remaining = self.remaining.saturating_sub(truncated.chars().count());
        self.omissions.push(format!(
            "{label}: truncated from {material_len} to {} characters.",
            truncated.chars().count()
        ));
        truncated
    }

    fn append_omissions(&self, prompt: &mut String) {
        if self.omissions.is_empty() {
            return;
        }

        prompt.push_str("\n# Prompt Material Notes\n");
        for omission in &self.omissions {
            prompt.push_str("- ");
            prompt.push_str(omission);
            prompt.push('\n');
        }
    }
}

fn inline_prompt_material(value: &str) -> String {
    value.lines().collect::<Vec<_>>().join(" / ")
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut truncated = value.chars().take(max_chars).collect::<String>();
    truncated = truncated.trim().to_string();
    if !truncated.is_empty() {
        truncated.push_str("\n[Truncated for prompt budget.]");
    }
    truncated
}
