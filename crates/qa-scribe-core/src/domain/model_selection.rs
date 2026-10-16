use serde::{Deserialize, Serialize};

use super::AiProvider;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum RequestedModel {
    Default,
    CopilotAutomatic,
    Explicit { id: String },
}

impl RequestedModel {
    pub fn from_request(provider: AiProvider, value: &str) -> crate::Result<Self> {
        if value.chars().any(char::is_control) {
            return Err(crate::error::validation(
                "AI model must not contain control characters",
            ));
        }
        let value = value.trim();
        if value.is_empty() || value.eq_ignore_ascii_case("default") {
            Ok(Self::Default)
        } else if provider == AiProvider::CopilotCli && value.eq_ignore_ascii_case("auto") {
            Ok(Self::CopilotAutomatic)
        } else {
            super::validate_required_text("AI model", value, 240)?;
            Ok(Self::Explicit { id: value.into() })
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(tag = "source", rename_all = "camelCase", deny_unknown_fields)]
pub enum ReportedModel {
    ClaudeInitialization { id: String },
    ClaudeAssistantMessage { id: String },
    CodexThreadConfiguration { id: String },
}

impl ReportedModel {
    pub fn id(&self) -> &str {
        match self {
            Self::ClaudeInitialization { id }
            | Self::ClaudeAssistantMessage { id }
            | Self::CodexThreadConfiguration { id } => id,
        }
    }

    pub fn valid_for(&self, provider: AiProvider) -> bool {
        let id = self.id();
        !id.is_empty()
            && id == id.trim()
            && id.chars().count() <= 240
            && !id.chars().any(char::is_control)
            && matches!(
                (provider, self),
                (
                    AiProvider::ClaudeCode,
                    Self::ClaudeInitialization { .. } | Self::ClaudeAssistantMessage { .. }
                ) | (AiProvider::CodexCli, Self::CodexThreadConfiguration { .. })
            )
    }

    pub fn retain_in(self, current: &mut Option<Self>) {
        if matches!(
            (&*current, &self),
            (
                Some(Self::ClaudeAssistantMessage { .. }),
                Self::ClaudeInitialization { .. }
            )
        ) {
            return;
        }
        *current = Some(self);
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum RunModelSelection {
    Legacy {
        value: String,
    },
    Recorded {
        requested: RequestedModel,
        reported: Option<ReportedModel>,
    },
}

impl RunModelSelection {
    pub fn from_stored(
        provider: AiProvider,
        legacy: String,
        json: Option<String>,
    ) -> crate::Result<Self> {
        let Some(json) = json else {
            return Ok(Self::Legacy { value: legacy });
        };
        let invalid = || crate::QaScribeError::InvalidStoredValue {
            field: "ai_run.model_selection_json",
            value: "invalid model evidence".into(),
        };
        let parsed: Self = serde_json::from_str(&json).map_err(|_| invalid())?;
        match &parsed {
            Self::Recorded {
                requested,
                reported,
            } => {
                match requested {
                    RequestedModel::CopilotAutomatic if provider != AiProvider::CopilotCli => {
                        return Err(invalid());
                    }
                    RequestedModel::Explicit { id }
                        if id.is_empty()
                            || id != id.trim()
                            || id.chars().count() > 240
                            || id.chars().any(char::is_control) =>
                    {
                        return Err(invalid());
                    }
                    _ => {}
                }
                if reported
                    .as_ref()
                    .is_some_and(|report| !report.valid_for(provider))
                {
                    return Err(invalid());
                }
            }
            Self::Legacy { .. } => return Err(invalid()),
        }
        Ok(parsed)
    }
}
