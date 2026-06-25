use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    path::PathBuf,
};

use qa_scribe_core::{ai::CopilotRuntime, domain::AiProvider};

use super::{
    ProviderModelSource, ProviderState,
    cache::clear_readiness_cache,
    detection::{detect_provider, provider_readiness_with_runners},
    probe::{CommandProbe, DetectionMode, ProbeRunner},
    provider_status_with_runner,
};

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
    fn executable_path(&self, program: &str) -> Option<PathBuf> {
        self.executables
            .contains(program)
            .then(|| PathBuf::from(format!("/mock/bin/{program}")))
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
    assert_eq!(
        status
            .providers
            .iter()
            .find(|provider| provider.id == "codex_cli")
            .and_then(|provider| provider.executable_path.as_deref()),
        Some("/mock/bin/codex")
    );
    assert!(runner.calls().is_empty());
}

#[test]
fn provider_readiness_deep_checks_when_fast_detection_misses() {
    clear_readiness_cache();
    let fast_runner = MockRunner::default();
    let deep_runner = MockRunner::default()
        .with("codex", &["--version"], CommandProbe::success())
        .with("codex", &["login", "status"], CommandProbe::success());

    let readiness =
        provider_readiness_with_runners(AiProvider::CodexCli, &fast_runner, &deep_runner);

    assert_eq!(readiness.descriptor.status, ProviderState::Ready);
    assert_eq!(
        readiness.descriptor.executable_path.as_deref(),
        Some("/mock/bin/codex")
    );
    assert!(fast_runner.calls().is_empty());
    assert!(deep_runner.calls().contains(&"codex --version".to_string()));
    assert!(
        deep_runner
            .calls()
            .contains(&"codex login status".to_string())
    );
    clear_readiness_cache();
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
        .with("claude", &["auth", "status", "--json"], CommandProbe::success());

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
