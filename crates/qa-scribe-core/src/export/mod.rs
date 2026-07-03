use serde::{Deserialize, Serialize};

use crate::{
    Result,
    domain::{Attachment, Draft, Entry, EvidenceLink, Finding, Session},
    services::SessionService,
};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Markdown,
    Json,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionExport {
    pub filename: String,
    pub body: String,
    pub format: ExportFormat,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct ExportPayload {
    session: Session,
    entries: Vec<Entry>,
    findings: Vec<Finding>,
    evidence_links: Vec<EvidenceLink>,
    attachments: Vec<Attachment>,
    drafts: Vec<Draft>,
}

pub fn export_session(
    service: &SessionService,
    session_id: &str,
    format: ExportFormat,
) -> Result<SessionExport> {
    let session = service
        .get_session(session_id)?
        .ok_or_else(|| crate::QaScribeError::NotFound(session_id.to_string()))?;
    let payload = ExportPayload {
        entries: service.list_entries(session_id)?,
        findings: service.list_findings(session_id)?,
        evidence_links: service.list_evidence_links(session_id)?,
        attachments: service.list_attachments(session_id)?,
        drafts: service.list_drafts(session_id)?,
        session,
    };
    let filename = format!("{}{}", slug(&payload.session.title), extension(format));
    let body = match format {
        ExportFormat::Markdown => markdown(&payload),
        ExportFormat::Json => serde_json::to_string_pretty(&payload)
            .map_err(|_| crate::error::validation("Session export could not serialize"))?,
    };
    Ok(SessionExport {
        filename,
        body,
        format,
    })
}

fn markdown(payload: &ExportPayload) -> String {
    let mut output = String::new();
    output.push_str(&format!("# {}\n\n", payload.session.title));
    if let Some(context) = &payload.session.session_context {
        output.push_str(&format!("## Session Context\n{context}\n\n"));
    }
    if let Some(notes) = &payload.session.objective_notes {
        output.push_str(&format!("## Objective Notes\n{notes}\n\n"));
    }
    output.push_str("## Session Timeline\n");
    for entry in &payload.entries {
        output.push_str(&format!(
            "- **{}**: {}\n",
            entry.entry_type.as_str(),
            entry.body
        ));
    }
    output.push_str("\n## Findings\n");
    for finding in &payload.findings {
        output.push_str(&format!("- **{}**: {}\n", finding.title, finding.body));
        for link in payload
            .evidence_links
            .iter()
            .filter(|link| link.finding_id == finding.id)
        {
            if let Some(entry_id) = &link.entry_id {
                output.push_str(&format!("  - Evidence Entry: {entry_id}\n"));
            }
            if let Some(attachment_id) = &link.attachment_id {
                output.push_str(&format!("  - Evidence Attachment: {attachment_id}\n"));
            }
        }
    }
    output.push_str("\n## Attachments\n");
    for attachment in &payload.attachments {
        output.push_str(&format!(
            "- {} ({}, sha256: {})\n",
            attachment.filename, attachment.relative_path, attachment.sha256
        ));
    }
    output.push_str("\n## Drafts\n");
    for draft in &payload.drafts {
        output.push_str(&format!("### {}\n{}\n\n", draft.title, draft.body));
    }
    output
}

fn slug(value: &str) -> String {
    let slug = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "session-export".to_string()
    } else {
        slug
    }
}

fn extension(format: ExportFormat) -> &'static str {
    match format {
        ExportFormat::Markdown => ".md",
        ExportFormat::Json => ".json",
    }
}
