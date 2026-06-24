use serde::{Deserialize, Serialize};

use crate::domain::AiProvider;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapability {
    pub id: AiProvider,
    pub label: &'static str,
    pub executable: &'static str,
    pub version_args: Vec<&'static str>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CopilotRuntime {
    DirectCli,
    GhWrapper,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GenerationCommand {
    pub program: String,
    pub args: Vec<String>,
    pub stdin: String,
    pub output_format: GenerationOutputFormat,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GenerationOutputFormat {
    PlainText,
    CodexJsonl,
    ClaudeStreamJson,
}

pub fn provider_capabilities() -> Vec<ProviderCapability> {
    vec![
        ProviderCapability {
            id: AiProvider::ClaudeCode,
            label: "Claude Code",
            executable: "claude",
            version_args: vec!["--version"],
        },
        ProviderCapability {
            id: AiProvider::CodexCli,
            label: "Codex CLI",
            executable: "codex",
            version_args: vec!["--version"],
        },
        ProviderCapability {
            id: AiProvider::CopilotCli,
            label: "GitHub Copilot CLI",
            executable: "copilot",
            version_args: vec!["version"],
        },
    ]
}

pub fn generation_command(
    provider: AiProvider,
    prompt: &str,
    model: &str,
    reasoning_effort: Option<&str>,
    copilot_runtime: Option<CopilotRuntime>,
) -> Result<GenerationCommand, String> {
    generation_command_for_mode(
        provider,
        prompt,
        model,
        reasoning_effort,
        copilot_runtime,
        false,
    )
}

pub fn streaming_generation_command(
    provider: AiProvider,
    prompt: &str,
    model: &str,
    reasoning_effort: Option<&str>,
    copilot_runtime: Option<CopilotRuntime>,
) -> Result<GenerationCommand, String> {
    generation_command_for_mode(
        provider,
        prompt,
        model,
        reasoning_effort,
        copilot_runtime,
        true,
    )
}

fn generation_command_for_mode(
    provider: AiProvider,
    prompt: &str,
    model: &str,
    reasoning_effort: Option<&str>,
    copilot_runtime: Option<CopilotRuntime>,
    stream_events: bool,
) -> Result<GenerationCommand, String> {
    let model_arg = selected_model_arg(model);
    let reasoning_effort_arg = selected_reasoning_effort_arg(reasoning_effort);
    match provider {
        AiProvider::ClaudeCode => {
            let mut args = vec!["-p".to_string()];
            if stream_events {
                args.extend([
                    "--output-format".to_string(),
                    "stream-json".to_string(),
                    "--include-partial-messages".to_string(),
                ]);
            }
            if let Some(model) = model_arg {
                args.extend(["--model".to_string(), model]);
            }
            if let Some(effort) = reasoning_effort_arg {
                args.extend(["--effort".to_string(), effort]);
            }
            Ok(GenerationCommand {
                program: "claude".to_string(),
                args,
                stdin: prompt.to_string(),
                output_format: if stream_events {
                    GenerationOutputFormat::ClaudeStreamJson
                } else {
                    GenerationOutputFormat::PlainText
                },
            })
        }
        AiProvider::CodexCli => {
            let mut args = vec!["exec".to_string(), "--skip-git-repo-check".to_string()];
            if stream_events {
                args.push("--json".to_string());
            }
            if let Some(model) = model_arg {
                args.extend(["--model".to_string(), model]);
            }
            if let Some(effort) = reasoning_effort_arg {
                args.extend([
                    "--config".to_string(),
                    format!("model_reasoning_effort=\"{effort}\""),
                ]);
            }
            args.push("-".to_string());
            Ok(GenerationCommand {
                program: "codex".to_string(),
                args,
                stdin: prompt.to_string(),
                output_format: if stream_events {
                    GenerationOutputFormat::CodexJsonl
                } else {
                    GenerationOutputFormat::PlainText
                },
            })
        }
        AiProvider::CopilotCli => {
            let copilot_model_arg = selected_copilot_model_arg(model);
            match copilot_runtime {
                Some(CopilotRuntime::DirectCli) => {
                    let mut args = vec!["-s".to_string(), "--no-ask-user".to_string()];
                    if let Some(model) = copilot_model_arg {
                        args.extend(["--model".to_string(), model]);
                    }
                    Ok(GenerationCommand {
                        program: "copilot".to_string(),
                        args,
                        stdin: prompt.to_string(),
                        output_format: GenerationOutputFormat::PlainText,
                    })
                }
                Some(CopilotRuntime::GhWrapper) => {
                    let mut args = vec![
                        "copilot".to_string(),
                        "--".to_string(),
                        "-s".to_string(),
                        "--no-ask-user".to_string(),
                    ];
                    if let Some(model) = copilot_model_arg {
                        args.extend(["--model".to_string(), model]);
                    }
                    Ok(GenerationCommand {
                        program: "gh".to_string(),
                        args,
                        stdin: prompt.to_string(),
                        output_format: GenerationOutputFormat::PlainText,
                    })
                }
                None => Err("GitHub Copilot CLI is not ready.".to_string()),
            }
        }
    }
}

fn selected_model_arg(model: &str) -> Option<String> {
    let trimmed = model.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("default") {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn selected_copilot_model_arg(model: &str) -> Option<String> {
    let trimmed = model.trim();
    if trimmed.is_empty()
        || trimmed.eq_ignore_ascii_case("default")
        || trimmed.eq_ignore_ascii_case("auto")
    {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn selected_reasoning_effort_arg(reasoning_effort: Option<&str>) -> Option<String> {
    let trimmed = reasoning_effort?.trim();
    if trimmed.is_empty()
        || trimmed.eq_ignore_ascii_case("default")
        || trimmed.eq_ignore_ascii_case("unspecified")
    {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
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
        assert_eq!(command.args, vec!["-s", "--no-ask-user"]);
    }

    #[test]
    fn copilot_generation_uses_selected_model() {
        let command = generation_command(
            AiProvider::CopilotCli,
            "draft this",
            "gpt-5.5",
            None,
            Some(CopilotRuntime::GhWrapper),
        )
        .unwrap();

        assert_eq!(command.program, "gh");
        assert_eq!(
            command.args,
            vec!["copilot", "--", "-s", "--no-ask-user", "--model", "gpt-5.5"]
        );
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
        assert_eq!(command.args, vec!["-s", "--no-ask-user"]);
        assert_eq!(command.stdin, "draft this");
    }

    #[test]
    fn copilot_generation_can_use_gh_double_dash_bridge() {
        let command = generation_command(
            AiProvider::CopilotCli,
            "draft this",
            "default",
            None,
            Some(CopilotRuntime::GhWrapper),
        )
        .unwrap();

        assert_eq!(command.program, "gh");
        assert_eq!(command.args, vec!["copilot", "--", "-s", "--no-ask-user"]);
        assert_eq!(command.stdin, "draft this");
    }

    #[test]
    fn copilot_generation_requires_verified_runtime() {
        let error = generation_command(AiProvider::CopilotCli, "draft this", "default", None, None)
            .unwrap_err();

        assert_eq!(error, "GitHub Copilot CLI is not ready.");
    }
}
