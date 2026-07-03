use std::path::PathBuf;

use qa_scribe_core::{
    ai::{ProviderCapability, provider_capabilities},
    domain::AiProvider,
};

use super::{
    cache::{cache_readiness, cached_readiness},
    models::{
        claude_models, claude_static_models, codex_models, codex_static_models, copilot_models,
        copilot_models_with_config_help, normalize_models, provider_default_model,
    },
    probe::{CommandProbe, DetectionMode, ProbeRunner},
    types::{ProviderDescriptor, ProviderModelDescriptor, ProviderReadiness, ProviderState},
};

pub(super) fn provider_readiness_with_runners(
    provider: AiProvider,
    fast_runner: &impl ProbeRunner,
    deep_runner: &impl ProbeRunner,
) -> ProviderReadiness {
    // A cached Deep SUCCESS (Ready) is authoritative for the TTL. A cached
    // Deep FAILURE (AuthRequired/Error/InstallRequired) is not: it must not
    // outrank a working Fast result, so it falls through to Fast detection
    // (or a fresh Deep probe) below instead of being served as truth.
    if let Some(readiness) = cached_readiness(provider, DetectionMode::Deep)
        && readiness.descriptor.available
    {
        return readiness;
    }
    if let Some(readiness) = cached_readiness(provider, DetectionMode::Fast) {
        if readiness.descriptor.available {
            return readiness;
        }
    } else {
        let readiness = detect_provider(provider, fast_runner, DetectionMode::Fast);
        cache_readiness(provider, DetectionMode::Fast, &readiness);
        if readiness.descriptor.available {
            return readiness;
        }
    }

    let readiness = detect_provider(provider, deep_runner, DetectionMode::Deep);
    cache_readiness(provider, DetectionMode::Deep, &readiness);
    readiness
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
    static_models: fn() -> Vec<ProviderModelDescriptor>,
    models: fn(&dyn ProbeRunner) -> Vec<ProviderModelDescriptor>,
}

const CLAUDE_DESCRIPTOR: CliProviderDescriptor = CliProviderDescriptor {
    install_hint: "Install Claude Code and ensure `claude` is on PATH.",
    ready_command: "claude -p",
    ready_reason_fast: "Claude Code executable was found. Authentication will be verified when generation runs.",
    ready_reason_deep: "Claude Code is installed and authenticated.",
    auth_args: &["auth", "status", "--json"],
    auth_command_display: "claude auth status --json",
    auth_required_reason: "Claude Code is installed, but authentication is not ready. Run `claude auth status` and sign in with Claude Code.",
    static_models: claude_static_models,
    models: claude_models,
};

const CODEX_DESCRIPTOR: CliProviderDescriptor = CliProviderDescriptor {
    install_hint: "Install Codex CLI and ensure `codex` is on PATH.",
    ready_command: "codex exec --skip-git-repo-check -",
    ready_reason_fast: "Codex CLI executable was found. Authentication will be verified when generation runs.",
    ready_reason_deep: "Codex CLI is installed and authenticated.",
    auth_args: &["login", "status"],
    auth_command_display: "codex login status",
    auth_required_reason: "Codex CLI is installed, but authentication is not ready. Run `codex login status` or sign in with `codex login`.",
    static_models: codex_static_models,
    models: codex_models,
};

fn detect_cli_provider(
    descriptor: &CliProviderDescriptor,
    capability: ProviderCapability,
    runner: &dyn ProbeRunner,
    mode: DetectionMode,
) -> ProviderReadiness {
    if mode == DetectionMode::Fast {
        let models = (descriptor.static_models)();
        let executable_path = runner.executable_path(capability.executable);
        if executable_path.is_none() {
            return not_installed_or_error(
                capability,
                CommandProbe::not_found(),
                descriptor.install_hint,
                None,
            );
        }
        return ready(
            capability,
            descriptor.ready_reason_fast,
            descriptor.ready_command,
            executable_path,
            models,
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
    let models = (descriptor.models)(runner);

    let auth = runner.run(capability.executable, descriptor.auth_args);
    if auth.success {
        return ready(
            capability,
            descriptor.ready_reason_deep,
            descriptor.ready_command,
            executable_path,
            models,
            false,
        );
    }

    descriptor_readiness(
        capability,
        ProviderState::AuthRequired,
        format_auth_reason(descriptor.auth_required_reason, &auth),
        Some(descriptor.auth_command_display.to_string()),
        executable_path,
        models,
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

    let models = if mode == DetectionMode::Deep {
        copilot_models_with_config_help(runner)
    } else {
        copilot_models()
    };

    if mode == DetectionMode::Fast {
        return ready(
            capability,
            "GitHub Copilot CLI executable was found. Authentication will be verified when generation runs.",
            "copilot -s --no-ask-user (prompt on stdin)",
            executable_path,
            models,
            true,
        );
    }

    let help = runner.run("copilot", &["--help"]);
    if !copilot_supports_prompt_mode(&help) {
        return descriptor_readiness(
            capability,
            ProviderState::Error,
            format_auth_reason(
                "GitHub Copilot CLI is installed, but this version does not expose noninteractive prompt mode. Update the standalone `copilot` CLI.",
                &help,
            ),
            Some("copilot update".to_string()),
            executable_path,
            models,
            false,
        );
    }

    ready(
        capability,
        "GitHub Copilot CLI is installed and exposes noninteractive prompt mode. Authentication will be verified when generation runs.",
        "copilot -s --no-ask-user (prompt on stdin)",
        executable_path,
        models,
        true,
    )
}

fn ready(
    capability: ProviderCapability,
    reason: &str,
    command: &str,
    executable_path: Option<PathBuf>,
    models: Vec<ProviderModelDescriptor>,
    copilot_direct_cli_ready: bool,
) -> ProviderReadiness {
    descriptor_readiness(
        capability,
        ProviderState::Ready,
        reason.to_string(),
        Some(command.to_string()),
        executable_path,
        models,
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
    let reason = match probe.failure_detail() {
        Some(detail) if !probe.not_found => format!("{install_message} Last error: {detail}"),
        _ => install_message.to_string(),
    };

    descriptor_readiness(
        capability,
        status,
        reason,
        None,
        executable_path,
        vec![provider_default_model()],
        false,
    )
}

fn descriptor_readiness(
    capability: ProviderCapability,
    status: ProviderState,
    reason: String,
    command: Option<String>,
    executable_path: Option<PathBuf>,
    models: Vec<ProviderModelDescriptor>,
    copilot_direct_cli_ready: bool,
) -> ProviderReadiness {
    ProviderReadiness {
        descriptor: ProviderDescriptor {
            id: capability.id.as_str().to_string(),
            label: capability.label,
            status,
            available: status.is_ready(),
            reason,
            command,
            executable_path: executable_path.map(|path| path.to_string_lossy().into_owned()),
            models: normalize_models(models),
            local_only: true,
        },
        copilot_direct_cli_ready,
    }
}

fn format_auth_reason(prefix: &str, probe: &CommandProbe) -> String {
    match probe.failure_detail() {
        Some(detail) => format!("{prefix} Last response: {detail}"),
        None => prefix.to_string(),
    }
}
