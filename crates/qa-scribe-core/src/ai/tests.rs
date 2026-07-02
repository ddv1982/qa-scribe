use super::*;

#[test]
fn provider_capabilities_cover_supported_providers() {
    let capabilities = provider_capabilities();
    assert_eq!(capabilities.len(), 3);
    assert!(
        capabilities
            .iter()
            .any(|capability| capability.id == AiProvider::CodexCli)
    );
}

#[test]
fn codex_generation_reads_prompt_from_stdin() {
    let command =
        generation_command(AiProvider::CodexCli, "draft this", "default", None, None).unwrap();

    assert_eq!(command.program, "codex");
    assert_eq!(command.args, vec!["exec", "--skip-git-repo-check", "-"]);
    assert_eq!(command.stdin, "draft this");
    assert_eq!(command.output_format, GenerationOutputFormat::PlainText);
}

#[test]
fn codex_generation_uses_selected_model() {
    let command =
        generation_command(AiProvider::CodexCli, "draft this", "gpt-5.5", None, None).unwrap();

    assert_eq!(command.program, "codex");
    assert_eq!(
        command.args,
        vec!["exec", "--skip-git-repo-check", "--model", "gpt-5.5", "-"]
    );
    assert_eq!(command.stdin, "draft this");
}

#[test]
fn claude_generation_uses_selected_model() {
    let command =
        generation_command(AiProvider::ClaudeCode, "draft this", "sonnet", None, None).unwrap();

    assert_eq!(command.program, "claude");
    assert_eq!(command.args, vec!["-p", "--model", "sonnet"]);
    assert_eq!(command.stdin, "draft this");
}

#[test]
fn codex_generation_uses_reasoning_effort_config() {
    let command = generation_command(
        AiProvider::CodexCli,
        "draft this",
        "gpt-5.5",
        Some("low"),
        None,
    )
    .unwrap();

    assert_eq!(
        command.args,
        vec![
            "exec",
            "--skip-git-repo-check",
            "--model",
            "gpt-5.5",
            "--config",
            "model_reasoning_effort=\"low\"",
            "-"
        ]
    );
}

#[test]
fn claude_generation_uses_reasoning_effort() {
    let command = generation_command(
        AiProvider::ClaudeCode,
        "draft this",
        "sonnet",
        Some("low"),
        None,
    )
    .unwrap();

    assert_eq!(
        command.args,
        vec!["-p", "--model", "sonnet", "--effort", "low"]
    );
}

#[test]
fn copilot_auto_omits_model_argument() {
    let command = generation_command(
        AiProvider::CopilotCli,
        "draft this",
        "auto",
        None,
        Some(CopilotRuntime::DirectCli),
    )
    .unwrap();

    assert_eq!(command.program, "copilot");
    assert_eq!(command.args, vec!["-p", "-", "-s", "--no-ask-user"]);
    assert_eq!(command.stdin, "draft this");
}

#[test]
fn copilot_generation_uses_selected_model() {
    let command = generation_command(
        AiProvider::CopilotCli,
        "draft this",
        "gpt-5.5",
        None,
        Some(CopilotRuntime::DirectCli),
    )
    .unwrap();

    assert_eq!(command.program, "copilot");
    assert_eq!(
        command.args,
        vec!["-p", "-", "-s", "--no-ask-user", "--model", "gpt-5.5"]
    );
    assert_eq!(command.stdin, "draft this");
}

#[test]
fn copilot_generation_does_not_leak_prompt_into_argv() {
    let command = generation_command(
        AiProvider::CopilotCli,
        "sensitive session content",
        "default",
        None,
        Some(CopilotRuntime::DirectCli),
    )
    .unwrap();

    assert!(
        !command
            .args
            .iter()
            .any(|arg| arg.contains("sensitive session content")),
        "prompt must not appear in argv: {:?}",
        command.args
    );
    assert_eq!(command.stdin, "sensitive session content");
}

#[test]
fn streaming_codex_generation_uses_json_events() {
    let command = streaming_generation_command(
        AiProvider::CodexCli,
        "draft this",
        "gpt-5.5",
        Some("medium"),
        None,
    )
    .unwrap();

    assert_eq!(
        command.args,
        vec![
            "exec",
            "--skip-git-repo-check",
            "--json",
            "--model",
            "gpt-5.5",
            "--config",
            "model_reasoning_effort=\"medium\"",
            "-"
        ]
    );
    assert_eq!(command.output_format, GenerationOutputFormat::CodexJsonl);
}

#[test]
fn streaming_claude_generation_uses_stream_json() {
    let command = streaming_generation_command(
        AiProvider::ClaudeCode,
        "draft this",
        "sonnet",
        Some("low"),
        None,
    )
    .unwrap();

    assert_eq!(
        command.args,
        vec![
            "-p",
            "--verbose",
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--model",
            "sonnet",
            "--effort",
            "low"
        ]
    );
    assert_eq!(
        command.output_format,
        GenerationOutputFormat::ClaudeStreamJson
    );
}

#[test]
fn copilot_generation_uses_direct_cli_when_requested() {
    let command = generation_command(
        AiProvider::CopilotCli,
        "draft this",
        "default",
        None,
        Some(CopilotRuntime::DirectCli),
    )
    .unwrap();

    assert_eq!(command.program, "copilot");
    assert_eq!(command.args, vec!["-p", "-", "-s", "--no-ask-user"]);
    assert_eq!(command.stdin, "draft this");
}

#[test]
fn copilot_generation_requires_verified_runtime() {
    let error = generation_command(AiProvider::CopilotCli, "draft this", "default", None, None)
        .unwrap_err();

    assert_eq!(error, "GitHub Copilot CLI is not ready.");
}

#[test]
fn reasoning_effort_allowlist_accepts_known_values() {
    for effort in ["minimal", "low", "medium", "high"] {
        let command = generation_command(
            AiProvider::CodexCli,
            "draft this",
            "gpt-5.5",
            Some(effort),
            None,
        )
        .unwrap();

        assert!(
            command
                .args
                .contains(&format!("model_reasoning_effort=\"{effort}\""))
        );
    }
}

#[test]
fn reasoning_effort_rejects_toml_injection() {
    let error = generation_command(
        AiProvider::CodexCli,
        "draft this",
        "gpt-5.5",
        Some(r#"high" sandbox_mode="danger-full-access"#),
        None,
    )
    .unwrap_err();

    assert!(
        error.contains("reasoning effort"),
        "unexpected error: {error}"
    );
}

#[test]
fn reasoning_effort_rejects_unknown_value_for_claude() {
    let error = generation_command(
        AiProvider::ClaudeCode,
        "draft this",
        "sonnet",
        Some("extreme"),
        None,
    )
    .unwrap_err();

    assert!(
        error.contains("reasoning effort"),
        "unexpected error: {error}"
    );
}
