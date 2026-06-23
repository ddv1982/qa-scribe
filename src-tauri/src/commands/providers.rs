use std::{
    collections::HashMap,
    io::ErrorKind,
    process::{Command, Output},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use qa_scribe_core::{
    ai::{CopilotRuntime, ProviderCapability, provider_capabilities},
    domain::AiProvider,
};
use serde::Serialize;

use crate::provider_command::apply_provider_path;

mod models;

use models::{
    claude_models, codex_models, copilot_models, normalize_models, provider_default_model,
};

const READINESS_CACHE_TTL: Duration = Duration::from_secs(30);
static READINESS_CACHE: OnceLock<Mutex<HashMap<AiProvider, CachedProviderReadiness>>> =
    OnceLock::new();

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

#[derive(Clone, Debug)]
struct CachedProviderReadiness {
    checked_at: Instant,
    readiness: ProviderReadiness,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CommandProbe {
    success: bool,
    stdout: String,
    stderr: String,
    not_found: bool,
}

trait ProbeRunner {
    fn run(&self, program: &str, args: &[&str]) -> CommandProbe;
}

struct SystemProbeRunner;

impl ProbeRunner for SystemProbeRunner {
    fn run(&self, program: &str, args: &[&str]) -> CommandProbe {
        let mut command = Command::new(program);
        command.args(args);
        apply_provider_path(&mut command);

        match command.output() {
            Ok(output) => CommandProbe::from_output(output),
            Err(error) => CommandProbe {
                success: false,
                stdout: String::new(),
                stderr: error.to_string(),
                not_found: error.kind() == ErrorKind::NotFound,
            },
        }
    }
}

impl CommandProbe {
    fn from_output(output: Output) -> Self {
        Self {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
            not_found: false,
        }
    }

    fn failure_detail(&self) -> Option<&str> {
        if !self.stderr.is_empty() {
            Some(self.stderr.as_str())
        } else if !self.stdout.is_empty() {
            Some(self.stdout.as_str())
        } else {
            None
        }
    }
}

#[tauri::command]
pub fn get_provider_status() -> ProviderStatus {
    provider_status_with_runner(&SystemProbeRunner)
}

pub fn provider_readiness(provider: AiProvider) -> ProviderReadiness {
    let cache = READINESS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(cached) = cache.lock()
        && let Some(entry) = cached.get(&provider)
        && entry.checked_at.elapsed() < READINESS_CACHE_TTL
    {
        return entry.readiness.clone();
    }

    let readiness = detect_provider(provider, &SystemProbeRunner);
    if let Ok(mut cached) = cache.lock() {
        cached.insert(
            provider,
            CachedProviderReadiness {
                checked_at: Instant::now(),
                readiness: readiness.clone(),
            },
        );
    }
    readiness
}

fn provider_status_with_runner(runner: &impl ProbeRunner) -> ProviderStatus {
    ProviderStatus {
        providers: provider_capabilities()
            .into_iter()
            .map(|capability| detect_capability(capability, runner).descriptor)
            .collect(),
    }
}

fn detect_provider(provider: AiProvider, runner: &impl ProbeRunner) -> ProviderReadiness {
    let capability = provider_capabilities()
        .into_iter()
        .find(|capability| capability.id == provider)
        .expect("provider capability exists for every AiProvider");
    detect_capability(capability, runner)
}

fn detect_capability(
    capability: ProviderCapability,
    runner: &impl ProbeRunner,
) -> ProviderReadiness {
    match capability.id {
        AiProvider::ClaudeCode => detect_claude(capability, runner),
        AiProvider::CodexCli => detect_codex(capability, runner),
        AiProvider::CopilotCli => detect_copilot(capability, runner),
    }
}

fn detect_claude(capability: ProviderCapability, runner: &impl ProbeRunner) -> ProviderReadiness {
    let install = runner.run(capability.executable, &capability.version_args);
    if !install.success {
        return not_installed_or_error(
            capability,
            install,
            "Install Claude Code and ensure `claude` is on PATH.",
        );
    }
    let models = claude_models(runner);

    let auth = runner.run("claude", &["auth", "status", "--json"]);
    if auth.success {
        return ready(
            capability,
            "Claude Code is installed and authenticated.",
            "claude -p",
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
        models,
        None,
    )
}

fn detect_codex(capability: ProviderCapability, runner: &impl ProbeRunner) -> ProviderReadiness {
    let install = runner.run(capability.executable, &capability.version_args);
    if !install.success {
        return not_installed_or_error(
            capability,
            install,
            "Install Codex CLI and ensure `codex` is on PATH.",
        );
    }
    let models = codex_models(runner);

    let auth = runner.run("codex", &["login", "status"]);
    if auth.success {
        return ready(
            capability,
            "Codex CLI is installed and authenticated.",
            "codex exec --skip-git-repo-check -",
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
        models,
        None,
    )
}

fn detect_copilot(capability: ProviderCapability, runner: &impl ProbeRunner) -> ProviderReadiness {
    let models = copilot_models();
    let direct = runner.run("copilot", &["version"]);
    if direct.success {
        return ready(
            capability,
            "GitHub Copilot CLI is installed.",
            "copilot -s --no-ask-user",
            models,
            Some(CopilotRuntime::DirectCli),
        );
    }

    let gh_bridge = runner.run("gh", &["copilot", "--", "--help"]);
    if gh_bridge.success {
        return ready(
            capability,
            "GitHub Copilot CLI is available through the GitHub CLI bridge.",
            "gh copilot -- -s --no-ask-user",
            models,
            Some(CopilotRuntime::GhWrapper),
        );
    }

    let gh_wrapper = runner.run("gh", &["copilot", "--help"]);
    if gh_wrapper.success {
        return descriptor(
            capability,
            ProviderState::InstallRequired,
            "GitHub CLI is installed, but the Copilot CLI is not installed yet. Run `gh copilot` to install it, or install the `copilot` CLI directly.".to_string(),
            Some("gh copilot -- --help".to_string()),
            models,
            None,
        );
    }

    not_installed_or_error(
        capability,
        direct,
        "Install GitHub Copilot CLI and ensure `copilot` is on PATH.",
    )
}

fn ready(
    capability: ProviderCapability,
    reason: &str,
    command: &str,
    models: Vec<ProviderModelDescriptor>,
    copilot_runtime: Option<CopilotRuntime>,
) -> ProviderReadiness {
    descriptor(
        capability,
        ProviderState::Ready,
        reason.to_string(),
        Some(command.to_string()),
        models,
        copilot_runtime,
    )
}

fn not_installed_or_error(
    capability: ProviderCapability,
    probe: CommandProbe,
    install_message: &str,
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
        vec![provider_default_model()],
        None,
    )
}

fn descriptor(
    capability: ProviderCapability,
    status: ProviderState,
    reason: String,
    command: Option<String>,
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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[derive(Default)]
    struct MockRunner {
        probes: HashMap<String, CommandProbe>,
    }

    impl MockRunner {
        fn with(mut self, program: &str, args: &[&str], probe: CommandProbe) -> Self {
            self.probes.insert(command_key(program, args), probe);
            self
        }
    }

    impl ProbeRunner for MockRunner {
        fn run(&self, program: &str, args: &[&str]) -> CommandProbe {
            self.probes
                .get(&command_key(program, args))
                .cloned()
                .unwrap_or_else(CommandProbe::not_found)
        }
    }

    impl CommandProbe {
        fn success() -> Self {
            Self {
                success: true,
                stdout: String::new(),
                stderr: String::new(),
                not_found: false,
            }
        }

        fn success_with_stdout(stdout: &str) -> Self {
            Self {
                success: true,
                stdout: stdout.to_string(),
                stderr: String::new(),
                not_found: false,
            }
        }

        fn failed(stderr: &str) -> Self {
            Self {
                success: false,
                stdout: String::new(),
                stderr: stderr.to_string(),
                not_found: false,
            }
        }

        fn not_found() -> Self {
            Self {
                success: false,
                stdout: String::new(),
                stderr: "command not found".to_string(),
                not_found: true,
            }
        }
    }

    fn command_key(program: &str, args: &[&str]) -> String {
        if args.is_empty() {
            program.to_string()
        } else {
            format!("{} {}", program, args.join(" "))
        }
    }

    #[test]
    fn provider_status_is_local_and_reports_all_providers() {
        let runner = MockRunner::default()
            .with("claude", &["--version"], CommandProbe::success())
            .with(
                "claude",
                &["auth", "status", "--json"],
                CommandProbe::success(),
            )
            .with("codex", &["--version"], CommandProbe::success())
            .with("codex", &["login", "status"], CommandProbe::success())
            .with("copilot", &["version"], CommandProbe::success());

        let status = provider_status_with_runner(&runner);

        assert_eq!(status.providers.len(), 3);
        assert!(status.providers.iter().all(|provider| provider.local_only));
        assert!(status.providers.iter().all(|provider| provider.available));
        assert!(
            status
                .providers
                .iter()
                .all(|provider| provider.models[0].id == "default")
        );
    }

    #[test]
    fn codex_models_are_detected_from_debug_catalog() {
        let runner = MockRunner::default()
            .with("codex", &["--version"], CommandProbe::success())
            .with(
                "codex",
                &["debug", "models"],
                CommandProbe::success_with_stdout(
                    r#"{
                      "models": [
                        {
                          "slug": "gpt-5.5",
                          "display_name": "GPT-5.5",
                          "description": "Frontier model",
                          "visibility": "list",
                          "supported_reasoning_levels": [
                            {"effort": "low"},
                            {"effort": "medium"},
                            {"effort": "high"}
                          ]
                        },
                        {
                          "slug": "hidden-model",
                          "display_name": "Hidden",
                          "visibility": "hidden"
                        }
                      ]
                    }"#,
                ),
            )
            .with("codex", &["login", "status"], CommandProbe::success());

        let readiness = detect_provider(AiProvider::CodexCli, &runner);

        assert_eq!(readiness.descriptor.status, ProviderState::Ready);
        assert_eq!(readiness.descriptor.models[0].id, "default");
        let detected = readiness
            .descriptor
            .models
            .iter()
            .find(|model| model.id == "gpt-5.5")
            .expect("listed Codex model is detected");
        assert_eq!(detected.label, "GPT-5.5");
        assert_eq!(detected.source, ProviderModelSource::Detected);
        assert_eq!(detected.reasoning_efforts, vec!["low", "medium", "high"]);
        assert!(
            !readiness
                .descriptor
                .models
                .iter()
                .any(|model| model.id == "hidden-model")
        );
    }

    #[test]
    fn claude_models_are_detected_from_cli_help() {
        let runner = MockRunner::default()
            .with("claude", &["--version"], CommandProbe::success())
            .with(
                "claude",
                &["--help"],
                CommandProbe::success_with_stdout(
                    "--model <model> Model for the current session. Provide an alias for the latest model (e.g. 'sonnet' or 'opus') or a model's full name (e.g. 'claude-sonnet-4-6').",
                ),
            )
            .with(
                "claude",
                &["auth", "status", "--json"],
                CommandProbe::success(),
            );

        let readiness = detect_provider(AiProvider::ClaudeCode, &runner);
        let model_ids: Vec<&str> = readiness
            .descriptor
            .models
            .iter()
            .map(|model| model.id.as_str())
            .collect();

        assert_eq!(readiness.descriptor.status, ProviderState::Ready);
        assert!(model_ids.contains(&"default"));
        assert!(model_ids.contains(&"sonnet"));
        assert!(model_ids.contains(&"opus"));
        assert!(model_ids.contains(&"claude-sonnet-4-6"));
    }

    #[test]
    fn copilot_ignores_plain_gh_wrapper_help_false_positive() {
        let runner = MockRunner::default()
            .with("copilot", &["version"], CommandProbe::not_found())
            .with(
                "gh",
                &["copilot", "--", "--help"],
                CommandProbe::failed("! Copilot CLI not installed"),
            )
            .with("gh", &["copilot", "--help"], CommandProbe::success());

        let readiness = detect_provider(AiProvider::CopilotCli, &runner);

        assert_eq!(readiness.descriptor.status, ProviderState::InstallRequired);
        assert!(!readiness.descriptor.available);
        assert_eq!(readiness.copilot_runtime, None);
        assert!(
            readiness
                .descriptor
                .reason
                .contains("Copilot CLI is not installed yet")
        );
    }

    #[test]
    fn copilot_direct_cli_is_ready() {
        let runner = MockRunner::default().with("copilot", &["version"], CommandProbe::success());

        let readiness = detect_provider(AiProvider::CopilotCli, &runner);

        assert_eq!(readiness.descriptor.status, ProviderState::Ready);
        assert!(readiness.descriptor.available);
        assert_eq!(readiness.copilot_runtime, Some(CopilotRuntime::DirectCli));
        assert_eq!(
            readiness.descriptor.command.as_deref(),
            Some("copilot -s --no-ask-user")
        );
    }

    #[test]
    fn copilot_gh_bridge_is_ready_only_after_double_dash_probe_succeeds() {
        let runner = MockRunner::default()
            .with("copilot", &["version"], CommandProbe::not_found())
            .with("gh", &["copilot", "--", "--help"], CommandProbe::success());

        let readiness = detect_provider(AiProvider::CopilotCli, &runner);

        assert_eq!(readiness.descriptor.status, ProviderState::Ready);
        assert!(readiness.descriptor.available);
        assert_eq!(readiness.copilot_runtime, Some(CopilotRuntime::GhWrapper));
        assert_eq!(
            readiness.descriptor.command.as_deref(),
            Some("gh copilot -- -s --no-ask-user")
        );
    }

    #[test]
    fn claude_installed_but_not_authenticated_is_not_ready() {
        let runner = MockRunner::default()
            .with("claude", &["--version"], CommandProbe::success())
            .with(
                "claude",
                &["auth", "status", "--json"],
                CommandProbe::failed("not logged in"),
            );

        let readiness = detect_provider(AiProvider::ClaudeCode, &runner);

        assert_eq!(readiness.descriptor.status, ProviderState::AuthRequired);
        assert!(!readiness.descriptor.available);
        assert_eq!(readiness.copilot_runtime, None);
    }

    #[test]
    fn codex_installed_but_not_authenticated_is_not_ready() {
        let runner = MockRunner::default()
            .with("codex", &["--version"], CommandProbe::success())
            .with(
                "codex",
                &["login", "status"],
                CommandProbe::failed("not logged in"),
            );

        let readiness = detect_provider(AiProvider::CodexCli, &runner);

        assert_eq!(readiness.descriptor.status, ProviderState::AuthRequired);
        assert!(!readiness.descriptor.available);
        assert_eq!(readiness.copilot_runtime, None);
    }
}
