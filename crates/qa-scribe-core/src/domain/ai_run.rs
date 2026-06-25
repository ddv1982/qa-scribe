use serde::{Deserialize, Serialize};

use crate::{QaScribeError, Result};

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
