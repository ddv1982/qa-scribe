use std::{
    collections::HashMap,
    fs,
    io::ErrorKind,
    process::{Command, Output, Stdio},
    sync::{
        Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use qa_scribe_core::{
    ai::{CopilotRuntime, ProviderCapability, provider_capabilities},
    domain::AiProvider,
};
use serde::Serialize;

use crate::provider_command::{apply_provider_path, provider_executable_exists};

mod models;

use models::{
    claude_models, claude_static_models, codex_models, codex_static_models, copilot_models,
    copilot_models_with_config_help, normalize_models, provider_default_model,
};

const READINESS_CACHE_TTL: Duration = Duration::from_secs(30);
const PROVIDER_PROBE_TIMEOUT: Duration = Duration::from_secs(4);
static READINESS_CACHE: OnceLock<Mutex<HashMap<ReadinessCacheKey, CachedProviderReadiness>>> =
    OnceLock::new();
static PROVIDER_PROBE_OUTPUT_COUNTER: AtomicU64 = AtomicU64::new(0);

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

#[derive(Clone, Debug)]
struct CachedProviderReadiness {
    checked_at: Instant,
    readiness: ProviderReadiness,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
enum DetectionMode {
    Fast,
    Deep,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct ReadinessCacheKey {
    provider: AiProvider,
    mode: DetectionMode,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CommandProbe {
    success: bool,
    stdout: String,
    stderr: String,
    not_found: bool,
}

trait ProbeRunner {
    fn has_executable(&self, program: &str) -> bool;
    fn run(&self, program: &str, args: &[&str]) -> CommandProbe;
}

struct SystemProbeRunner;

impl ProbeRunner for SystemProbeRunner {
    fn has_executable(&self, program: &str) -> bool {
        provider_executable_exists(program)
    }

    fn run(&self, program: &str, args: &[&str]) -> CommandProbe {
        let mut command = Command::new(program);
        command.args(args);
        apply_provider_path(&mut command);
        if program == "copilot" {
            command.env("COPILOT_AUTO_UPDATE", "false");
        }

        match run_command_with_timeout(command, PROVIDER_PROBE_TIMEOUT) {
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

fn run_command_with_timeout(mut command: Command, timeout: Duration) -> std::io::Result<Output> {
    let output_id = PROVIDER_PROBE_OUTPUT_COUNTER.fetch_add(1, Ordering::Relaxed);
    let stdout_path = std::env::temp_dir().join(format!(
        "qa-scribe-provider-probe-{}-{output_id}.stdout",
        std::process::id()
    ));
    let stderr_path = std::env::temp_dir().join(format!(
        "qa-scribe-provider-probe-{}-{output_id}.stderr",
        std::process::id()
    ));
    let stdout = fs::File::create(&stdout_path)?;
    let stderr = fs::File::create(&stderr_path)?;
    let mut child = command
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()?;
    let started_at = Instant::now();

    loop {
        if let Some(status) = child.try_wait()? {
            let stdout = fs::read(&stdout_path)?;
            let stderr = fs::read(&stderr_path)?;
            let _ = fs::remove_file(&stdout_path);
            let _ = fs::remove_file(&stderr_path);
            return Ok(Output {
                status,
                stdout,
                stderr,
            });
        }

        if started_at.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_file(&stdout_path);
            let _ = fs::remove_file(&stderr_path);
            return Err(std::io::Error::new(
                ErrorKind::TimedOut,
                format!("provider probe timed out after {}s", timeout.as_secs()),
            ));
        }

        thread::sleep(Duration::from_millis(25));
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

    fn not_found() -> Self {
        Self {
            success: false,
            stdout: String::new(),
            stderr: "command not found".to_string(),
            not_found: true,
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
    provider_status_with_system_runner()
}

#[tauri::command]
pub fn refresh_provider_status() -> ProviderStatus {
    clear_readiness_cache();
    provider_status_with_system_runner_for_mode(DetectionMode::Deep)
}

fn clear_readiness_cache() {
    if let Some(cache) = READINESS_CACHE.get()
        && let Ok(mut cache) = cache.lock()
    {
        cache.clear();
    }
}

pub fn provider_readiness(provider: AiProvider) -> ProviderReadiness {
    if let Some(readiness) = cached_readiness(provider, DetectionMode::Deep) {
        return readiness;
    }
    if let Some(readiness) = cached_readiness(provider, DetectionMode::Fast) {
        return readiness;
    }

    let readiness = detect_provider(provider, &SystemProbeRunner, DetectionMode::Fast);
    cache_readiness(provider, DetectionMode::Fast, &readiness);
    readiness
}

fn cached_readiness(provider: AiProvider, mode: DetectionMode) -> Option<ProviderReadiness> {
    let cache = READINESS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(cached) = cache.lock()
        && let Some(entry) = cached.get(&ReadinessCacheKey { provider, mode })
        && entry.checked_at.elapsed() < READINESS_CACHE_TTL
    {
        return Some(entry.readiness.clone());
    }
    None
}

#[cfg(test)]
fn provider_status_with_runner(runner: &impl ProbeRunner, mode: DetectionMode) -> ProviderStatus {
    ProviderStatus {
        providers: provider_capabilities()
            .into_iter()
            .map(|capability| detect_capability(capability, runner, mode).descriptor)
            .collect(),
    }
}

fn provider_status_with_system_runner() -> ProviderStatus {
    provider_status_with_system_runner_for_mode(DetectionMode::Fast)
}

fn provider_status_with_system_runner_for_mode(mode: DetectionMode) -> ProviderStatus {
    let readinesses: Vec<_> = provider_capabilities()
        .into_iter()
        .map(|capability| {
            let provider = capability.id;
            (
                provider,
                detect_capability(capability, &SystemProbeRunner, mode),
            )
        })
        .collect();
    cache_readinesses(mode, &readinesses);

    ProviderStatus {
        providers: readinesses
            .into_iter()
            .map(|(_, readiness)| readiness.descriptor)
            .collect(),
    }
}

fn cache_readinesses(mode: DetectionMode, readinesses: &[(AiProvider, ProviderReadiness)]) {
    for (provider, readiness) in readinesses {
        cache_readiness(*provider, mode, readiness);
    }
}

fn cache_readiness(provider: AiProvider, mode: DetectionMode, readiness: &ProviderReadiness) {
    let cache = READINESS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut cache) = cache.lock() {
        cache.insert(
            ReadinessCacheKey { provider, mode },
            CachedProviderReadiness {
                checked_at: Instant::now(),
                readiness: readiness.clone(),
            },
        );
    }
}

fn detect_provider(
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

fn detect_capability(
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
        if !runner.has_executable(capability.executable) {
            return not_installed_or_error(
                capability,
                CommandProbe::not_found(),
                "Install Claude Code and ensure `claude` is on PATH.",
            );
        }
        return ready(
            capability,
            "Claude Code executable was found. Authentication will be verified when generation runs.",
            "claude -p",
            models,
            None,
        );
    }

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

fn detect_codex(
    capability: ProviderCapability,
    runner: &impl ProbeRunner,
    mode: DetectionMode,
) -> ProviderReadiness {
    if mode == DetectionMode::Fast {
        let models = codex_static_models();
        if !runner.has_executable(capability.executable) {
            return not_installed_or_error(
                capability,
                CommandProbe::not_found(),
                "Install Codex CLI and ensure `codex` is on PATH.",
            );
        }
        return ready(
            capability,
            "Codex CLI executable was found. Authentication will be verified when generation runs.",
            "codex exec --skip-git-repo-check -",
            models,
            None,
        );
    }

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

fn detect_copilot(
    capability: ProviderCapability,
    runner: &impl ProbeRunner,
    mode: DetectionMode,
) -> ProviderReadiness {
    let executable_found = runner.has_executable(capability.executable);
    if !executable_found {
        return not_installed_or_error(
            capability,
            CommandProbe::not_found(),
            "Install GitHub Copilot CLI and ensure `copilot` is on PATH.",
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
            "copilot -p <prompt> -s --no-ask-user",
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
            models,
            None,
        );
    }

    ready(
        capability,
        "GitHub Copilot CLI is installed and exposes noninteractive prompt mode. Authentication will be verified when generation runs.",
        "copilot -p <prompt> -s --no-ask-user",
        models,
        Some(CopilotRuntime::DirectCli),
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
    use std::{
        cell::RefCell,
        collections::{HashMap, HashSet},
    };

    use super::*;

    #[derive(Default)]
    struct MockRunner {
        executables: HashSet<String>,
        probes: HashMap<String, CommandProbe>,
        calls: RefCell<Vec<String>>,
    }

    impl MockRunner {
        fn with_executable(mut self, program: &str) -> Self {
            self.executables.insert(program.to_string());
            self
        }

        fn with(mut self, program: &str, args: &[&str], probe: CommandProbe) -> Self {
            if probe.success {
                self.executables.insert(program.to_string());
            }
            self.probes.insert(command_key(program, args), probe);
            self
        }

        fn calls(&self) -> Vec<String> {
            self.calls.borrow().clone()
        }
    }

    impl ProbeRunner for MockRunner {
        fn has_executable(&self, program: &str) -> bool {
            self.executables.contains(program)
        }

        fn run(&self, program: &str, args: &[&str]) -> CommandProbe {
            self.calls.borrow_mut().push(command_key(program, args));
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
    }

    fn copilot_prompt_help() -> CommandProbe {
        CommandProbe::success_with_stdout(
            "Usage: copilot [options]\n  -p, --prompt <prompt> Execute a prompt in non-interactive mode",
        )
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
            .with_executable("claude")
            .with_executable("codex")
            .with_executable("copilot");

        let status = provider_status_with_runner(&runner, DetectionMode::Fast);

        assert_eq!(status.providers.len(), 3);
        assert!(status.providers.iter().all(|provider| provider.local_only));
        assert!(status.providers.iter().all(|provider| provider.available));
        assert!(
            status
                .providers
                .iter()
                .all(|provider| provider.models[0].id == "default")
        );
        assert!(runner.calls().is_empty());
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
                          "slug": "gpt-6-test",
                          "display_name": "GPT-6 Test",
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

        let readiness = detect_provider(AiProvider::CodexCli, &runner, DetectionMode::Deep);

        assert_eq!(readiness.descriptor.status, ProviderState::Ready);
        assert_eq!(readiness.descriptor.models[0].id, "default");
        let detected = readiness
            .descriptor
            .models
            .iter()
            .find(|model| model.id == "gpt-6-test")
            .expect("listed Codex model is detected");
        assert_eq!(detected.label, "GPT-6 Test");
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
    fn codex_static_presets_exclude_codex_and_fast_variants() {
        let runner = MockRunner::default()
            .with("codex", &["--version"], CommandProbe::success())
            .with("codex", &["login", "status"], CommandProbe::success());

        let readiness = detect_provider(AiProvider::CodexCli, &runner, DetectionMode::Deep);
        let preset_ids: Vec<&str> = readiness
            .descriptor
            .models
            .iter()
            .filter(|model| model.source == ProviderModelSource::Preset)
            .map(|model| model.id.as_str())
            .collect();

        assert!(preset_ids.contains(&"gpt-5.5"));
        assert!(preset_ids.contains(&"gpt-5.4"));
        assert!(preset_ids.contains(&"gpt-5.2"));
        assert!(preset_ids.iter().all(|model| !model.contains("-codex")));
        assert!(preset_ids.iter().all(|model| !model.contains("fast")));
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

        let readiness = detect_provider(AiProvider::ClaudeCode, &runner, DetectionMode::Deep);
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
    fn copilot_install_detection_ignores_gh_copilot() {
        let runner = MockRunner::default()
            .with_executable("gh")
            .with(
                "gh",
                &["copilot", "--", "--help"],
                CommandProbe::failed("! Copilot CLI not installed"),
            )
            .with("gh", &["copilot", "--help"], CommandProbe::success());

        let readiness = detect_provider(AiProvider::CopilotCli, &runner, DetectionMode::Deep);

        assert_eq!(readiness.descriptor.status, ProviderState::InstallRequired);
        assert!(!readiness.descriptor.available);
        assert_eq!(readiness.copilot_runtime, None);
        assert!(
            readiness
                .descriptor
                .reason
                .contains("Install GitHub Copilot CLI")
        );
        assert!(runner.calls().is_empty());
    }

    #[test]
    fn copilot_fast_detection_is_ready_without_cli_process() {
        let runner = MockRunner::default().with_executable("copilot");

        let readiness = detect_provider(AiProvider::CopilotCli, &runner, DetectionMode::Fast);

        assert_eq!(readiness.descriptor.status, ProviderState::Ready);
        assert!(readiness.descriptor.available);
        assert_eq!(readiness.copilot_runtime, Some(CopilotRuntime::DirectCli));
        assert_eq!(
            readiness.descriptor.command.as_deref(),
            Some("copilot -p <prompt> -s --no-ask-user")
        );
        assert!(readiness.descriptor.reason.contains("executable was found"));
        assert!(runner.calls().is_empty());
    }

    #[test]
    fn copilot_deep_detection_checks_prompt_support_without_prompt_probe() {
        let runner = MockRunner::default().with_executable("copilot").with(
            "copilot",
            &["--help"],
            copilot_prompt_help(),
        );

        let readiness = detect_provider(AiProvider::CopilotCli, &runner, DetectionMode::Deep);

        assert_eq!(readiness.descriptor.status, ProviderState::Ready);
        assert!(readiness.descriptor.available);
        assert_eq!(readiness.copilot_runtime, Some(CopilotRuntime::DirectCli));
        assert!(runner.calls().contains(&"copilot help config".to_string()));
        assert!(runner.calls().contains(&"copilot --help".to_string()));
        assert!(!runner.calls().contains(&"copilot version".to_string()));
        assert!(
            !runner
                .calls()
                .iter()
                .any(|call| call.starts_with("copilot -p "))
        );
        assert!(!runner.calls().iter().any(|call| call.starts_with("gh ")));
    }

    #[test]
    fn copilot_direct_cli_without_prompt_mode_is_not_ready() {
        let runner = MockRunner::default().with_executable("copilot").with(
            "copilot",
            &["--help"],
            CommandProbe::success_with_stdout("Usage: copilot [options]\n  --interactive <prompt>"),
        );

        let readiness = detect_provider(AiProvider::CopilotCli, &runner, DetectionMode::Deep);

        assert_eq!(readiness.descriptor.status, ProviderState::Error);
        assert!(!readiness.descriptor.available);
        assert_eq!(readiness.copilot_runtime, None);
        assert_eq!(
            readiness.descriptor.command.as_deref(),
            Some("copilot update")
        );
    }

    #[test]
    fn copilot_models_merge_presets_and_detected_config_help() {
        let runner = MockRunner::default()
            .with_executable("copilot")
            .with("copilot", &["--help"], copilot_prompt_help())
            .with(
                "copilot",
                &["help", "config"],
                CommandProbe::success_with_stdout(
                    r#"
`model`: AI model to use for Copilot CLI; can be changed with /model command or --model flag option.
  - "claude-sonnet-4.6"
  - "gpt-5.5"
  - "gpt-5.3-codex"
  - "claude-opus-4.6-fast"
  - "gemini-3.5-flash"

`contextTier`: context window tier for tiered-pricing models.
  - "default"
  - "long_context"
"#,
                ),
            );

        let readiness = detect_provider(AiProvider::CopilotCli, &runner, DetectionMode::Deep);
        let models = &readiness.descriptor.models;

        assert_eq!(models[0].id, "default");
        assert_eq!(models[1].id, "auto");
        assert_eq!(models[1].source, ProviderModelSource::Preset);
        assert_eq!(
            models
                .iter()
                .find(|model| model.id == "gpt-5.5")
                .expect("detected GPT model remains available")
                .source,
            ProviderModelSource::Detected
        );
        assert_eq!(
            models
                .iter()
                .find(|model| model.id == "gpt-5.3-codex")
                .expect("detected codex variant remains available")
                .source,
            ProviderModelSource::Detected
        );
        assert_eq!(
            models
                .iter()
                .find(|model| model.id == "claude-opus-4.6-fast")
                .expect("detected fast variant remains available")
                .source,
            ProviderModelSource::Detected
        );
        assert!(!runner.calls().contains(&"copilot version".to_string()));
        assert!(
            !runner
                .calls()
                .iter()
                .any(|call| call.starts_with("copilot -p "))
        );
        assert!(!runner.calls().iter().any(|call| call.starts_with("gh ")));
    }

    #[test]
    fn retired_gh_copilot_extension_is_not_a_runtime_fallback() {
        let runner = MockRunner::default();

        let readiness = detect_provider(AiProvider::CopilotCli, &runner, DetectionMode::Deep);

        assert_eq!(readiness.descriptor.status, ProviderState::InstallRequired);
        assert!(!readiness.descriptor.available);
        assert_eq!(readiness.copilot_runtime, None);
        assert_eq!(readiness.descriptor.command.as_deref(), None);
        assert!(
            readiness
                .descriptor
                .reason
                .contains("Install GitHub Copilot CLI")
        );
        assert!(runner.calls().is_empty());
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

        let readiness = detect_provider(AiProvider::ClaudeCode, &runner, DetectionMode::Deep);

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

        let readiness = detect_provider(AiProvider::CodexCli, &runner, DetectionMode::Deep);

        assert_eq!(readiness.descriptor.status, ProviderState::AuthRequired);
        assert!(!readiness.descriptor.available);
        assert_eq!(readiness.copilot_runtime, None);
    }
}
