//! The process boundary of a streaming generation.
//!
//! [`ProviderExecutor`] is the seam between the core workflow and whatever
//! actually runs the provider CLI: the desktop shell implements it with a
//! real process (spawn, watchdog, process-group kill), while tests and the
//! smoke harness implement it with scripted output. Core stays free of
//! process specifics: the executor feeds raw stdout lines to a sink and
//! reports a [`ProviderExecution`] summary; [`run_streaming_generation`]
//! layers the per-format stream parsing on top.

use crate::domain::AiProvider;

use super::{
    GenerationCommand, GenerationOutputFormat,
    stream::{ProviderStreamParser, StreamUpdate},
};

/// Maximum raw stdout accepted from one provider generation. The desktop
/// process driver enforces this while reading so it can stop the child early;
/// core repeats the bound because custom [`ProviderExecutor`] implementations
/// are also allowed.
pub const MAX_PROVIDER_STDOUT_BYTES: usize = 2 * 1024 * 1024;
/// Keep provider failure text below the persisted AI-run error bound, with
/// room for provider-specific guidance such as the Copilot auth prefix.
const MAX_PROVIDER_FAILURE_MESSAGE_BYTES: usize = 1_600;

/// Executes a [`GenerationCommand`], feeding each raw stdout line (or chunk)
/// to `on_line`. Cancellation is owned by the implementation: a cancelled run
/// simply returns with [`ProviderExecution::cancelled`] set.
pub trait ProviderExecutor {
    fn execute(
        &self,
        command: &GenerationCommand,
        on_line: &mut dyn FnMut(&[u8]),
    ) -> Result<ProviderExecution, String>;
}

/// Process-neutral summary of one provider execution.
#[derive(Debug)]
pub struct ProviderExecution {
    /// Whether the provider exited successfully; `None` when it never ran to
    /// a reaped exit (e.g. cancelled before spawn).
    pub exit_success: Option<bool>,
    pub stderr: Vec<u8>,
    pub cancelled: bool,
}

impl ProviderExecution {
    pub fn cancelled() -> Self {
        Self {
            exit_success: None,
            stderr: Vec::new(),
            cancelled: true,
        }
    }
}

/// Run one streaming generation: execute the command, parse its stdout with
/// the format's stream parser, and forward [`StreamUpdate`]s to `on_update`.
pub fn run_streaming_generation(
    executor: &dyn ProviderExecutor,
    command: &GenerationCommand,
    mut on_update: impl FnMut(StreamUpdate),
) -> Result<ProviderGenerationOutput, String> {
    let mut parser = ProviderStreamParser::new(command.output_format);
    let mut stdout = Vec::new();
    let mut output_limit_exceeded = false;
    let execution = executor.execute(command, &mut |line| {
        if output_limit_exceeded {
            return;
        }
        if stdout.len().saturating_add(line.len()) > MAX_PROVIDER_STDOUT_BYTES {
            output_limit_exceeded = true;
            return;
        }
        stdout.extend_from_slice(line);
        for update in parser.push_bytes(line) {
            on_update(update);
        }
    })?;
    if output_limit_exceeded {
        return Err(format!(
            "Provider output exceeded the {MAX_PROVIDER_STDOUT_BYTES} byte safety limit."
        ));
    }
    Ok(ProviderGenerationOutput {
        exit_success: execution.exit_success,
        stdout,
        stderr: execution.stderr,
        assistant_text: parser.finish(),
        output_format: command.output_format,
        cancelled: execution.cancelled,
    })
}

/// The parsed outcome of a streaming generation, consumed by the workflow's
/// finish step.
#[derive(Debug)]
pub struct ProviderGenerationOutput {
    pub exit_success: Option<bool>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub assistant_text: Option<String>,
    pub output_format: GenerationOutputFormat,
    pub cancelled: bool,
}

impl ProviderGenerationOutput {
    pub fn success(&self) -> bool {
        !self.cancelled && self.exit_success == Some(true)
    }

