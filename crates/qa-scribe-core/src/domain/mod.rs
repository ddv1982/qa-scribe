use serde::{Deserialize, Serialize};

use crate::{QaScribeError, Result, error::validation};

pub const TEXT_BODY_MAX_LENGTH: usize = 100_000;
pub const METADATA_JSON_MAX_LENGTH: usize = 20_000;
pub const DRAFT_BODY_MAX_LENGTH: usize = 250_000;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: String,
    pub session_context: Option<String>,
    pub objective_notes: Option<String>,
    pub environment: Option<String>,
    pub build_version: Option<String>,
    pub related_reference: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDraft {
    pub title: String,
    pub session_context: Option<String>,
    pub objective_notes: Option<String>,
    pub environment: Option<String>,
    pub build_version: Option<String>,
    pub related_reference: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPatch {
    pub title: Option<String>,
    pub session_context: Option<Option<String>>,
    pub objective_notes: Option<Option<String>>,
    pub environment: Option<Option<String>>,
    pub build_version: Option<Option<String>>,
    pub related_reference: Option<Option<String>>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryType {
    Note,
    Observation,
    ApiResponse,
    Log,
    Screenshot,
    FindingCandidate,
}

impl EntryType {
    pub fn as_str(self) -> &'static str {
        match self {
            EntryType::Note => "note",
            EntryType::Observation => "observation",
            EntryType::ApiResponse => "api_response",
            EntryType::Log => "log",
            EntryType::Screenshot => "screenshot",
            EntryType::FindingCandidate => "finding_candidate",
        }
    }

    pub fn from_stored(value: &str) -> Result<Self> {
        match value {
            "note" => Ok(EntryType::Note),
            "observation" => Ok(EntryType::Observation),
            "api_response" => Ok(EntryType::ApiResponse),
            "log" => Ok(EntryType::Log),
            "screenshot" => Ok(EntryType::Screenshot),
            "finding_candidate" => Ok(EntryType::FindingCandidate),
            _ => Err(QaScribeError::InvalidStoredValue {
                field: "entry.type",
                value: value.to_string(),
            }),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub session_id: String,
    pub entry_type: EntryType,
    pub title: Option<String>,
    pub body: String,
    pub metadata_json: Option<String>,
    pub excluded_from_generation: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryDraft {
    pub session_id: String,
    pub entry_type: EntryType,
    pub title: Option<String>,
    pub body: String,
    pub metadata_json: Option<String>,
    pub excluded_from_generation: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryPatch {
    pub title: Option<Option<String>>,
    pub body: Option<String>,
    pub metadata_json: Option<Option<String>>,
    pub excluded_from_generation: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub session_id: String,
    pub entry_id: Option<String>,
    pub filename: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub sha256: String,
    pub relative_path: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentDraft {
    pub session_id: String,
    pub entry_id: Option<String>,
    pub filename: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub sha256: String,
    pub relative_path: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FindingKind {
    Bug,
    Question,
    Risk,
    FollowUp,
    Note,
}

impl FindingKind {
    pub fn as_str(self) -> &'static str {
        match self {
            FindingKind::Bug => "bug",
            FindingKind::Question => "question",
            FindingKind::Risk => "risk",
            FindingKind::FollowUp => "follow_up",
            FindingKind::Note => "note",
        }
    }

    pub fn from_stored(value: &str) -> Result<Self> {
        match value {
            "bug" => Ok(FindingKind::Bug),
            "question" => Ok(FindingKind::Question),
            "risk" => Ok(FindingKind::Risk),
            "follow_up" => Ok(FindingKind::FollowUp),
            "note" => Ok(FindingKind::Note),
            _ => Err(QaScribeError::InvalidStoredValue {
                field: "finding.kind",
                value: value.to_string(),
            }),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub body: String,
    pub kind: FindingKind,
    pub metadata_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingDraft {
    pub session_id: String,
    pub title: String,
    pub body: String,
    pub kind: FindingKind,
    pub metadata_json: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingPatch {
    pub title: Option<String>,
    pub body: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceLink {
    pub id: String,
    pub finding_id: String,
    pub entry_id: Option<String>,
    pub attachment_id: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceLinkDraft {
    pub finding_id: String,
    pub entry_id: Option<String>,
    pub attachment_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DraftKind {
    SessionReport,
    Testware,
}

impl DraftKind {
    pub fn as_str(self) -> &'static str {
        match self {
            DraftKind::SessionReport => "session_report",
            DraftKind::Testware => "testware",
        }
    }

    pub fn from_stored(value: &str) -> Result<Self> {
        match value {
            "session_report" => Ok(DraftKind::SessionReport),
            "testware" => Ok(DraftKind::Testware),
            _ => Err(QaScribeError::InvalidStoredValue {
                field: "draft.kind",
                value: value.to_string(),
            }),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub id: String,
    pub session_id: String,
    pub ai_run_id: Option<String>,
    pub kind: DraftKind,
    pub title: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftCreate {
    pub session_id: String,
    pub ai_run_id: Option<String>,
    pub kind: DraftKind,
    pub title: String,
    pub body: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftPatch {
    pub title: Option<String>,
    pub body: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationContext {
    pub id: String,
    pub session_id: String,
    pub created_at: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiProvider {
    ClaudeCode,
    CodexCli,
    CopilotCli,
}

impl AiProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            AiProvider::ClaudeCode => "claude_code",
            AiProvider::CodexCli => "codex_cli",
            AiProvider::CopilotCli => "copilot_cli",
        }
    }

    pub fn from_stored(value: &str) -> Result<Self> {
        match value {
            "claude_code" => Ok(AiProvider::ClaudeCode),
            "codex_cli" => Ok(AiProvider::CodexCli),
            "copilot_cli" => Ok(AiProvider::CopilotCli),
            _ => Err(QaScribeError::InvalidStoredValue {
                field: "ai_run.provider",
                value: value.to_string(),
            }),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiRunStatus {
    Running,
    Completed,
    Failed,
}

impl AiRunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            AiRunStatus::Running => "running",
            AiRunStatus::Completed => "completed",
            AiRunStatus::Failed => "failed",
        }
    }

    pub fn from_stored(value: &str) -> Result<Self> {
        match value {
            "running" => Ok(AiRunStatus::Running),
            "completed" => Ok(AiRunStatus::Completed),
            "failed" => Ok(AiRunStatus::Failed),
            _ => Err(QaScribeError::InvalidStoredValue {
                field: "ai_run.status",
                value: value.to_string(),
            }),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRun {
    pub id: String,
    pub session_id: String,
    pub generation_context_id: Option<String>,
    pub provider: AiProvider,
    pub model: String,
    pub reasoning_effort: Option<String>,
    pub prompt_version: String,
    pub status: AiRunStatus,
    pub error_message: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRunCreate {
    pub session_id: String,
    pub generation_context_id: Option<String>,
    pub provider: AiProvider,
    pub model: String,
    pub reasoning_effort: Option<String>,
    pub prompt_version: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub schema_version: u16,
    pub generation_system_prompt: String,
    #[serde(default = "default_selected_ai_provider")]
    pub selected_ai_provider: AiProvider,
    #[serde(default = "default_selected_ai_model")]
    pub selected_ai_model: String,
    #[serde(default = "default_testware_template")]
    pub testware_template: String,
    #[serde(default = "default_finding_template")]
    pub finding_template: String,
    #[serde(default = "default_note_summary_template")]
    pub note_summary_template: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            generation_system_prompt:
                "Turn the selected Session material into concise, evidence-grounded Testware."
                    .to_string(),
            selected_ai_provider: default_selected_ai_provider(),
            selected_ai_model: default_selected_ai_model(),
            testware_template: default_testware_template(),
            finding_template: default_finding_template(),
            note_summary_template: default_note_summary_template(),
        }
    }
}

fn default_selected_ai_provider() -> AiProvider {
    AiProvider::CodexCli
}

fn default_selected_ai_model() -> String {
    "default".to_string()
}

fn default_testware_template() -> String {
    [
        "Create 5-8 concise QA test cases from the selected note only.",
        "Return a clean HTML fragment with a heading and one section per test case.",
        "For each case include purpose, preconditions, test data, steps, expected result, and coverage notes when the note supports them.",
        "Do not wrap the response in a code fence.",
    ]
    .join("\n")
}

fn default_finding_template() -> String {
    [
        "Create one well-structured QA finding from the note.",
        "Use the first h2 as the concise finding title.",
        "Return a clean HTML fragment with sections for title, severity, environment, steps to reproduce, expected result, actual result, evidence, and impact.",
        "Ground the finding in the note text only.",
        "Do not wrap the response in a code fence.",
    ]
    .join("\n")
}

fn default_note_summary_template() -> String {
    [
        "Improve the current QA note for clarity while preserving meaning.",
        "Return a clean HTML fragment using only headings, paragraphs, lists, checkboxes, links, and images when present.",
        "Do not wrap the response in a code fence.",
    ]
    .join("\n")
}

pub fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub fn validate_required_text(label: &str, value: &str, max_len: usize) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(validation(format!("{label} is required")));
    }
    if trimmed.len() > max_len {
        return Err(validation(format!(
            "{label} must be at most {max_len} characters"
        )));
    }
    Ok(trimmed.to_string())
}

pub fn validate_body_text(label: &str, value: &str, max_len: usize) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.len() > max_len {
        return Err(validation(format!(
            "{label} must be at most {max_len} characters"
        )));
    }
    Ok(trimmed.to_string())
}

pub fn validate_optional_text(
    label: &str,
    value: Option<String>,
    max_len: usize,
) -> Result<Option<String>> {
    let Some(cleaned) = clean_optional(value) else {
        return Ok(None);
    };
    if cleaned.len() > max_len {
        return Err(validation(format!(
            "{label} must be at most {max_len} characters"
        )));
    }
    Ok(Some(cleaned))
}

pub fn validate_metadata_json(value: Option<String>) -> Result<Option<String>> {
    let Some(cleaned) = validate_optional_text("metadata JSON", value, METADATA_JSON_MAX_LENGTH)?
    else {
        return Ok(None);
    };
    let parsed: serde_json::Value = serde_json::from_str(&cleaned)
        .map_err(|_| validation("metadata JSON must be a JSON object"))?;
    if !parsed.is_object() {
        return Err(validation("metadata JSON must be a JSON object"));
    }
    Ok(Some(cleaned))
}
