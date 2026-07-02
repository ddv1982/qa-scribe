use qa_scribe_core::{
    domain::{AiProvider, AiRun, Attachment, Draft, Entry, Finding, GenerationContext},
    generation::ActionPromptKind,
};
use serde::{Deserialize, Serialize};

use crate::jobs::GenerationJobStatus;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GenerateAiActionKind {
    Testware,
    Finding,
    Summary,
}

impl GenerateAiActionKind {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            GenerateAiActionKind::Testware => "testware",
            GenerateAiActionKind::Finding => "finding",
            GenerateAiActionKind::Summary => "summary",
        }
    }

    pub(super) fn prompt_version(self) -> &'static str {
        match self {
            GenerateAiActionKind::Testware => "testware-v3",
            GenerateAiActionKind::Finding => "finding-v3",
            GenerateAiActionKind::Summary => "note-summary-v3",
        }
    }

    pub(super) fn label(self) -> &'static str {
        match self {
            GenerateAiActionKind::Testware => "Generate test cases",
            GenerateAiActionKind::Finding => "Create finding",
            GenerateAiActionKind::Summary => "Summarize notes",
        }
    }

    pub(super) fn prompt_kind(self) -> ActionPromptKind {
        match self {
            GenerateAiActionKind::Testware => ActionPromptKind::Testware,
            GenerateAiActionKind::Finding => ActionPromptKind::Finding,
            GenerateAiActionKind::Summary => ActionPromptKind::Summary,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAiActionRequest {
    pub session_id: String,
    pub provider: AiProvider,
    pub model: String,
    pub reasoning_effort: Option<String>,
    pub action: GenerateAiActionKind,
    pub note_entry_id: Option<String>,
    pub testware_preferences: Option<TestwareGenerationPreferences>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TestwareTechnique {
    Auto,
    UseCase,
    EquivalenceBoundary,
    DecisionTable,
    StateTransition,
    Pairwise,
    RiskBased,
    Exploratory,
    Bdd,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TestwareOutputFormat {
    QaCases,
    Checklist,
    Gherkin,
    Charters,
    CoverageOutline,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TestwareDepth {
    Lean,
    Balanced,
    Thorough,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestwareGenerationPreferences {
    pub technique: TestwareTechnique,
    pub output_format: TestwareOutputFormat,
    pub depth: TestwareDepth,
    pub include_negative_cases: bool,
    pub include_boundary_cases: bool,
    pub include_test_data: bool,
    pub preserve_evidence: bool,
    pub custom_instructions: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAiActionResult {
    pub generation_context: GenerationContext,
    pub ai_run: AiRun,
    pub draft: Option<Draft>,
    pub finding: Option<Finding>,
    pub note_entry: Option<Entry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAiActionJobResult {
    pub job_id: String,
    pub status: GenerationJobStatus,
}

pub(super) struct PreparedGeneration {
    pub(super) session_id: String,
    pub(super) session_title: String,
    pub(super) generation_context: GenerationContext,
    pub(super) ai_run: AiRun,
    pub(super) prompt: String,
    pub(super) selected_note_id: Option<String>,
    pub(super) selected_note_body: Option<String>,
    pub(super) attachments: Vec<Attachment>,
}
