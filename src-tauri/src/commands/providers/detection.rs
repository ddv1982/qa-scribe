use std::path::PathBuf;

use qa_scribe_core::{
    ai::{ProviderCapability, provider_capabilities},
    domain::AiProvider,
};

use super::{
    cache::{cache_readiness, cached_readiness, retain_last_successful_discovery},
    defaults::{claude_default_snapshot, codex_default_snapshot, copilot_default_snapshot},
    models::{compatibility_models, normalize_models, provider_catalog, provider_default_model},
    probe::{CommandProbe, DetectionMode, ProbeRunner},
    rollout::provider_catalog_rollout,
    types::{
        ProviderCatalogRollout, ProviderDefaultSnapshot, ProviderDescriptor,
        ProviderDiscoveryErrorCode, ProviderModelCatalogSnapshot, ProviderModelDescriptor,
        ProviderReadiness, ProviderState,
    },
};

pub(super) fn provider_readiness_with_runners(
    provider: AiProvider,
    fast_runner: &impl ProbeRunner,
    deep_runner: &impl ProbeRunner,
) -> ProviderReadiness {
    // A cached Deep SUCCESS is authoritative for the TTL. Once it expires,
    // generation performs a fresh Deep probe so changed CLI defaults and
    // catalogs are reconciled immediately before a run.
    let deep_fingerprint = deep_runner.cache_fingerprint(provider);
    if let Some(readiness) = cached_readiness(provider, DetectionMode::Deep, deep_fingerprint)
        && readiness.descriptor.available
    {
        return readiness;
    }
    let fast_fingerprint = fast_runner.cache_fingerprint(provider);
    let fast_readiness = if let Some(readiness) =
        cached_readiness(provider, DetectionMode::Fast, fast_fingerprint)
    {
        readiness
    } else {
        let readiness = detect_provider(provider, fast_runner, DetectionMode::Fast);
        cache_readiness(provider, DetectionMode::Fast, fast_fingerprint, &readiness);
        readiness
    };

    let deep_readiness = retain_last_successful_discovery(
        provider,
        deep_fingerprint,
        detect_provider(provider, deep_runner, DetectionMode::Deep),
    );
    cache_readiness(
        provider,
        DetectionMode::Deep,
        deep_fingerprint,
        &deep_readiness,
    );
    if deep_readiness.descriptor.available || !fast_readiness.descriptor.available {
        deep_readiness
    } else {
        fast_readiness
    }
}

pub(super) fn detect_provider(
    provider: AiProvider,
    runner: &impl ProbeRunner,
    mode: DetectionMode,
) -> ProviderReadiness {
    let capability = provider_capabilities()
        .into_iter()
        .find(|capability| capability.id == provider)
        .expect("provider capability exists for every AiProvider");
    detect_capability(capability, runner, mode)
}

pub(super) fn detect_capability(
    capability: ProviderCapability,
    runner: &impl ProbeRunner,
    mode: DetectionMode,
) -> ProviderReadiness {
    match capability.id {
        AiProvider::ClaudeCode => detect_cli_provider(&CLAUDE_DESCRIPTOR, capability, runner, mode),
        AiProvider::CodexCli => detect_cli_provider(&CODEX_DESCRIPTOR, capability, runner, mode),
        AiProvider::CopilotCli => detect_copilot(capability, runner, mode),
    }
}

/// Static shape of a CLI-based provider (Claude Code, Codex CLI) whose
/// detection only differs in these strings/argv and model lookups.
/// `detect_copilot` has extra install/help-probing logic and stays bespoke.
struct CliProviderDescriptor {
    install_hint: &'static str,
    ready_command: &'static str,
    ready_reason_fast: &'static str,
    ready_reason_deep: &'static str,
    auth_args: &'static [&'static str],
    auth_command_display: &'static str,
    auth_required_reason: &'static str,
}

const CLAUDE_DESCRIPTOR: CliProviderDescriptor = CliProviderDescriptor {
    install_hint: "Install Claude Code and ensure `claude` is on PATH.",
    ready_command: "claude -p",
    ready_reason_fast: "Claude Code executable was found. Authentication will be verified when generation runs.",
    ready_reason_deep: "Claude Code is installed and authenticated.",
    auth_args: &["auth", "status", "--json"],
    auth_command_display: "claude auth status --json",
    auth_required_reason: "Claude Code is installed, but authentication is not ready. Run `claude auth status` and sign in with Claude Code.",
};

const CODEX_DESCRIPTOR: CliProviderDescriptor = CliProviderDescriptor {
    install_hint: "Install Codex CLI and ensure `codex` is on PATH.",
    ready_command: "codex exec --skip-git-repo-check -",
    ready_reason_fast: "Codex CLI executable was found. Authentication will be verified when generation runs.",
    ready_reason_deep: "Codex CLI is installed and authenticated.",
    auth_args: &["login", "status"],
    auth_command_display: "codex login status",
    auth_required_reason: "Codex CLI is installed, but authentication is not ready. Run `codex login status` or sign in with `codex login`.",
};

