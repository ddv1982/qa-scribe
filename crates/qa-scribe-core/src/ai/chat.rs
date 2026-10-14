use super::{GenerationCommand, streaming_generation_command};
use crate::domain::AiProvider;

/// Duplex commands produce normalized text through the chat protocol driver.
pub fn duplex_chat_command(
    provider: AiProvider,
    prompt: &str,
    model: &str,
    reasoning_effort: Option<&str>,
    copilot_direct_cli_ready: bool,
) -> Result<GenerationCommand, String> {
    let effort = super::selected_reasoning_effort_arg(reasoning_effort)?;
    let mut command = match provider {
        AiProvider::ClaudeCode => streaming_generation_command(
            provider,
            prompt,
            model,
            reasoning_effort,
            copilot_direct_cli_ready,
        )?,
        AiProvider::CodexCli => GenerationCommand {
            program: "codex".into(),
            args: vec![
                "app-server".into(),
                "--enable".into(),
                "tool_call_mcp_elicitation".into(),
            ],
            stdin: prompt.into(),
            output_format: super::GenerationOutputFormat::PlainText,
        },
        AiProvider::CopilotCli => {
            if !copilot_direct_cli_ready {
                return Err("GitHub Copilot CLI is not ready.".into());
            }
            let mut args = vec!["--acp".into()];
            if let Some(model) = super::selected_copilot_model_arg(model) {
                args.extend(["--model".into(), model]);
            }
            if let Some(effort) = effort {
                args.extend(["--reasoning-effort".into(), effort]);
            }
            GenerationCommand {
                program: "copilot".into(),
                args,
                stdin: prompt.into(),
                output_format: super::GenerationOutputFormat::PlainText,
            }
        }
    };
    if provider == AiProvider::ClaudeCode {
        command.args.extend(
            [
                "--input-format",
                "stream-json",
                "--permission-prompt-tool",
                "stdio",
                "--no-session-persistence",
            ]
            .into_iter()
            .map(str::to_owned),
        );
    }
    command.output_format = super::GenerationOutputFormat::PlainText;
    Ok(command)
}

/// Reuses provider defaults, including configured tools and permissions.
/// Only provider-session persistence is disabled because the app owns replay.
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
    let replay_options: &[&str] = match provider {
        // https://code.claude.com/docs/en/cli-reference
        AiProvider::ClaudeCode => &["--no-session-persistence"],
        // https://developers.openai.com/codex/cli/reference
        AiProvider::CodexCli => &["--ephemeral"],
        // https://docs.github.com/en/copilot/reference/cli-command-reference
        AiProvider::CopilotCli => &[],
    };
    // Keep Codex's stdin positional marker last, after all added options.
    let insertion = if provider == AiProvider::CodexCli {
        command.args.len() - 1
    } else {
        command.args.len()
    };
    command.args.splice(
        insertion..insertion,
        replay_options.iter().map(|arg| (*arg).to_owned()),
    );
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::streaming_generation_command;

    #[test]
    fn chat_claude_inherits_tools_and_permissions_without_changing_transport() {
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
        expected.push("--no-session-persistence".into());
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
    fn chat_ready_providers_inherit_tools_and_permissions_without_changing_defaults() {
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
                (expected.len() - 1, vec!["--ephemeral"])
            } else {
                (expected.len(), vec![])
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
