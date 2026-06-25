use qa_scribe_core::{ai::CopilotRuntime, domain::AiProvider};
use serde::Serialize;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub providers: Vec<ProviderDescriptor>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
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
    pub local_only: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelDescriptor {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub source: ProviderModelSource,
    pub is_default: bool,
    pub reasoning_efforts: Vec<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderModelSource {
    ProviderDefault,
    Environment,
    Preset,
    Detected,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
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
    pub copilot_runtime: Option<CopilotRuntime>,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(super) struct ReadinessCacheKey {
    pub(super) provider: AiProvider,
    pub(super) mode: super::probe::DetectionMode,
}