fn detect_cli_provider(
    descriptor: &CliProviderDescriptor,
    capability: ProviderCapability,
    runner: &dyn ProbeRunner,
    mode: DetectionMode,
) -> ProviderReadiness {
    if mode == DetectionMode::Fast {
        let catalog_snapshot = provider_catalog(capability.id, runner, mode, None);
        let models = catalog_snapshot.models.clone();
        let executable_path = runner.executable_path(capability.executable);
        if executable_path.is_none() {
            return not_installed_or_error(
                capability,
                CommandProbe::not_found(),
                descriptor.install_hint,
                None,
            );
        }
        let snapshot = default_snapshot(capability.id, runner, &models, None);
        return ready(
            capability,
            descriptor.ready_reason_fast,
            descriptor.ready_command,
            executable_path,
            models,
            catalog_snapshot,
            snapshot,
            false,
        );
    }

    let executable_path = runner.executable_path(capability.executable);
    let install = runner.run(capability.executable, &capability.version_args);
    if !install.success {
        return not_installed_or_error(
            capability,
            install,
            descriptor.install_hint,
            executable_path,
        );
    }
    let cli_version =
        (!install.stdout.trim().is_empty()).then(|| install.stdout.trim().to_string());
    let catalog_snapshot = provider_catalog(capability.id, runner, mode, cli_version.clone());
    let models = catalog_snapshot.models.clone();
    let snapshot = default_snapshot(capability.id, runner, &models, cli_version);

    let auth = runner.run(capability.executable, descriptor.auth_args);
    if auth.success {
        return ready(
            capability,
            descriptor.ready_reason_deep,
            descriptor.ready_command,
            executable_path,
            models,
            catalog_snapshot,
            snapshot,
            false,
        );
    }

    descriptor_readiness(
        capability,
        ProviderState::AuthRequired,
        descriptor.auth_required_reason.to_string(),
        Some(descriptor.auth_command_display.to_string()),
        executable_path,
        models,
        catalog_snapshot,
        snapshot,
        false,
    )
}

fn detect_copilot(
    capability: ProviderCapability,
    runner: &impl ProbeRunner,
    mode: DetectionMode,
) -> ProviderReadiness {
    let executable_path = runner.executable_path(capability.executable);
    if executable_path.is_none() {
        return not_installed_or_error(
            capability,
            CommandProbe::not_found(),
            "Install GitHub Copilot CLI and ensure `copilot` is on PATH.",
            None,
        );
    }

    let cli_version = if mode == DetectionMode::Deep {
        let version = runner.run(capability.executable, &capability.version_args);
        if !version.success {
            return not_installed_or_error(
                capability,
                version,
                "Install or update GitHub Copilot CLI and ensure `copilot` is on PATH.",
                executable_path,
            );
        }
        (!version.stdout.trim().is_empty()).then(|| version.stdout.trim().to_string())
    } else {
        None
    };
    let catalog_snapshot = provider_catalog(capability.id, runner, mode, cli_version.clone());
    let models = catalog_snapshot.models.clone();

    if mode == DetectionMode::Fast {
        return ready(
            capability,
            "GitHub Copilot CLI executable was found. Authentication will be verified when generation runs.",
            "copilot -s --no-ask-user (prompt on stdin)",
            executable_path,
            models,
            catalog_snapshot,
            copilot_default_snapshot(cli_version),
            true,
        );
    }

    let help = runner.run("copilot", &["--help"]);
    if !copilot_supports_prompt_mode(&help) {
        return descriptor_readiness(
            capability,
            ProviderState::Error,
            "GitHub Copilot CLI is installed, but this version does not expose noninteractive prompt mode. Update the standalone `copilot` CLI."
                .to_string(),
            Some("copilot update".to_string()),
            executable_path,
            models,
            catalog_snapshot,
            copilot_default_snapshot(cli_version),
            false,
        );
    }

    if catalog_snapshot
        .error
        .as_ref()
        .is_some_and(|error| error.code == ProviderDiscoveryErrorCode::AuthRequired)
    {
        return descriptor_readiness(
            capability,
            ProviderState::AuthRequired,
            "GitHub Copilot CLI is installed, but authentication is not ready. Sign in with `copilot login` and retry."
                .to_string(),
            Some("copilot login".to_string()),
            executable_path,
            models,
            catalog_snapshot,
            copilot_default_snapshot(cli_version),
            false,
        );
    }

    ready(
        capability,
        "GitHub Copilot CLI is installed and exposes noninteractive prompt mode. Authentication will be verified when generation runs.",
        "copilot -s --no-ask-user (prompt on stdin)",
        executable_path,
        models,
        catalog_snapshot,
        copilot_default_snapshot(cli_version),
        true,
    )
}

