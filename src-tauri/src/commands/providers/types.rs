use qa_scribe_core::domain::AiProvider;
use serde::Serialize;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub providers: Vec<ProviderDescriptor>,
    pub catalog_rollout: ProviderCatalogRollout,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProviderCatalogRollout {
    Disabled,
    Diagnostics,
    Selector,
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
    /// Selector projection retained while callers migrate to
    /// `catalog_snapshot.models`. During diagnostic rollout this deliberately
    /// remains the compatibility list while the richer catalog is observed.
    pub models: Vec<ProviderModelDescriptor>,
    pub catalog_snapshot: ProviderModelCatalogSnapshot,
    pub default_snapshot: ProviderDefaultSnapshot,
    pub local_only: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelCatalogSnapshot {
    pub state: ProviderCatalogState,
    pub source: ProviderCatalogSource,
    pub models: Vec<ProviderModelDescriptor>,
    pub checked_at: Option<String>,
    pub cli_version: Option<String>,
    pub resolution_scope: ProviderResolutionScope,
    pub error: Option<ProviderDiscoveryError>,
    pub warnings: Vec<ProviderWarning>,
}

impl ProviderModelCatalogSnapshot {
    pub fn idle(models: Vec<ProviderModelDescriptor>, source: ProviderCatalogSource) -> Self {
        Self {
            state: ProviderCatalogState::Idle,
            source,
            models,
            checked_at: None,
            cli_version: None,
            resolution_scope: ProviderResolutionScope::neutral(),
            error: None,
            warnings: Vec::new(),
        }
    }

    pub fn fresh(
        source: ProviderCatalogSource,
        models: Vec<ProviderModelDescriptor>,
        cli_version: Option<String>,
        warnings: Vec<ProviderWarning>,
    ) -> Self {
        Self {
            state: ProviderCatalogState::Fresh,
            source,
            models,
            checked_at: Some(checked_at_now()),
            cli_version,
            resolution_scope: ProviderResolutionScope::neutral(),
            error: None,
            warnings,
        }
    }

    pub fn failed(
        source: ProviderCatalogSource,
        models: Vec<ProviderModelDescriptor>,
        cli_version: Option<String>,
        error: ProviderDiscoveryError,
        warnings: Vec<ProviderWarning>,
    ) -> Self {
        Self {
            state: ProviderCatalogState::Failed,
            source,
            models,
            checked_at: Some(checked_at_now()),
            cli_version,
            resolution_scope: ProviderResolutionScope::neutral(),
            error: Some(error),
            warnings,
        }
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        let message = message.into();
        Self {
            state: ProviderCatalogState::Unavailable,
            source: ProviderCatalogSource::Preset,
            models: Vec::new(),
            checked_at: Some(checked_at_now()),
            cli_version: None,
            resolution_scope: ProviderResolutionScope::neutral(),
            error: Some(ProviderDiscoveryError {
                code: ProviderDiscoveryErrorCode::Unavailable,
                message: message.clone(),
                retryable: true,
            }),
            warnings: vec![ProviderWarning {
                code: "catalog-unavailable".to_string(),
                severity: ProviderWarningSeverity::Blocking,
                message,
            }],
        }
    }

    pub fn disabled(models: Vec<ProviderModelDescriptor>) -> Self {
        Self {
            state: ProviderCatalogState::Unavailable,
            source: ProviderCatalogSource::Preset,
            models,
            checked_at: Some(checked_at_now()),
            cli_version: None,
            resolution_scope: ProviderResolutionScope::neutral(),
            error: Some(ProviderDiscoveryError {
                code: ProviderDiscoveryErrorCode::Unavailable,
                message: "Structured provider catalogs are disabled by the rollout setting."
                    .to_string(),
                retryable: false,
            }),
            warnings: vec![ProviderWarning {
                code: "catalog-rollout-disabled".to_string(),
                severity: ProviderWarningSeverity::Advisory,
                message: "QA Scribe is using compatibility model choices.".to_string(),
            }],
        }
    }

    pub fn has_successful_observation(&self) -> bool {
        self.state == ProviderCatalogState::Fresh
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub enum ProviderCatalogState {
    Idle,
    Loading,
    Fresh,
    Stale,
    Unavailable,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub enum ProviderCatalogSource {
    CliCatalog,
    CliHelp,
    Config,
    Environment,
    Preset,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDefaultSnapshot {
    pub state: ProviderDiscoveryState,
    pub model: ProviderDefaultValue,
    pub reasoning_effort: ProviderDefaultValue,
    pub checked_at: Option<String>,
    pub cli_version: Option<String>,
    pub resolution_scope: ProviderResolutionScope,
    pub error: Option<ProviderDiscoveryError>,
    pub warnings: Vec<ProviderWarning>,
}

impl ProviderDefaultSnapshot {
    pub fn unchecked() -> Self {
        Self {
            state: ProviderDiscoveryState::Unchecked,
            model: ProviderDefaultValue::provider_managed(),
            reasoning_effort: ProviderDefaultValue::provider_managed(),
            checked_at: None,
            cli_version: None,
            resolution_scope: ProviderResolutionScope::neutral(),
            error: None,
            warnings: Vec::new(),
        }
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        let message = message.into();
        Self {
            state: ProviderDiscoveryState::Unavailable,
            model: ProviderDefaultValue::unavailable(),
            reasoning_effort: ProviderDefaultValue::unavailable(),
            checked_at: Some(checked_at_now()),
            cli_version: None,
            resolution_scope: ProviderResolutionScope::neutral(),
            error: Some(ProviderDiscoveryError {
                code: ProviderDiscoveryErrorCode::Unavailable,
                message: message.clone(),
                retryable: true,
            }),
            warnings: vec![ProviderWarning {
                code: "provider-unavailable".to_string(),
                severity: ProviderWarningSeverity::Blocking,
                message,
            }],
        }
    }

    pub fn unresolved(error: ProviderDiscoveryError, cli_version: Option<String>) -> Self {
        Self {
            state: ProviderDiscoveryState::Unresolved,
            model: ProviderDefaultValue::unresolved(),
            reasoning_effort: ProviderDefaultValue::unresolved(),
            checked_at: Some(checked_at_now()),
            cli_version,
            resolution_scope: ProviderResolutionScope::neutral(),
            error: Some(error),
            warnings: Vec::new(),
        }
    }

    pub fn has_successful_observation(&self) -> bool {
        matches!(
            self.state,
            ProviderDiscoveryState::Detected | ProviderDiscoveryState::ProviderManaged
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProviderDefaultResolution {
    Configured,
    Recommended,
    ProviderManaged,
    Unresolved,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProviderDiscoveryState {
    Unchecked,
    Detected,
    ProviderManaged,
    Stale,
    Unresolved,
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDefaultValue {
    pub value: Option<String>,
    pub resolution: ProviderDefaultResolution,
    pub origin: Option<ProviderDefaultOrigin>,
    pub recommended_value: Option<String>,
}

impl ProviderDefaultValue {
    pub fn new(
        value: Option<String>,
        resolution: ProviderDefaultResolution,
        origin: Option<ProviderDefaultOrigin>,
        recommended_value: Option<String>,
    ) -> Self {
        Self {
            value,
            resolution,
            origin,
            recommended_value,
        }
    }

    pub fn provider_managed() -> Self {
        Self::new(None, ProviderDefaultResolution::ProviderManaged, None, None)
    }

    pub fn unresolved() -> Self {
        Self::new(None, ProviderDefaultResolution::Unresolved, None, None)
    }

    pub fn unavailable() -> Self {
        Self::new(None, ProviderDefaultResolution::Unavailable, None, None)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDefaultOrigin {
    pub kind: ProviderDefaultOriginKind,
    pub label: String,
    pub display_path: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProviderDefaultOriginKind {
    UserConfig,
    ProjectConfig,
    Profile,
    ManagedConfig,
    RuntimeFlag,
    Environment,
    CliRecommendation,
    ConfigFile,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderResolutionScope {
    pub kind: ProviderResolutionScopeKind,
    pub label: String,
}

impl ProviderResolutionScope {
    pub fn neutral() -> Self {
        Self {
            kind: ProviderResolutionScopeKind::Neutral,
            label: "Neutral QA Scribe runtime scope".to_string(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProviderResolutionScopeKind {
    Neutral,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDiscoveryError {
    pub code: ProviderDiscoveryErrorCode,
    pub message: String,
    pub retryable: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub enum ProviderDiscoveryErrorCode {
    SpawnFailed,
    HandshakeFailed,
    TimedOut,
    Cancelled,
    Unsupported,
    ProtocolIncompatible,
    InvalidResponse,
    OutputLimit,
    AuthRequired,
    PolicyDenied,
    Network,
    RateLimited,
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderWarning {
    pub code: String,
    pub severity: ProviderWarningSeverity,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProviderWarningSeverity {
    Advisory,
    Blocking,
}

pub(super) fn checked_at_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelDescriptor {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub source: ProviderModelSource,
    pub availability: ProviderModelAvailability,
    pub confidence: ProviderEvidenceConfidence,
    pub is_default: bool,
    pub reasoning_efforts: Vec<String>,
    pub default_reasoning_effort: Option<String>,
    pub capabilities: ProviderModelCapabilities,
    pub resolved_model: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub enum ProviderModelSource {
    ProviderDefault,
    Environment,
    Preset,
    Config,
    CliCatalog,
    CliHelp,
    Detected,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProviderModelAvailability {
    Available,
    PolicyDisabled,
    Unconfigured,
    SupportedByBinary,
    StaticHint,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProviderEvidenceConfidence {
    Authoritative,
    Observed,
    Heuristic,
    Static,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelCapabilities {
    pub vision: Option<bool>,
    pub reasoning: Option<bool>,
    pub adaptive_thinking: Option<bool>,
    pub fast_mode: Option<bool>,
    pub auto_mode: Option<bool>,
    pub context_window_tokens: Option<u64>,
    pub max_output_tokens: Option<u64>,
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
    pub(super) fingerprint: u64,
}
