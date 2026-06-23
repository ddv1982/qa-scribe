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
    copilot_runtime: Option<CopilotRuntime>,
) -> Result<GenerationCommand, String> {
    let model_arg = selected_model_arg(model);
    match provider {
        AiProvider::ClaudeCode => {
            let mut args = vec!["-p".to_string()];
            if let Some(model) = model_arg {
                args.extend(["--model".to_string(), model]);
            }
            Ok(GenerationCommand {
                program: "claude".to_string(),
                args,
                stdin: prompt.to_string(),
            })
        }
        AiProvider::CodexCli => {
            let mut args = vec!["exec".to_string(), "--skip-git-repo-check".to_string()];
            if let Some(model) = model_arg {
                args.extend(["--model".to_string(), model]);
            }
            args.push("-".to_string());
            Ok(GenerationCommand {
                program: "codex".to_string(),
                args,
                stdin: prompt.to_string(),
            })
        }
        AiProvider::CopilotCli => match copilot_runtime {
            Some(CopilotRuntime::DirectCli) => Ok(GenerationCommand {
                program: "copilot".to_string(),
                args: vec!["-s".to_string(), "--no-ask-user".to_string()],
                stdin: prompt.to_string(),
            }),
            Some(CopilotRuntime::GhWrapper) => Ok(GenerationCommand {
                program: "gh".to_string(),
                args: vec![
                    "copilot".to_string(),
                    "--".to_string(),
                    "-s".to_string(),
                    "--no-ask-user".to_string(),
                ],
                stdin: prompt.to_string(),
            }),
            None => Err("GitHub Copilot CLI is not ready.".to_string()),
        },
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
            generation_command(AiProvider::CodexCli, "draft this", "default", None).unwrap();

        assert_eq!(command.program, "codex");
        assert_eq!(command.args, vec!["exec", "--skip-git-repo-check", "-"]);
        assert_eq!(command.stdin, "draft this");
    }

    #[test]
    fn codex_generation_uses_selected_model() {
        let command =
            generation_command(AiProvider::CodexCli, "draft this", "gpt-5.5", None).unwrap();

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
            generation_command(AiProvider::ClaudeCode, "draft this", "sonnet", None).unwrap();

        assert_eq!(command.program, "claude");
        assert_eq!(command.args, vec!["-p", "--model", "sonnet"]);
        assert_eq!(command.stdin, "draft this");
    }

    #[test]
    fn copilot_generation_uses_direct_cli_when_requested() {
        let command = generation_command(
            AiProvider::CopilotCli,
            "draft this",
            "default",
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
            Some(CopilotRuntime::GhWrapper),
        )
        .unwrap();

        assert_eq!(command.program, "gh");
        assert_eq!(command.args, vec!["copilot", "--", "-s", "--no-ask-user"]);
        assert_eq!(command.stdin, "draft this");
    }

    #[test]
    fn copilot_generation_requires_verified_runtime() {
        let error =
            generation_command(AiProvider::CopilotCli, "draft this", "default", None).unwrap_err();

        assert_eq!(error, "GitHub Copilot CLI is not ready.");
    }
}