#[allow(clippy::too_many_arguments)]
fn ready(
    capability: ProviderCapability,
    reason: &str,
    command: &str,
    executable_path: Option<PathBuf>,
    models: Vec<ProviderModelDescriptor>,
    catalog_snapshot: ProviderModelCatalogSnapshot,
    default_snapshot: ProviderDefaultSnapshot,
    copilot_direct_cli_ready: bool,
) -> ProviderReadiness {
    descriptor_readiness(
        capability,
        ProviderState::Ready,
        reason.to_string(),
        Some(command.to_string()),
        executable_path,
        models,
        catalog_snapshot,
        default_snapshot,
        copilot_direct_cli_ready,
    )
}

fn copilot_supports_prompt_mode(probe: &CommandProbe) -> bool {
    if !probe.success {
        return false;
    }
    let help = format!("{}\n{}", probe.stdout, probe.stderr);
    help.contains("--prompt") || help.contains("-p,")
}

fn not_installed_or_error(
    capability: ProviderCapability,
    probe: CommandProbe,
    install_message: &str,
    executable_path: Option<PathBuf>,
) -> ProviderReadiness {
    let status = if probe.not_found {
        ProviderState::InstallRequired
    } else {
        ProviderState::Error
    };
    let reason = install_message.to_string();

    descriptor_readiness(
        capability,
        status,
        reason.clone(),
        None,
        executable_path,
        vec![provider_default_model()],
        ProviderModelCatalogSnapshot::unavailable(reason.clone()),
        ProviderDefaultSnapshot::unavailable(reason),
        false,
    )
}

#[allow(clippy::too_many_arguments)]
fn descriptor_readiness(
    capability: ProviderCapability,
    status: ProviderState,
    reason: String,
    command: Option<String>,
    _executable_path: Option<PathBuf>,
    _models: Vec<ProviderModelDescriptor>,
    mut catalog_snapshot: ProviderModelCatalogSnapshot,
    mut default_snapshot: ProviderDefaultSnapshot,
    copilot_direct_cli_ready: bool,
) -> ProviderReadiness {
    catalog_snapshot.cli_version = sanitize_cli_version(catalog_snapshot.cli_version);
    default_snapshot.cli_version = sanitize_cli_version(default_snapshot.cli_version);
    let models = if capability.id == AiProvider::CodexCli
        || provider_catalog_rollout() == ProviderCatalogRollout::Selector
        || catalog_snapshot.source != super::ProviderCatalogSource::CliCatalog
    {
        normalize_models(catalog_snapshot.models.clone())
    } else {
        compatibility_models(capability.id)
    };
    ProviderReadiness {
        descriptor: ProviderDescriptor {
            id: capability.id.as_str().to_string(),
            label: capability.label,
            status,
            available: status.is_ready(),
            reason,
            command,
            models,
            catalog_snapshot,
            default_snapshot,
            local_only: true,
        },
        copilot_direct_cli_ready,
    }
}

fn default_snapshot(
    provider: AiProvider,
    runner: &dyn ProbeRunner,
    models: &[ProviderModelDescriptor],
    cli_version: Option<String>,
) -> ProviderDefaultSnapshot {
    match provider {
        AiProvider::ClaudeCode => claude_default_snapshot(cli_version),
        AiProvider::CodexCli => codex_default_snapshot(runner, models, cli_version),
        AiProvider::CopilotCli => copilot_default_snapshot(cli_version),
    }
}

fn sanitize_cli_version(version: Option<String>) -> Option<String> {
    let value = version?;
    value
        .split_whitespace()
        .map(|part| {
            part.trim_matches(|character: char| {
                !character.is_ascii_alphanumeric() && !matches!(character, '.' | '-' | '_' | '+')
            })
        })
        .find(|part| {
            !part.is_empty()
                && part.len() <= 64
                && part.contains('.')
                && part.chars().any(|character| character.is_ascii_digit())
                && part.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_' | '+')
                })
        })
        .map(str::to_string)
}

#[cfg(test)]
mod privacy_tests {
    use super::sanitize_cli_version;

    #[test]
    fn cli_versions_are_reduced_to_a_bounded_version_token() {
        assert_eq!(
            sanitize_cli_version(Some(
                "GitHub Copilot CLI /private/path 1.0.7-preview.2 token=secret".to_string()
            )),
            Some("1.0.7-preview.2".to_string())
        );
        assert_eq!(sanitize_cli_version(Some("token=secret".to_string())), None);
    }
}
