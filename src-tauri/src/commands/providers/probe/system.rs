use std::{
    io::ErrorKind,
    path::PathBuf,
    process::Command,
    sync::OnceLock,
    time::{Duration, Instant},
};

use qa_scribe_core::domain::AiProvider;

use crate::{
    commands::providers::{ProviderDiscoveryError, ProviderDiscoveryErrorCode},
    jobs::JobControl,
    provider_command::{
        NeutralProviderCwd, ProviderPathMode, apply_provider_path, provider_executable_path,
    },
};

use super::{
    CodexDefaultsProbe, CommandProbe, ProbeRunner, StructuredCatalog, StructuredCatalogProbe,
    cancel::DiscoveryCancellation,
    claude,
    command::run_command_with_cancellation,
    copilot,
    identity::{discovery_cache_fingerprint, provider_executable},
    read_codex_app_server_defaults,
};

const PROVIDER_PROBE_TIMEOUT: Duration = Duration::from_secs(4);
const PROVIDER_TRANSACTION_TIMEOUT: Duration = Duration::from_secs(12);

pub(in crate::commands::providers) struct SystemProbeRunner {
    path_mode: ProviderPathMode,
    deadline: Instant,
    codex_defaults: OnceLock<CodexDefaultsProbe>,
    claude_catalog: OnceLock<StructuredCatalogProbe>,
    copilot_catalog: OnceLock<StructuredCatalogProbe>,
    cancellation: DiscoveryCancellation,
    provider_cwd_parent: Option<PathBuf>,
}

impl SystemProbeRunner {
    pub(in crate::commands::providers) fn new(path_mode: ProviderPathMode) -> Self {
        Self {
            path_mode,
            deadline: Instant::now() + PROVIDER_TRANSACTION_TIMEOUT,
            codex_defaults: OnceLock::new(),
            claude_catalog: OnceLock::new(),
            copilot_catalog: OnceLock::new(),
            cancellation: DiscoveryCancellation::capture(),
            provider_cwd_parent: None,
        }
    }

    pub(in crate::commands::providers) fn for_job(
        path_mode: ProviderPathMode,
        control: &JobControl,
    ) -> Self {
        Self {
            path_mode,
            deadline: Instant::now() + PROVIDER_TRANSACTION_TIMEOUT,
            codex_defaults: OnceLock::new(),
            claude_catalog: OnceLock::new(),
            copilot_catalog: OnceLock::new(),
            cancellation: DiscoveryCancellation::for_job(control),
            provider_cwd_parent: None,
        }
    }

    #[cfg(test)]
    pub(in crate::commands::providers) fn with_provider_cwd_parent(
        path_mode: ProviderPathMode,
        parent: PathBuf,
    ) -> Self {
        Self {
            provider_cwd_parent: Some(parent),
            ..Self::new(path_mode)
        }
    }

    fn remaining(&self) -> Duration {
        self.deadline
            .saturating_duration_since(Instant::now())
            .min(PROVIDER_PROBE_TIMEOUT)
    }

    fn provider_cwd(&self) -> std::io::Result<NeutralProviderCwd> {
        match self.provider_cwd_parent.as_deref() {
            Some(parent) => NeutralProviderCwd::new_in(parent),
            None => NeutralProviderCwd::new(),
        }
    }
}

impl ProbeRunner for SystemProbeRunner {
    fn executable_path(&self, program: &str) -> Option<PathBuf> {
        provider_executable_path(program, self.path_mode)
    }

    fn run(&self, program: &str, args: &[&str]) -> CommandProbe {
        let executable = provider_executable_path(program, self.path_mode)
            .unwrap_or_else(|| PathBuf::from(program));
        let provider_cwd = match self.provider_cwd() {
            Ok(provider_cwd) => provider_cwd,
            Err(error) => return CommandProbe::scope_unavailable(error.to_string()),
        };
        let mut command = Command::new(executable);
        command.args(args);
        command.current_dir(provider_cwd.path());
        apply_provider_path(&mut command);
        if program == "copilot" {
            command.env("COPILOT_AUTO_UPDATE", "false");
        }

        match run_command_with_cancellation(command, self.remaining(), &self.cancellation) {
            Ok(output) => CommandProbe::from_output(output),
            Err(error) => CommandProbe {
                success: false,
                stdout: String::new(),
                stderr: error.to_string(),
                not_found: error.kind() == ErrorKind::NotFound,
                scope_error: None,
            },
        }
    }

    fn cache_fingerprint(&self, provider: AiProvider) -> u64 {
        discovery_cache_fingerprint(
            provider,
            provider_executable_path(provider_executable(provider), self.path_mode).as_deref(),
        )
    }

    fn codex_app_server_defaults(&self) -> CodexDefaultsProbe {
        if self.path_mode != ProviderPathMode::Deep {
            return CodexDefaultsProbe::NotAttempted;
        }
        self.codex_defaults
            .get_or_init(|| {
                match read_codex_app_server_defaults(
                    self.deadline,
                    self.cancellation.clone(),
                    self.provider_cwd_parent.as_deref(),
                ) {
                    Ok(defaults) => CodexDefaultsProbe::Success(defaults),
                    Err(error) => CodexDefaultsProbe::Failed(error),
                }
            })
            .clone()
    }

    fn claude_structured_catalog(&self) -> StructuredCatalogProbe {
        if self.path_mode != ProviderPathMode::Deep {
            return StructuredCatalogProbe::NotAttempted;
        }
        self.claude_catalog
            .get_or_init(|| {
                let Some(executable) = provider_executable_path("claude", self.path_mode) else {
                    return StructuredCatalogProbe::NotAttempted;
                };
                let version = self.run("claude", &["--version"]);
                if !version.success || !claude::version_is_supported(&version.stdout) {
                    return StructuredCatalogProbe::Failed(ProviderDiscoveryError {
                        code: ProviderDiscoveryErrorCode::Unsupported,
                        message: "This Claude Code version does not support safe model discovery."
                            .to_string(),
                        retryable: false,
                    });
                }
                match claude::discover_with_cancellation(
                    &executable,
                    self.deadline,
                    self.cancellation.clone(),
                    self.provider_cwd_parent.as_deref(),
                ) {
                    Ok(result) => StructuredCatalogProbe::Success(StructuredCatalog {
                        models: result.models,
                        cli_version: Some(version.stdout),
                    }),
                    Err(error) => StructuredCatalogProbe::Failed(error),
                }
            })
            .clone()
    }

    fn copilot_structured_catalog(&self) -> StructuredCatalogProbe {
        if self.path_mode != ProviderPathMode::Deep {
            return StructuredCatalogProbe::NotAttempted;
        }
        self.copilot_catalog
            .get_or_init(|| {
                let Some(executable) = provider_executable_path("copilot", self.path_mode) else {
                    return StructuredCatalogProbe::NotAttempted;
                };
                match copilot::discover_with_cancellation(
                    &executable,
                    self.deadline,
                    self.cancellation.clone(),
                    self.provider_cwd_parent.as_deref(),
                ) {
                    Ok(result) => StructuredCatalogProbe::Success(StructuredCatalog {
                        models: result.models,
                        cli_version: result.cli_version,
                    }),
                    Err(error) => StructuredCatalogProbe::Failed(error),
                }
            })
            .clone()
    }
}
