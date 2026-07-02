use std::path::PathBuf;

use qa_scribe_core::{
    ai::{CopilotRuntime, ProviderCapability, provider_capabilities},
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
    if let Some(readiness) = cached_readiness(provider, DetectionMode::Deep) {
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
        AiProvider::ClaudeCode => detect_claude(capability, runner, mode),
        AiProvider::CodexCli => detect_codex(capability, runner, mode),
        AiProvider::CopilotCli => detect_copilot(capability, runner, mode),
    }
}

fn detect_claude(
    capability: ProviderCapability,
    runner: &impl ProbeRunner,
    mode: DetectionMode,
) -> ProviderReadiness {
    if mode == DetectionMode::Fast {
        let models = claude_static_models();
        let executable_path = runner.executable_path(capability.executable);
        if executable_path.is_none() {
            return not_installed_or_error(
                capability,
                CommandProbe::not_found(),
                "Install Claude Code and ensure `claude` is on PATH.",
                None,
            );
        }
        return ready(
            capability,
            "Claude Code executable was found. Authentication will be verified when generation runs.",
            "claude -p",
            executable_path,
            models,
            None,
        );
    }

    let executable_path = runner.executable_path(capability.executable);
    let install = runner.run(capability.executable, &capability.version_args);
    if !install.success {
        return not_installed_or_error(
            capability,
            install,
            "Install Claude Code and ensure `claude` is on PATH.",
            executable_path,
        );
    }
    let models = claude_models(runner);

    let auth = runner.run("claude", &["auth", "status", "--json"]);
    if auth.success {
        return ready(
            capability,
            "Claude Code is installed and authenticated.",
            "claude -p",
            executable_path,
            models,
            None,
        );
    }

    descriptor(
        capability,
        ProviderState::AuthRequired,
        format_auth_reason(
            "Claude Code is installed, but authentication is not ready. Run `claude auth status` and sign in with Claude Code.",
            &auth,
        ),
        Some("claude auth status --json".to_string()),
        executable_path,
        models,
        None,
    )
}

fn detect_codex(
    capability: ProviderCapability,
    runner: &impl ProbeRunner,
    mode: DetectionMode,
) -> ProviderReadiness {
    if mode == DetectionMode::Fast {
        let models = codex_static_models();
        let executable_path = runner.executable_path(capability.executable);
        if executable_path.is_none() {
            return not_installed_or_error(
                capability,
                CommandProbe::not_found(),
                "Install Codex CLI and ensure `codex` is on PATH.",
                None,
            );
        }
        return ready(
            capability,
            "Codex CLI executable was found. Authentication will be verified when generation runs.",
            "codex exec --skip-git-repo-check -",
            executable_path,
            models,
            None,
        );
    }

    let executable_path = runner.executable_path(capability.executable);
    let install = runner.run(capability.executable, &capability.version_args);
    if !install.success {
        return not_installed_or_error(
            capability,
            install,
            "Install Codex CLI and ensure `codex` is on PATH.",
            executable_path,
        );
    }
    let models = codex_models(runner);

    let auth = runner.run("codex", &["login", "status"]);
    if auth.success {
        return ready(
            capability,
            "Codex CLI is installed and authenticated.",
            "codex exec --skip-git-repo-check -",
            executable_path,
            models,
            None,
        );
    }

    descriptor(
        capability,
        ProviderState::AuthRequired,
        format_auth_reason(
            "Codex CLI is installed, but authentication is not ready. Run `codex login status` or sign in with `codex login`.",
            &auth,
        ),
        Some("codex login status".to_string()),
        executable_path,
        models,
        None,
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
            Some(CopilotRuntime::DirectCli),
        );
    }

    let help = runner.run("copilot", &["--help"]);
    if !copilot_supports_prompt_mode(&help) {
        return descriptor(
            capability,
            ProviderState::Error,
            format_auth_reason(
                "GitHub Copilot CLI is installed, but this version does not expose noninteractive prompt mode. Update the standalone `copilot` CLI.",
                &help,
            ),
            Some("copilot update".to_string()),
            executable_path,
            models,
            None,
        );
    }

    ready(
        capability,
        "GitHub Copilot CLI is installed and exposes noninteractive prompt mode. Authentication will be verified when generation runs.",
        "copilot -s --no-ask-user (prompt on stdin)",
        executable_path,
        models,
        Some(CopilotRuntime::DirectCli),
    )
}

fn ready(
    capability: ProviderCapability,
    reason: &str,
    command: &str,
    executable_path: Option<PathBuf>,
    models: Vec<ProviderModelDescriptor>,
    copilot_runtime: Option<CopilotRuntime>,
) -> ProviderReadiness {
    descriptor(
        capability,
        ProviderState::Ready,
        reason.to_string(),
        Some(command.to_string()),
        executable_path,
        models,
        copilot_runtime,
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

    descriptor(
        capability,
        status,
        reason,
        None,
        executable_path,
        vec![provider_default_model()],
        None,
    )
}

fn descriptor(
    capability: ProviderCapability,
    status: ProviderState,
    reason: String,
    command: Option<String>,
    executable_path: Option<PathBuf>,
    models: Vec<ProviderModelDescriptor>,
    copilot_runtime: Option<CopilotRuntime>,
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
        copilot_runtime,
    }
}

fn format_auth_reason(prefix: &str, probe: &CommandProbe) -> String {
    match probe.failure_detail() {
        Some(detail) => format!("{prefix} Last response: {detail}"),
        None => prefix.to_string(),
    }
}
