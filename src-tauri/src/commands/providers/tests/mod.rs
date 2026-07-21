use std::{fs, path::PathBuf, process::Command, time::Duration};

#[cfg(unix)]
use std::thread;

use qa_scribe_core::domain::AiProvider;

use super::{
    ProviderDiscoveryError, ProviderDiscoveryErrorCode, ProviderModelSource, ProviderState,
    detection::detect_provider,
    probe::{
        CommandProbe, DetectionMode, ProbeOutputFiles, ProbeRunner, StructuredCatalogProbe,
        SystemProbeRunner, run_command_with_timeout,
    },
    provider_status_with_runner,
};

mod precedence;
mod support;

use support::{MockRunner, copilot_prompt_help};

#[cfg(unix)]
#[test]
fn provider_probe_timeout_kills_descendant_processes() {
    let marker = std::env::temp_dir().join(format!(
        "qa-scribe-provider-probe-descendant-{}-{}",
        std::process::id(),
        "marker"
    ));
    let _ = fs::remove_file(&marker);

    let mut command = Command::new("sh");
    command
        .arg("-c")
        .arg("(sleep 1; printf alive > \"$1\") & sleep 120")
        .arg("sh")
        .arg(&marker);

    let error = run_command_with_timeout(command, Duration::from_millis(250))
        .expect_err("probe should time out");
    assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);

    thread::sleep(Duration::from_millis(1_500));
    assert!(
        !marker.exists(),
        "timed-out provider probe should kill background descendants"
    );
    let _ = fs::remove_file(marker);
}

#[test]
fn provider_probe_output_files_are_created_exclusively() {
    let output_files = ProbeOutputFiles::new();
    fs::create_dir(
        output_files
            .stdout_path
            .parent()
            .expect("probe output should have a parent directory"),
    )
    .expect("sentinel directory should create");
    fs::write(&output_files.stdout_path, b"do not truncate").expect("sentinel file should write");

    let error = output_files
        .create()
        .expect_err("existing probe output file must not be truncated");

    assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
    assert_eq!(
        fs::read(&output_files.stdout_path).expect("sentinel should still read"),
        b"do not truncate"
    );
}

#[test]
fn generic_provider_probes_run_outside_the_repository() {
    let runner = SystemProbeRunner::new(crate::provider_command::ProviderPathMode::Deep);
    let probe = runner.run("sh", &["-c", "pwd"]);

    assert!(probe.success);
    let probe_directory = PathBuf::from(probe.stdout);
    assert_ne!(probe_directory, std::env::current_dir().unwrap());
    assert!(
        !probe_directory.exists(),
        "the neutral provider directory should be removed after the probe"
    );
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
fn provider_status_dto_omits_local_path_fields() {
    let runner = MockRunner::default()
        .with_executable("claude")
        .with_executable("codex")
        .with_executable("copilot");
    let status = provider_status_with_runner(&runner, DetectionMode::Fast);
    let serialized = serde_json::to_string(&status).expect("provider status should serialize");

    assert!(!serialized.contains("executablePath"));
    assert!(!serialized.contains("technicalPath"));
    assert!(!serialized.contains("/mock/bin"));
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
    assert_eq!(detected.source, ProviderModelSource::CliHelp);
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
    assert!(!readiness.copilot_direct_cli_ready);
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
    assert!(readiness.copilot_direct_cli_ready);
    assert_eq!(
        readiness.descriptor.command.as_deref(),
        Some("copilot -s --no-ask-user (prompt on stdin)")
    );
    assert!(readiness.descriptor.reason.contains("executable was found"));
    assert!(runner.calls().is_empty());
}

#[test]
fn copilot_deep_detection_checks_prompt_support_without_prompt_probe() {
    let runner = MockRunner::default()
        .with(
            "copilot",
            &["version"],
            CommandProbe::success_with_stdout("1.0.70"),
        )
        .with("copilot", &["--help"], copilot_prompt_help());

    let readiness = detect_provider(AiProvider::CopilotCli, &runner, DetectionMode::Deep);

    assert_eq!(readiness.descriptor.status, ProviderState::Ready);
    assert!(readiness.descriptor.available);
    assert!(readiness.copilot_direct_cli_ready);
    assert!(runner.calls().contains(&"copilot --help".to_string()));
    assert!(runner.calls().contains(&"copilot version".to_string()));
    assert!(
        !runner
            .calls()
            .iter()
            .any(|call| call.starts_with("copilot -p "))
    );
    assert!(!runner.calls().iter().any(|call| call.starts_with("gh ")));
}

#[test]
fn copilot_readiness_reuses_the_catalog_auth_observation() {
    let runner = MockRunner::default()
        .with(
            "copilot",
            &["version"],
            CommandProbe::success_with_stdout("1.0.70"),
        )
        .with("copilot", &["--help"], copilot_prompt_help())
        .with_copilot_catalog(StructuredCatalogProbe::Failed(ProviderDiscoveryError {
            code: ProviderDiscoveryErrorCode::AuthRequired,
            message: "synthetic auth detail that must not escape".to_string(),
            retryable: false,
        }));

    let readiness = detect_provider(AiProvider::CopilotCli, &runner, DetectionMode::Deep);

    assert_eq!(readiness.descriptor.status, ProviderState::AuthRequired);
    assert_eq!(runner.copilot_catalog_calls(), 1);
    assert!(!readiness.descriptor.reason.contains("synthetic"));
}

#[test]
fn copilot_direct_cli_without_prompt_mode_is_not_ready() {
    let runner = MockRunner::default()
        .with(
            "copilot",
            &["version"],
            CommandProbe::success_with_stdout("1.0.70"),
        )
        .with(
            "copilot",
            &["--help"],
            CommandProbe::success_with_stdout("Usage: copilot [options]\n  --interactive <prompt>"),
        );

    let readiness = detect_provider(AiProvider::CopilotCli, &runner, DetectionMode::Deep);

    assert_eq!(readiness.descriptor.status, ProviderState::Error);
    assert!(!readiness.descriptor.available);
    assert!(!readiness.copilot_direct_cli_ready);
    assert_eq!(
        readiness.descriptor.command.as_deref(),
        Some("copilot update")
    );
}

#[test]
fn copilot_models_merge_presets_and_detected_config_help() {
    let runner = MockRunner::default()
        .with(
            "copilot",
            &["version"],
            CommandProbe::success_with_stdout("1.0.70"),
        )
        .with("copilot", &["--help"], copilot_prompt_help());

    let readiness = detect_provider(AiProvider::CopilotCli, &runner, DetectionMode::Deep);
    let models = &readiness.descriptor.models;

    assert_eq!(models[0].id, "default");
    assert_eq!(models[1].id, "auto");
    assert_eq!(models[1].source, ProviderModelSource::ProviderDefault);
    assert_eq!(
        models
            .iter()
            .find(|model| model.id == "gpt-5.5")
            .expect("detected GPT model remains available")
            .source,
        ProviderModelSource::CliHelp
    );
    assert_eq!(
        models
            .iter()
            .find(|model| model.id == "gpt-5.3-codex")
            .expect("detected codex variant remains available")
            .source,
        ProviderModelSource::CliHelp
    );
    assert_eq!(
        models
            .iter()
            .find(|model| model.id == "claude-opus-4.6-fast")
            .expect("detected fast variant remains available")
            .source,
        ProviderModelSource::CliHelp
    );
    assert!(runner.calls().contains(&"copilot version".to_string()));
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
    assert!(!readiness.copilot_direct_cli_ready);
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
    assert!(!readiness.copilot_direct_cli_ready);
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
    assert!(!readiness.copilot_direct_cli_ready);
}
