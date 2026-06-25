use std::{
    io::{BufRead, BufReader, Read, Write},
    process::{Command, ExitStatus, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

use qa_scribe_core::{
    ai::{GenerationCommand, generation_command, streaming_generation_command},
    domain::AiProvider,
};
use tauri::ipc::Channel;

use super::{
    job_events::{GenerationJobEvent, send_event, send_progress},
    stream_parser::{ProviderStreamParser, StreamUpdate},
};
use crate::{
    commands::providers::provider_readiness,
    jobs::{JobControl, JobStore},
    provider_command::apply_provider_path,
};

const PARTIAL_UPDATE_MIN_BYTES: usize = 512;
const PARTIAL_UPDATE_INTERVAL: Duration = Duration::from_millis(250);

pub(super) fn execute_provider_generation(
    provider: AiProvider,
    model: &str,
    reasoning_effort: Option<&str>,
    prompt: &str,
    log_context: &str,
) -> Result<ProviderGenerationOutput, String> {
    let readiness = provider_readiness(provider);
    if !readiness.descriptor.status.is_ready() {
        return Err(readiness.descriptor.reason);
    }

    let command = generation_command(
        provider,
        prompt,
        model,
        reasoning_effort,
        readiness.copilot_runtime,
    )?;
    let started = Instant::now();
    let output = run_generation_command(&command).map(ProviderGenerationOutput::from);
    eprintln!(
        "qa-scribe {log_context} provider finished: elapsed_ms={}, success={}, failure={}",
        started.elapsed().as_millis(),
        output
            .as_ref()
            .map(ProviderGenerationOutput::success)
            .unwrap_or(false),
        output_failure_for_log(&output)
    );
    output
}

#[allow(clippy::too_many_arguments)]
pub(super) fn execute_provider_generation_streaming(
    provider: AiProvider,
    model: &str,
    reasoning_effort: Option<&str>,
    prompt: &str,
    log_context: &str,
    job_id: &str,
    jobs: &JobStore,
    events: &Channel<GenerationJobEvent>,
    control: &JobControl,
) -> Result<ProviderGenerationOutput, String> {
    let readiness = provider_readiness(provider);
    if !readiness.descriptor.status.is_ready() {
        return Err(readiness.descriptor.reason);
    }

    let command = streaming_generation_command(
        provider,
        prompt,
        model,
        reasoning_effort,
        readiness.copilot_runtime,
    )?;
    let started = Instant::now();
    let mut last_partial_len = 0usize;
    let mut last_partial_emit = Instant::now()
        .checked_sub(PARTIAL_UPDATE_INTERVAL)
        .unwrap_or_else(Instant::now);
    let output = run_generation_command_streaming(&command, control, |update| match update {
        StreamUpdate::Progress(message) => {
            let _ = send_progress(events, jobs, job_id, &message);
        }
        StreamUpdate::Partial(body) => {
            let body_len = body.len();
            let enough_new_text = body_len < last_partial_len
                || body_len.saturating_sub(last_partial_len) >= PARTIAL_UPDATE_MIN_BYTES;
            if !enough_new_text && last_partial_emit.elapsed() < PARTIAL_UPDATE_INTERVAL {
                return;
            }
            last_partial_len = body_len;
            last_partial_emit = Instant::now();
            let status = jobs.update_partial(job_id, &body);
            if let Ok(status) = status {
                send_event(
                    events,
                    GenerationJobEvent::Partial {
                        job_id: job_id.to_string(),
                        status,
                        body,
                    },
                );
            }
        }
    });
    eprintln!(
        "qa-scribe {log_context} provider stream finished: elapsed_ms={}, success={}, failure={}",
        started.elapsed().as_millis(),
        output
            .as_ref()
            .map(ProviderGenerationOutput::success)
            .unwrap_or(false),
        output_failure_for_log(&output)
    );
    output
}

fn output_failure_for_log(output: &Result<ProviderGenerationOutput, String>) -> String {
    match output {
        Ok(output) if output.success() => "none".to_string(),
        Ok(output) => truncate_for_log(&output.failure_message(), 500),
        Err(error) => truncate_for_log(error, 500),
    }
}

fn truncate_for_log(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    let mut chars = trimmed.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else if truncated.is_empty() {
        "none".to_string()
    } else {
        truncated
    }
}

fn run_generation_command(command: &GenerationCommand) -> Result<Output, String> {
    let mut process = Command::new(&command.program);
    process
        .args(&command.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_provider_path(&mut process);

    let mut child = process.spawn().map_err(|error| error.to_string())?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(command.stdin.as_bytes())
            .map_err(|error| error.to_string())?;
    }

    child.wait_with_output().map_err(|error| error.to_string())
}

fn run_generation_command_streaming(
    command: &GenerationCommand,
    control: &JobControl,
    mut on_update: impl FnMut(StreamUpdate),
) -> Result<ProviderGenerationOutput, String> {
    if control.is_cancelled() {
        return Ok(ProviderGenerationOutput::cancelled());
    }

    let mut process = Command::new(&command.program);
    process
        .args(&command.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_provider_path(&mut process);

    let mut child = process.spawn().map_err(|error| error.to_string())?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(command.stdin.as_bytes())
            .map_err(|error| error.to_string())?;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "provider stdout was not available".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "provider stderr was not available".to_string())?;
    control.set_child(child)?;

    let stderr_reader = thread::spawn(move || {
        let mut buffer = Vec::new();
        let mut reader = BufReader::new(stderr);
        let _ = reader.read_to_end(&mut buffer);
        buffer
    });

    let mut stdout_reader = BufReader::new(stdout);
    let mut stdout_bytes = Vec::new();
    let mut parser = ProviderStreamParser::new(command.output_format);
    let mut chunk = Vec::new();

    loop {
        chunk.clear();
        let read = stdout_reader
            .read_until(b'\n', &mut chunk)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        stdout_bytes.extend_from_slice(&chunk);
        for update in parser.push_bytes(&chunk) {
            on_update(update);
        }
        if control.is_cancelled()
            && let Some(mut child) = control.take_child()?
        {
            let _ = child.kill();
            control.set_child(child)?;
        }
    }

    let status = match control.take_child()? {
        Some(mut child) => Some(child.wait().map_err(|error| error.to_string())?),
        None => None,
    };
    let stderr = stderr_reader
        .join()
        .map_err(|_| "provider stderr reader panicked".to_string())?;

    Ok(ProviderGenerationOutput {
        status,
        stdout: stdout_bytes,
        stderr,
        assistant_text: parser.finish(),
        cancelled: control.is_cancelled(),
    })
}

pub(super) struct ProviderGenerationOutput {
    pub(super) status: Option<ExitStatus>,
    pub(super) stdout: Vec<u8>,
    pub(super) stderr: Vec<u8>,
    pub(super) assistant_text: Option<String>,
    pub(super) cancelled: bool,
}

impl ProviderGenerationOutput {
    fn cancelled() -> Self {
        Self {
            status: None,
            stdout: Vec::new(),
            stderr: Vec::new(),
            assistant_text: None,
            cancelled: true,
        }
    }

    pub(super) fn success(&self) -> bool {
        !self.cancelled && self.status.is_some_and(|status| status.success())
    }

    pub(super) fn response_text(&self) -> String {
        self.assistant_text
            .as_ref()
            .filter(|text| !text.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| String::from_utf8_lossy(&self.stdout).to_string())
    }

    fn failure_message(&self) -> String {
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

    pub(super) fn failure_message_for_provider(&self, provider: AiProvider) -> String {
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

impl From<Output> for ProviderGenerationOutput {
    fn from(output: Output) -> Self {
        Self {
            status: Some(output.status),
            stdout: output.stdout,
            stderr: output.stderr,
            assistant_text: None,
            cancelled: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{os::unix::process::ExitStatusExt, process::ExitStatus};

    use qa_scribe_core::domain::AiProvider;

    use super::ProviderGenerationOutput;

    #[test]
    fn copilot_generation_auth_failure_gets_actionable_message() {
        let output = ProviderGenerationOutput {
            status: Some(ExitStatus::from_raw(1)),
            stdout: Vec::new(),
            stderr: b"Error: No authentication information found".to_vec(),
            assistant_text: None,
            cancelled: false,
        };

        let message = output.failure_message_for_provider(AiProvider::CopilotCli);

        assert!(message.contains("copilot login"));
        assert!(message.contains("COPILOT_GITHUB_TOKEN"));
        assert!(message.contains("No authentication information found"));
    }

    #[test]
    fn non_copilot_generation_failure_stays_raw() {
        let output = ProviderGenerationOutput {
            status: Some(ExitStatus::from_raw(1)),
            stdout: Vec::new(),
            stderr: b"Error: No authentication information found".to_vec(),
            assistant_text: None,
            cancelled: false,
        };

        assert_eq!(
            output.failure_message_for_provider(AiProvider::CodexCli),
            "Error: No authentication information found"
        );
    }
}
