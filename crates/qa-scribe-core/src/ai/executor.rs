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
    GenerationCommand,
    stream::{ProviderStreamParser, StreamUpdate},
};

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
    let execution = executor.execute(command, &mut |line| {
        stdout.extend_from_slice(line);
        for update in parser.push_bytes(line) {
            on_update(update);
        }
    })?;
    Ok(ProviderGenerationOutput {
        exit_success: execution.exit_success,
        stdout,
        stderr: execution.stderr,
        assistant_text: parser.finish(),
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
    pub cancelled: bool,
}

impl ProviderGenerationOutput {
    pub fn success(&self) -> bool {
        !self.cancelled && self.exit_success == Some(true)
    }

    pub fn response_text(&self) -> String {
        self.assistant_text
            .as_ref()
            .filter(|text| !text.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| String::from_utf8_lossy(&self.stdout).to_string())
    }

    pub fn failure_message(&self) -> String {
        if self.cancelled {
            return "Generation cancelled.".to_string();
        }
        let stderr = String::from_utf8_lossy(&self.stderr);
        if stderr.trim().is_empty() {
            "provider command failed".to_string()
        } else {
            stderr.trim().to_string()
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
        GenerationCommand, ProviderExecution, ProviderExecutor, ProviderGenerationOutput,
        run_streaming_generation,
    };

    fn failed_output(stderr: &[u8]) -> ProviderGenerationOutput {
        ProviderGenerationOutput {
            exit_success: Some(false),
            stdout: Vec::new(),
            stderr: stderr.to_vec(),
            assistant_text: None,
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
        assert_eq!(output.response_text(), "Hello world");
        assert!(updates >= 2, "each delta should surface an update");
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("agentMessage"),
            "raw stdout is preserved for diagnostics"
        );
    }
}
