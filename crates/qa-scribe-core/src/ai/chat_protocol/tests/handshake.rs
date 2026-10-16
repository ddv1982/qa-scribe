use super::*;

#[test]
fn chat_duplex_claude_handshake() {
    let p = protocol(AiProvider::ClaudeCode);
    assert_eq!(p.initial_message()["type"], "control_request");
    assert_eq!(p.initial_message()["request_id"], "qa-scribe-init");
    assert_eq!(p.initial_message()["request"]["subtype"], "initialize");
    ready(AiProvider::ClaudeCode);
}

#[test]
fn chat_duplex_codex_handshake() {
    assert_eq!(
        protocol(AiProvider::CodexCli).initial_message()["method"],
        "initialize"
    );
    ready(AiProvider::CodexCli);
}

#[test]
fn chat_duplex_copilot_handshake() {
    let initial = protocol(AiProvider::CopilotCli).initial_message();
    assert_eq!(initial["method"], "initialize");
    assert_eq!(initial["params"]["protocolVersion"], 1);
    ready(AiProvider::CopilotCli);
}

#[test]
fn chat_duplex_builders_preserve_user_policy_and_keep_prompt_off_argv() {
    for provider in [
        AiProvider::ClaudeCode,
        AiProvider::CodexCli,
        AiProvider::CopilotCli,
    ] {
        let command = duplex_chat_command(
            provider,
            "private prompt",
            "chosen-model",
            Some("high"),
            true,
        )
        .unwrap();
        assert_eq!(command.output_format, GenerationOutputFormat::PlainText);
        // Internal prompt carrier: the driver serializes protocol messages,
        // never writes this value directly to the provider's stdin.
        assert_eq!(command.stdin, "private prompt");
        assert!(
            !command
                .args
                .iter()
                .any(|arg| arg.contains("private prompt"))
        );
        for forbidden in [
            "--dangerously-skip-permissions",
            "--permission-mode",
            "--sandbox",
            "--ask-for-approval",
            "--no-ask-user",
            "-s",
            "--allow-all",
            "--allow-all-tools",
            "--skip-git-repo-check",
            "--config",
        ] {
            assert!(
                !command.args.iter().any(|arg| arg == forbidden),
                "unexpected {forbidden}"
            );
        }
        match provider {
            AiProvider::ClaudeCode => {
                for flag in [
                    "--input-format",
                    "--permission-prompt-tool",
                    "--no-session-persistence",
                    "--output-format",
                    "--include-partial-messages",
                ] {
                    assert!(command.args.contains(&flag.to_owned()));
                }
                assert!(
                    command
                        .args
                        .windows(2)
                        .any(|pair| pair == ["--input-format", "stream-json"])
                );
                assert!(
                    command
                        .args
                        .windows(2)
                        .any(|pair| pair == ["--permission-prompt-tool", "stdio"])
                );
            }
            AiProvider::CodexCli => assert_eq!(
                command.args,
                ["app-server", "--enable", "tool_call_mcp_elicitation"]
            ),
            AiProvider::CopilotCli => assert_eq!(
                command.args,
                [
                    "--acp",
                    "--model",
                    "chosen-model",
                    "--reasoning-effort",
                    "high"
                ]
            ),
        }
    }
}

#[test]
fn chat_duplex_builders_preserve_validation_and_default_selection() {
    for provider in [
        AiProvider::ClaudeCode,
        AiProvider::CodexCli,
        AiProvider::CopilotCli,
    ] {
        assert!(duplex_chat_command(provider, "x", "default", Some("bad\"value"), true).is_err());
        let command =
            duplex_chat_command(provider, "x", "default", Some("unspecified"), true).unwrap();
        assert!(
            !command
                .args
                .iter()
                .any(|arg| matches!(arg.as_str(), "--model" | "--effort" | "--reasoning-effort"))
        );
    }
    assert!(
        duplex_chat_command(AiProvider::CopilotCli, "x", "default", None, false)
            .unwrap_err()
            .contains("not ready")
    );
    let command = duplex_chat_command(AiProvider::CopilotCli, "x", "auto", None, true).unwrap();
    assert_eq!(command.args, ["--acp", "--model", "auto"]);
}
