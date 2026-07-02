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
    let reasoning_effort_arg = selected_reasoning_effort_arg(reasoning_effort)?;
    match provider {
        AiProvider::ClaudeCode => {
            let mut args = vec!["-p".to_string()];
            if stream_events {
                args.extend([
                    "--verbose".to_string(),
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
                    // The prompt is passed on stdin (via `-p -`), not as an argv
                    // element: argv is world-visible to any local process (e.g.
                    // `ps`), which would leak session content, and is bounded by
                    // the OS ARG_MAX (~1MB on macOS), which large sessions can
                    // exceed. This mirrors how Claude Code and Codex CLI receive
                    // the prompt.
                    let mut args = vec![
                        "-p".to_string(),
                        "-".to_string(),
                        "-s".to_string(),
                        "--no-ask-user".to_string(),
                    ];
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

/// Reasoning-effort values the app allows through to provider CLIs. Frontend
/// selection is constrained to this set; anything else (e.g. a value crafted
/// to break out of the quoted TOML string Codex receives via `--config`) is
/// rejected rather than interpolated.
const ALLOWED_REASONING_EFFORTS: [&str; 4] = ["minimal", "low", "medium", "high"];

fn selected_reasoning_effort_arg(reasoning_effort: Option<&str>) -> Result<Option<String>, String> {
    let Some(raw) = reasoning_effort else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.eq_ignore_ascii_case("default")
        || trimmed.eq_ignore_ascii_case("unspecified")
    {
        return Ok(None);
    }
    if ALLOWED_REASONING_EFFORTS
        .iter()
        .any(|allowed| trimmed.eq_ignore_ascii_case(allowed))
    {
        Ok(Some(trimmed.to_string()))
    } else {
        Err(format!(
            "Unsupported reasoning effort \"{trimmed}\"; expected one of: {}",
            ALLOWED_REASONING_EFFORTS.join(", ")
        ))
    }
}

#[cfg(test)]
mod tests;
