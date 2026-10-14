use super::{GenerationCommand, streaming_generation_command};
use crate::domain::AiProvider;

/// Reuses streaming generation transport with documented chat-only restrictions.
/// These argv restrictions are not a blanket process or MCP isolation guarantee.
pub fn streaming_chat_command(
    provider: AiProvider,
    prompt: &str,
    model: &str,
    reasoning_effort: Option<&str>,
    copilot_direct_cli_ready: bool,
) -> Result<GenerationCommand, String> {
    let mut command = streaming_generation_command(
        provider,
        prompt,
        model,
        reasoning_effort,
        copilot_direct_cli_ready,
    )?;
    let restrictions: &[&str] = match provider {
        // https://code.claude.com/docs/en/cli-reference
        AiProvider::ClaudeCode => &[
            "--tools",
            "",
            "--no-session-persistence",
            "--strict-mcp-config",
            "--mcp-config",
            "{\"mcpServers\":{}}",
            "--disallowedTools",
            "mcp__*",
            "--disable-slash-commands",
        ],
        // https://developers.openai.com/codex/cli/reference
        // https://developers.openai.com/codex/config-reference
        // shell_tool disables execution tools; unified_exec=false alone does not.
        // MCP servers require named per-server settings. This DTO has no server
        // inventory, so it deliberately makes no all-server disable claim.
        AiProvider::CodexCli => &[
            "--sandbox",
            "read-only",
            "--ephemeral",
            "--config",
            "features.shell_tool=false",
        ],
        // https://docs.github.com/en/copilot/reference/cli-command-reference
        // https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools
        // Empty allowlist requests no model tools; explicit permission-kind
        // denials also override saved approvals. Built-in MCP disable does not
        // disable arbitrary user-configured MCP server processes.
        AiProvider::CopilotCli => &[
            "--available-tools",
            "",
            "--deny-tool",
            "shell,read,write,url,memory",
            "--disable-builtin-mcps",
        ],
    };
    // Keep Codex's stdin positional marker last, after all added options.
    let insertion = if provider == AiProvider::CodexCli {
        command.args.len() - 1
    } else {
        command.args.len()
    };
    command.args.splice(
        insertion..insertion,
        restrictions.iter().map(|arg| (*arg).to_owned()),
    );
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::streaming_generation_command;

    #[test]
    fn chat_claude_adds_exact_restrictions_without_changing_transport() {
        let baseline = streaming_generation_command(
            AiProvider::ClaudeCode,
            "private transcript",
            "sonnet",
            Some("high"),
            false,
        )
        .unwrap();
        let chat = streaming_chat_command(
            AiProvider::ClaudeCode,
            "private transcript",
            "sonnet",
            Some("high"),
            false,
        )
        .unwrap();
        let mut expected = baseline.args.clone();
        expected.extend(
            [
                "--tools",
                "",
                "--no-session-persistence",
                "--strict-mcp-config",
                "--mcp-config",
                "{\"mcpServers\":{}}",
                "--disallowedTools",
                "mcp__*",
                "--disable-slash-commands",
            ]
            .map(str::to_owned),
        );
        assert_eq!(chat.args, expected);
        assert_eq!(chat.program, baseline.program);
        assert_eq!(chat.stdin, baseline.stdin);
        assert_eq!(chat.output_format, baseline.output_format);
        assert!(
            !chat
                .args
                .iter()
                .any(|arg| arg.contains("private transcript"))
        );
        assert!(!baseline.args.contains(&"--tools".to_owned()));
    }

    #[test]
    fn chat_ready_providers_add_supported_restrictions_without_changing_defaults() {
        // R1 supports every existing ready provider. Replace the initial
        // speculative fail-closed requirement with documented best-effort argv.
        for provider in [AiProvider::CodexCli, AiProvider::CopilotCli] {
            let baseline = streaming_generation_command(
                provider,
                "private",
                "chosen-model",
                Some("high"),
                true,
            )
            .unwrap();
            let chat =
                streaming_chat_command(provider, "private", "chosen-model", Some("high"), true)
                    .unwrap();
            let mut expected = baseline.args.clone();
            let (insertion, restrictions) = if provider == AiProvider::CodexCli {
                (
                    expected.len() - 1,
                    vec![
                        "--sandbox",
                        "read-only",
                        "--ephemeral",
                        "--config",
                        "features.shell_tool=false",
                    ],
                )
            } else {
                (
                    expected.len(),
                    vec![
                        "--available-tools",
                        "",
                        "--deny-tool",
                        "shell,read,write,url,memory",
                        "--disable-builtin-mcps",
                    ],
                )
            };
            expected.splice(
                insertion..insertion,
                restrictions.into_iter().map(str::to_owned),
            );
            assert_eq!(chat.args, expected);
            assert_eq!(chat.program, baseline.program);
            assert_eq!(chat.stdin, baseline.stdin);
            assert_eq!(chat.output_format, baseline.output_format);
            assert!(!chat.args.iter().any(|arg| arg.contains("private")));
            assert!(!baseline.args.iter().any(|arg| matches!(
                arg.as_str(),
                "--sandbox"
                    | "--ephemeral"
                    | "--available-tools"
                    | "--deny-tool"
                    | "--disable-builtin-mcps"
            )));
        }
    }

    #[test]
    fn chat_preserves_reasoning_validation_and_copilot_readiness_errors() {
        assert!(
            streaming_chat_command(
                AiProvider::ClaudeCode,
                "x",
                "default",
                Some("bad\"value"),
                false
            )
            .is_err()
        );
        let error = streaming_chat_command(AiProvider::CopilotCli, "x", "default", None, false)
            .unwrap_err();
        assert!(error.contains("not ready"));
    }
}
