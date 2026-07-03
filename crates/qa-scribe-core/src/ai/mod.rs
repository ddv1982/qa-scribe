pub mod stream;

use serde::Serialize;

use crate::domain::AiProvider;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapability {
    pub id: AiProvider,
    pub label: &'static str,
    pub executable: &'static str,
    pub version_args: Vec<&'static str>,
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
    copilot_direct_cli_ready: bool,
) -> Result<GenerationCommand, String> {
    generation_command_for_mode(
        provider,
        prompt,
        model,
        reasoning_effort,
        copilot_direct_cli_ready,
        false,
    )
}

pub fn streaming_generation_command(
    provider: AiProvider,
    prompt: &str,
    model: &str,
    reasoning_effort: Option<&str>,
    copilot_direct_cli_ready: bool,
) -> Result<GenerationCommand, String> {
    generation_command_for_mode(
        provider,
        prompt,
        model,
        reasoning_effort,
        copilot_direct_cli_ready,
        true,
    )
}

fn generation_command_for_mode(
    provider: AiProvider,
    prompt: &str,
    model: &str,
    reasoning_effort: Option<&str>,
    copilot_direct_cli_ready: bool,
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
            if copilot_direct_cli_ready {
                // The prompt is passed on stdin, not via `-p`/`--prompt`:
                // per the official docs
                // (https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically),
                // Copilot CLI supports two programmatic invocation modes,
                // `copilot -p "PROMPT"` (argv) or `echo "PROMPT" | copilot`
                // (piped stdin), and "piped input is ignored if you also
                // provide a prompt with the -p or --prompt option." Passing
                // both `-p -` and stdin (as this code previously did) would
                // make Copilot treat the literal string "-" as the entire
                // prompt and silently discard the real session content, so
                // `-p`/`--prompt` must be omitted entirely and the prompt
                // must only ever be sent on stdin. This also avoids leaking
                // session content into argv (world-visible via `ps`) and
                // the OS ARG_MAX (~1MB on macOS) that large sessions could
                // exceed, mirroring how Claude Code and Codex CLI receive
                // the prompt.
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
            } else {
                Err("GitHub Copilot CLI is not ready.".to_string())
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
const ALLOWED_REASONING_EFFORTS: [&str; 5] = ["minimal", "low", "medium", "high", "xhigh"];

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
