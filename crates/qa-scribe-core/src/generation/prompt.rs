use crate::domain::{AppSettings, Attachment, Entry, Finding, Session};

use super::html_projection::project_html_to_prompt_text;

pub const SESSION_REPORT_PROMPT_VERSION: &str = "session-report-v1";
const MANAGED_ATTACHMENT_PROTOCOL: &str = "qa-scribe-attachment://";
const SELECTED_NOTE_PROMPT_CHAR_LIMIT: usize = 20_000;
const SUPPORTING_ENTRY_PROMPT_CHAR_LIMIT: usize = 6_000;
const FINDING_PROMPT_CHAR_LIMIT: usize = 4_000;
const TOTAL_PROMPT_MATERIAL_CHAR_LIMIT: usize = 40_000;
const TESTWARE_SELECTED_NOTE_PROMPT_CHAR_LIMIT: usize = 12_000;
const TESTWARE_TOTAL_PROMPT_MATERIAL_CHAR_LIMIT: usize = 16_000;
const FINDING_SELECTED_NOTE_PROMPT_CHAR_LIMIT: usize = 10_000;
const FINDING_TOTAL_PROMPT_MATERIAL_CHAR_LIMIT: usize = 14_000;

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
    _entries: &[Entry],
    _findings: &[Finding],
    attachments: &[Attachment],
    action: ActionPromptKind,
) -> String {
    match action {
        ActionPromptKind::Testware => {
            render_testware_prompt(settings, session_title, note_entry, attachments)
        }
        ActionPromptKind::Finding => {
            render_finding_prompt(settings, session_title, note_entry, attachments)
        }
        ActionPromptKind::Summary => {
            render_note_summary_prompt(settings, session_title, note_entry, attachments)
        }
    }
}

fn render_testware_prompt(
    settings: &AppSettings,
    session_title: &str,
    note_entry: Option<&Entry>,
    attachments: &[Attachment],
) -> String {
    let mut budget = PromptMaterialBudget::with_limit(TESTWARE_TOTAL_PROMPT_MATERIAL_CHAR_LIMIT);
    let mut prompt = String::new();
    prompt.push_str(&settings.generation_system_prompt);
    prompt.push_str("\n\n");
    prompt.push_str(&settings.testware_template);
    prompt.push_str("\nReturn only a clean HTML fragment. Do not use Markdown, code fences, an introduction, or a closing summary. Use only h2, h3, p, ul, ol, li, strong, em, a, img, and checkbox inputs when useful.\n");
    prompt.push_str("Return literal HTML tags such as <p>Text</p>. Do not escape tags as &lt;p&gt;Text&lt;/p&gt; or display tag names as text.\n");
    prompt.push_str("Preserve managed image placeholders exactly as literal <img> elements when they are relevant test evidence. Never invent filesystem paths for images.\n");
    prompt.push_str("Create 5-8 high-value test cases from the selected note only. Prefer coverage over exhaustiveness. Do not invent facts not present in the note.\n");
    append_selected_note(
        &mut prompt,
        &mut budget,
        session_title,
        note_entry,
        TESTWARE_SELECTED_NOTE_PROMPT_CHAR_LIMIT,
    );
    append_managed_images(&mut prompt, note_entry, attachments);
    budget.append_omissions(&mut prompt);
    prompt
}

fn render_finding_prompt(
    settings: &AppSettings,
    session_title: &str,
    note_entry: Option<&Entry>,
    attachments: &[Attachment],
) -> String {
    let mut budget = PromptMaterialBudget::with_limit(FINDING_TOTAL_PROMPT_MATERIAL_CHAR_LIMIT);
    let mut prompt = String::new();
    prompt.push_str(&settings.generation_system_prompt);
    prompt.push_str("\n\n");
    prompt.push_str(&settings.finding_template);
    prompt.push_str("\nReturn only a clean HTML fragment. Use the first h2 as the concise finding title. Do not use Markdown, code fences, an introduction, or a closing summary. Use only h2, h3, p, ul, ol, li, strong, em, a, and img.\n");
    prompt.push_str("Return literal HTML tags such as <p>Text</p>. Do not escape tags as &lt;p&gt;Text&lt;/p&gt; or display tag names as text.\n");
    prompt.push_str("Preserve managed image placeholders exactly as literal <img> elements when they are relevant evidence. Never invent filesystem paths for images.\n");
    prompt.push_str("Create one focused QA finding from the selected note only. If a field is missing, write \"Unknown\" rather than inventing details.\n");
    append_selected_note(
        &mut prompt,
        &mut budget,
        session_title,
        note_entry,
        FINDING_SELECTED_NOTE_PROMPT_CHAR_LIMIT,
    );
    append_managed_images(&mut prompt, note_entry, attachments);
    budget.append_omissions(&mut prompt);
    prompt
}