    /// Return the provider's assistant response without confusing structured
    /// protocol envelopes for generated content.
    ///
    /// Plain-text providers may use their raw stdout as a compatibility
    /// fallback. Structured providers must produce assistant content through
    /// their format-specific parser; falling back to JSONL/stdout would make
    /// an unknown or malformed event look like a valid generated response.
    pub fn response_text(&self) -> Result<String, String> {
        if let Some(text) = self
            .assistant_text
            .as_ref()
            .filter(|text| !text.trim().is_empty())
        {
            return Ok(text.clone());
        }

        match self.output_format {
            GenerationOutputFormat::PlainText => {
                Ok(String::from_utf8_lossy(&self.stdout).to_string())
            }
            GenerationOutputFormat::CodexJsonl => {
                Err(structured_output_compatibility_error("Codex JSONL"))
            }
            GenerationOutputFormat::ClaudeStreamJson => {
                Err(structured_output_compatibility_error("Claude stream-json"))
            }
        }
    }

    /// Structured CLIs such as Claude include the resolved model in their
    /// initialization event. Keep this deliberately narrow so arbitrary
    /// model-like fields in generated content are never treated as metadata.
    pub fn reported_model(&self) -> Option<String> {
        String::from_utf8_lossy(&self.stdout)
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .find_map(|event| {
                let is_init = event.get("type").and_then(serde_json::Value::as_str)
                    == Some("system")
                    && event.get("subtype").and_then(serde_json::Value::as_str) == Some("init");
                if !is_init {
                    return None;
                }
                event
                    .get("model")?
                    .as_str()
                    .map(str::trim)
                    .filter(|model| !model.is_empty())
                    .map(str::to_string)
            })
    }

    pub fn failure_message(&self) -> String {
        if self.cancelled {
            return "Generation cancelled.".to_string();
        }
        let stderr = String::from_utf8_lossy(&self.stderr);
        let stderr = stderr.trim();
        if stderr.is_empty() {
            "provider command failed".to_string()
        } else {
            bounded_text_tail(stderr, MAX_PROVIDER_FAILURE_MESSAGE_BYTES)
        }
    }

    pub fn failure_message_for_provider(&self, provider: AiProvider) -> String {
        let message = self.failure_message();
        if provider != AiProvider::CopilotCli {
            return message;
        }

        copilot_generation_failure_message(&message).unwrap_or(message)
    }
}

fn structured_output_compatibility_error(format: &str) -> String {
    format!(
        "Provider completed successfully, but QA Scribe found no recognized assistant content in its {format} output. The installed provider CLI may use an unsupported event format; update QA Scribe or use a compatible provider CLI version, then try again."
    )
}

fn bounded_text_tail(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        return value.to_string();
    }
    let mut start = value.len().saturating_sub(limit);
    while start < value.len() && !value.is_char_boundary(start) {
        start += 1;
    }
    value[start..].to_string()
}

fn copilot_generation_failure_message(message: &str) -> Option<String> {
    let detail = message.to_ascii_lowercase();
    let auth_required = [
        "no authentication information found",
        "authentication failed",
        "authenticate",
        "not logged",
        "unauthorized",
        "401",
        "token",
        "login",
    ]
    .iter()
    .any(|needle| detail.contains(needle));
    if auth_required {
        return Some(format!(
            "GitHub Copilot CLI could not authenticate. Run `copilot login`, or set `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`. Last response: {message}"
        ));
    }

    let policy_or_license = ["forbidden", "403", "license", "policy", "copilot requests"]
        .iter()
        .any(|needle| detail.contains(needle));
    if policy_or_license {
        return Some(format!(
            "GitHub Copilot CLI was rejected by account, license, or policy settings. Check Copilot CLI access for this GitHub account. Last response: {message}"
        ));
    }

    None
}

#[cfg(test)]
mod tests {
    use crate::ai::GenerationOutputFormat;
    use crate::domain::AiProvider;

