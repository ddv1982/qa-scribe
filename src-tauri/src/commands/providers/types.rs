use qa_scribe_core::domain::AiProvider;
use serde::Serialize;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub providers: Vec<ProviderDescriptor>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptor {
    pub id: String,
    pub label: &'static str,
    pub status: ProviderState,
    pub available: bool,
    pub reason: String,
    pub command: Option<String>,
    pub executable_path: Option<String>,
    pub models: Vec<ProviderModelDescriptor>,
    pub default_snapshot: ProviderDefaultSnapshot,
    pub local_only: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDefaultSnapshot {
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub model_origin: Option<String>,
    pub reasoning_origin: Option<String>,
    pub resolution: ProviderDefaultResolution,
    pub recommended_model: Option<String>,
    pub recommended_reasoning_effort: Option<String>,
    pub warnings: Vec<String>,
}

impl ProviderDefaultSnapshot {
    pub fn provider_managed() -> Self {
        Self {
            model: None,
            reasoning_effort: None,
            model_origin: None,
            reasoning_origin: None,
            resolution: ProviderDefaultResolution::ProviderManaged,
            recommended_model: None,
            recommended_reasoning_effort: None,
            warnings: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProviderDefaultResolution {
    Configured,
    Recommended,
    ProviderManaged,
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelDescriptor {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub source: ProviderModelSource,
    pub is_default: bool,
    pub reasoning_efforts: Vec<String>,
    pub default_reasoning_effort: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProviderModelSource {
    ProviderDefault,
    Environment,
    Preset,
    Detected,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProviderState {
    Ready,
    AuthRequired,
    InstallRequired,
    Error,
}

impl ProviderState {
    pub fn is_ready(self) -> bool {
        self == ProviderState::Ready
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderReadiness {
    pub descriptor: ProviderDescriptor,
    pub copilot_direct_cli_ready: bool,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(super) struct ReadinessCacheKey {
    pub(super) provider: AiProvider,
    pub(super) mode: super::probe::DetectionMode,
}