fn render_note_summary_prompt(
    settings: &AppSettings,
    session_title: &str,
    note_entry: Option<&Entry>,
    attachments: &[Attachment],
) -> String {
    let mut budget = PromptMaterialBudget::new();
    let mut prompt = String::new();
    prompt.push_str(&settings.generation_system_prompt);
    prompt.push_str("\n\n");
    prompt.push_str(&settings.note_summary_template);
    prompt.push_str("\nReturn literal HTML tags such as <p>Text</p>. Do not escape tags as &lt;p&gt;Text&lt;/p&gt; or display tag names as text.\n");
    prompt.push_str("Preserve managed image placeholders exactly as literal <img> elements when they are still relevant. Never invent filesystem paths for images.\n");
    prompt.push_str(&format!("\n# Note\nTitle: {session_title}\n"));

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

    append_managed_images(&mut prompt, note_entry, attachments);
    budget.append_omissions(&mut prompt);
    prompt
}

fn append_managed_images(
    prompt: &mut String,
    note_entry: Option<&Entry>,
    attachments: &[Attachment],
) {
    let managed_attachment_ids = note_entry
        .map(|entry| managed_attachment_ids_from_html(&entry.body))
        .unwrap_or_default();
    let note_attachments = attachments
        .iter()
        .filter(|attachment| managed_attachment_ids.iter().any(|id| id == &attachment.id))
        .collect::<Vec<_>>();
    if !note_attachments.is_empty() {
        prompt.push_str("\n# Managed Images\n");
        for attachment in note_attachments {
            prompt.push_str(&format!(
                "- {}: <img src=\"{}{id}\" data-attachment-id=\"{id}\" alt=\"{}\" />\n",
                attachment.filename,
                MANAGED_ATTACHMENT_PROTOCOL,
                escape_prompt_attribute(&attachment.filename),
                id = attachment.id
            ));
        }
    }
}

fn append_selected_note(
    prompt: &mut String,
    budget: &mut PromptMaterialBudget,
    session_title: &str,
    note_entry: Option<&Entry>,
    item_limit: usize,
) {
    prompt.push_str(&format!("\n\n# Selected Note\nTitle: {session_title}\n"));
    match note_entry {
        Some(entry) => {
            let note = budget.take("selected note", &entry.body, item_limit);
            if note.is_empty() {
                prompt.push_str("(No note text available.)\n");
            } else {
                prompt.push_str(&note);
                prompt.push('\n');
            }
        }
        None => prompt.push_str("(No note selected.)\n"),
    }
}

struct PromptMaterialBudget {
    remaining: usize,
    omissions: Vec<String>,
}

impl PromptMaterialBudget {
    fn new() -> Self {
        Self::with_limit(TOTAL_PROMPT_MATERIAL_CHAR_LIMIT)
    }

    fn with_limit(remaining: usize) -> Self {
        Self {
            remaining,
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

pub fn managed_attachment_ids_from_html(value: &str) -> Vec<String> {
    let mut ids = Vec::new();
    collect_attribute_values(value, "data-attachment-id", &mut ids);
    collect_protocol_sources(value, &mut ids);
    ids.dedup();
    ids
}

fn collect_attribute_values(value: &str, attribute: &str, ids: &mut Vec<String>) {
    for quote in ['"', '\''] {
        let needle = format!("{attribute}={quote}");
        let mut offset = 0usize;
        while let Some(relative_start) = value[offset..].find(&needle) {
            let value_start = offset + relative_start + needle.len();
            let Some(relative_end) = value[value_start..].find(quote) else {
                break;
            };
            let candidate = value[value_start..value_start + relative_end].trim();
            if !candidate.is_empty() && !ids.iter().any(|id| id == candidate) {
                ids.push(candidate.to_string());
            }
            offset = value_start + relative_end + quote.len_utf8();
        }
    }
}

fn collect_protocol_sources(value: &str, ids: &mut Vec<String>) {
    let mut offset = 0usize;
    while let Some(relative_start) = value[offset..].find(MANAGED_ATTACHMENT_PROTOCOL) {
        let value_start = offset + relative_start + MANAGED_ATTACHMENT_PROTOCOL.len();
        let mut value_end = value_start;
        while value_end < value.len() {
            let Some(character) = value[value_end..].chars().next() else {
                break;
            };
            if character.is_whitespace() || matches!(character, '"' | '\'' | '<' | '>') {
                break;
            }
            value_end += character.len_utf8();
        }
        let candidate = value[value_start..value_end].trim();
        if !candidate.is_empty() && !ids.iter().any(|id| id == candidate) {
            ids.push(candidate.to_string());
        }
        offset = value_end;
    }
}

fn escape_prompt_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