    use super::{
        GenerationCommand, MAX_PROVIDER_FAILURE_MESSAGE_BYTES, MAX_PROVIDER_STDOUT_BYTES,
        ProviderExecution, ProviderExecutor, ProviderGenerationOutput, run_streaming_generation,
    };

    fn failed_output(stderr: &[u8]) -> ProviderGenerationOutput {
        ProviderGenerationOutput {
            exit_success: Some(false),
            stdout: Vec::new(),
            stderr: stderr.to_vec(),
            assistant_text: None,
            output_format: GenerationOutputFormat::PlainText,
            cancelled: false,
        }
    }

    #[test]
    fn copilot_generation_auth_failure_gets_actionable_message() {
        let output = failed_output(b"Error: No authentication information found");

        let message = output.failure_message_for_provider(AiProvider::CopilotCli);

        assert!(message.contains("copilot login"));
        assert!(message.contains("COPILOT_GITHUB_TOKEN"));
        assert!(message.contains("No authentication information found"));
    }

    #[test]
    fn non_copilot_generation_failure_stays_raw() {
        let output = failed_output(b"Error: No authentication information found");

        assert_eq!(
            output.failure_message_for_provider(AiProvider::CodexCli),
            "Error: No authentication information found"
        );
    }

    struct ScriptedExecutor(Vec<&'static str>);

    impl ProviderExecutor for ScriptedExecutor {
        fn execute(
            &self,
            _command: &GenerationCommand,
            on_line: &mut dyn FnMut(&[u8]),
        ) -> Result<ProviderExecution, String> {
            for line in &self.0 {
                on_line(format!("{line}\n").as_bytes());
            }
            Ok(ProviderExecution {
                exit_success: Some(true),
                stderr: Vec::new(),
                cancelled: false,
            })
        }
    }

    #[test]
    fn run_streaming_generation_parses_lines_and_keeps_raw_stdout() {
        let executor = ScriptedExecutor(vec![
            r#"{"type":"item/agentMessage/delta","delta":"Hello "}"#,
            r#"{"type":"item/agentMessage/delta","delta":"world"}"#,
        ]);
        let command = GenerationCommand {
            program: "scripted".to_string(),
            args: Vec::new(),
            stdin: "prompt".to_string(),
            output_format: GenerationOutputFormat::CodexJsonl,
        };

        let mut updates = 0usize;
        let output = run_streaming_generation(&executor, &command, |_| updates += 1)
            .expect("scripted run succeeds");

        assert!(output.success());
        assert_eq!(
            output.response_text().expect("recognized Codex response"),
            "Hello world"
        );
        assert!(updates >= 2, "each delta should surface an update");
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("agentMessage"),
            "raw stdout is preserved for diagnostics"
        );
    }

    #[test]
    fn structured_init_event_reports_the_resolved_model() {
        let output = ProviderGenerationOutput {
            exit_success: Some(true),
            stdout: br#"{"type":"system","subtype":"init","model":"claude-sonnet-4-6"}
{"type":"result","result":"done"}
"#
            .to_vec(),
            stderr: Vec::new(),
            assistant_text: Some("done".to_string()),
            output_format: GenerationOutputFormat::ClaudeStreamJson,
            cancelled: false,
        };

        assert_eq!(
            output.reported_model().as_deref(),
            Some("claude-sonnet-4-6")
        );
    }

    #[test]
    fn current_structured_provider_fixtures_return_only_assistant_content() {
        let fixtures = [
            (
                GenerationOutputFormat::CodexJsonl,
                vec![
                    r#"{"type":"thread.started","thread_id":"thread-1"}"#,
                    r#"{"type":"item.completed","item":{"type":"agent_message","text":"<h2>Codex cases</h2>"}}"#,
                    r#"{"type":"turn.completed","usage":{"input_tokens":10}}"#,
                ],
                "<h2>Codex cases</h2>",
            ),
            (
                GenerationOutputFormat::ClaudeStreamJson,
                vec![
                    r#"{"type":"system","subtype":"init","model":"claude-sonnet"}"#,
                    r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"<h2>Claude cases</h2>"}}}"#,
                    r#"{"type":"result","result":"<h2>Claude cases</h2>"}"#,
                ],
                "<h2>Claude cases</h2>",
            ),
        ];

        for (output_format, lines, expected) in fixtures {
            let command = GenerationCommand {
                program: "scripted".to_string(),
                args: Vec::new(),
                stdin: "prompt".to_string(),
                output_format,
            };
            let output = run_streaming_generation(&ScriptedExecutor(lines), &command, |_| {})
                .expect("fixture execution succeeds");

            assert_eq!(
                output.response_text().expect("fixture assistant content"),
                expected
            );
        }
    }

    #[test]
    fn structured_unknown_or_malformed_events_return_compatibility_error_not_raw_stdout() {
        for (output_format, lines, format_label) in [
            (
                GenerationOutputFormat::CodexJsonl,
                vec![r#"{"type":"future.response","payload":"<p>raw Codex protocol</p>"}"#],
                "Codex JSONL",
            ),
            (
                GenerationOutputFormat::ClaudeStreamJson,
                vec![r#"{"type":"assistant","message":"#],
                "Claude stream-json",
            ),
        ] {
            let command = GenerationCommand {
                program: "scripted".to_string(),
                args: Vec::new(),
                stdin: "prompt".to_string(),
                output_format,
            };
            let output = run_streaming_generation(&ScriptedExecutor(lines), &command, |_| {})
                .expect("zero-exit provider execution remains classifiable");

            let error = output
                .response_text()
                .expect_err("unrecognized structured output must fail");
            assert!(error.contains(format_label), "unexpected error: {error}");
            assert!(error.contains("unsupported event format"));
            assert!(!error.contains("raw Codex protocol"));
        }
    }

    #[test]
    fn plain_text_response_keeps_raw_stdout_fallback() {
        let output = ProviderGenerationOutput {
            exit_success: Some(true),
            stdout: b"<h2>Plain provider response</h2>\n".to_vec(),
            stderr: Vec::new(),
            assistant_text: None,
            output_format: GenerationOutputFormat::PlainText,
            cancelled: false,
        };

        assert_eq!(
            output.response_text().expect("plain stdout fallback"),
            "<h2>Plain provider response</h2>\n"
        );
    }

    #[test]
    fn core_rejects_output_over_the_shared_safety_limit() {
        struct OversizedExecutor;

        impl ProviderExecutor for OversizedExecutor {
            fn execute(
                &self,
                _command: &GenerationCommand,
                on_line: &mut dyn FnMut(&[u8]),
            ) -> Result<ProviderExecution, String> {
                on_line(&vec![b'x'; MAX_PROVIDER_STDOUT_BYTES]);
                on_line(b"x");
                Ok(ProviderExecution {
                    exit_success: Some(true),
                    stderr: Vec::new(),
                    cancelled: false,
                })
            }
        }

        let command = GenerationCommand {
            program: "oversized".to_string(),
            args: Vec::new(),
            stdin: String::new(),
            output_format: GenerationOutputFormat::PlainText,
        };

        let error = run_streaming_generation(&OversizedExecutor, &command, |_| {})
            .expect_err("oversized output should fail");

        assert!(error.contains("output exceeded"));
    }

    #[test]
    fn provider_failure_message_keeps_a_bounded_actionable_tail() {
        let mut stderr = vec![b'x'; MAX_PROVIDER_FAILURE_MESSAGE_BYTES * 2];
        stderr.extend_from_slice(b"unauthorized final actionable diagnostic");

        let message = failed_output(&stderr).failure_message();
        let copilot_message =
            failed_output(&stderr).failure_message_for_provider(AiProvider::CopilotCli);

        assert!(message.len() <= MAX_PROVIDER_FAILURE_MESSAGE_BYTES);
        assert!(message.ends_with("final actionable diagnostic"));
        assert!(copilot_message.len() <= 2_000);
        assert!(copilot_message.contains("copilot login"));
        assert!(copilot_message.ends_with("final actionable diagnostic"));
    }
}
