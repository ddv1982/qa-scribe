use std::{
    io::{Read, Write},
    path::Path,
    process::{ChildStdout, Command, Stdio},
    sync::mpsc,
    thread,
    time::Instant,
};

use serde_json::{Value, json};

use crate::{
    commands::providers::{ProviderDiscoveryError, ProviderDiscoveryErrorCode},
    process_io::{configure_process_group, kill_child_group},
    provider_command::{NeutralProviderCwd, apply_provider_path},
};

use super::cancel::{CANCELLATION_POLL_INTERVAL, DiscoveryCancellation};

mod protocol;

#[cfg(test)]
mod tests;

const INITIALIZE_REQUEST_ID: &str = "qa-scribe-model-catalog";
const MAX_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_MODELS: usize = 1_000;
const MAX_FRAMES: usize = 1_024;
const READ_CHUNK_BYTES: usize = 8 * 1024;
const MAX_QUEUED_FRAMES: usize = 16;

// Keep this list deliberately explicit. Model discovery must never gain a
// prompt-bearing argument as other Claude execution options evolve.
const CLAUDE_DISCOVERY_ARGS: &[&str] = &[
    "--output-format",
    "stream-json",
    "--verbose",
    "--input-format",
    "stream-json",
    "--setting-sources",
    "",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--mcp-config",
    r#"{"mcpServers":{}}"#,
    "--tools",
    "",
    "--settings",
    r#"{"disableAllHooks":true}"#,
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ClaudeCatalogResult {
    pub(super) models: Vec<Value>,
}

/// Discover Claude Code's selector catalog without sending a prompt.
///
/// The child receives exactly one Agent SDK `initialize` control frame. Its
/// account payload and all non-model events are ignored; returned model values
/// are rebuilt from a small allowlist before leaving this module.
pub(super) fn discover(
    executable: &Path,
    deadline: Instant,
) -> Result<ClaudeCatalogResult, ProviderDiscoveryError> {
    let cancellation = DiscoveryCancellation::capture();
    cancellation.check("Claude Code")?;
    ensure_before_deadline(deadline)?;

    let provider_cwd = NeutralProviderCwd::new();
    let mut command = Command::new(executable);
    command
        .args(CLAUDE_DISCOVERY_ARGS)
        .current_dir(provider_cwd.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    apply_provider_path(&mut command);
    configure_process_group(&mut command);

    let mut child = command.spawn().map_err(|_| {
        discovery_error(
            ProviderDiscoveryErrorCode::SpawnFailed,
            "Could not start Claude model discovery",
        )
    })?;

    let Some(mut stdin) = child.stdin.take() else {
        kill_child_group(&mut child);
        let _ = child.wait();
        return Err(discovery_error(
            ProviderDiscoveryErrorCode::HandshakeFailed,
            "Claude model discovery stdin was unavailable",
        ));
    };
    let Some(stdout) = child.stdout.take() else {
        drop(stdin);
        kill_child_group(&mut child);
        let _ = child.wait();
        return Err(discovery_error(
            ProviderDiscoveryErrorCode::HandshakeFailed,
            "Claude model discovery stdout was unavailable",
        ));
    };

    let (sender, receiver) = mpsc::sync_channel(MAX_QUEUED_FRAMES);
    let reader = thread::spawn(move || read_stdout_frames(stdout, sender));

    let write_result = write_initialize_frame(&mut stdin);
    // Closing stdin proves there cannot be a later prompt or session frame and
    // lets compatible CLIs exit naturally after their initialization response.
    drop(stdin);

    let result = match write_result {
        Ok(()) => receive_catalog(&receiver, deadline, MAX_MODELS, cancellation),
        Err(error) => Err(error),
    };
    // Unblock a reader applying backpressure to hostile many-frame output.
    drop(receiver);

    // Always terminate and reap the whole group, including on successful
    // discovery, malformed output, output-limit failure, or timeout.
    kill_child_group(&mut child);
    let _ = child.wait();
    let _ = reader.join();

    result
}

pub(super) fn version_is_supported(version: &str) -> bool {
    let mut parts = version
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .split('.')
        .filter_map(|part| part.parse::<u64>().ok());
    let Some(major) = parts.next() else {
        return false;
    };
    let Some(minor) = parts.next() else {
        return false;
    };
    let Some(patch) = parts.next() else {
        return false;
    };
    (major, minor, patch) >= (2, 1, 50)
}

fn write_initialize_frame(stdin: &mut impl Write) -> Result<(), ProviderDiscoveryError> {
    let frame = json!({
        "type": "control_request",
        "request_id": INITIALIZE_REQUEST_ID,
        "request": {"subtype": "initialize"}
    });
    serde_json::to_writer(&mut *stdin, &frame).map_err(|_| {
        discovery_error(
            ProviderDiscoveryErrorCode::HandshakeFailed,
            "Could not encode the Claude model discovery request",
        )
    })?;
    stdin.write_all(b"\n").map_err(|_| {
        discovery_error(
            ProviderDiscoveryErrorCode::HandshakeFailed,
            "Could not write the Claude model discovery request",
        )
    })?;
    stdin.flush().map_err(|_| {
        discovery_error(
            ProviderDiscoveryErrorCode::HandshakeFailed,
            "Could not flush the Claude model discovery request",
        )
    })
}

enum ReaderEvent {
    Frame(Vec<u8>),
    End,
    ReadFailed,
    OutputLimitExceeded,
}

fn read_stdout_frames(stdout: ChildStdout, sender: mpsc::SyncSender<ReaderEvent>) {
    read_frames(stdout, sender);
}

fn read_frames(mut stdout: impl Read, sender: mpsc::SyncSender<ReaderEvent>) {
    let mut total = 0_usize;
    let mut frames = 0_usize;
    let mut frame = Vec::new();
    let mut chunk = [0_u8; READ_CHUNK_BYTES];

    loop {
        // Read at most one byte beyond the cap so oversized output is detected
        // without ever buffering an unbounded provider response.
        let remaining_with_sentinel = MAX_OUTPUT_BYTES.saturating_sub(total) + 1;
        let read_len = remaining_with_sentinel.min(chunk.len());
        match stdout.read(&mut chunk[..read_len]) {
            Ok(0) => {
                if !frame.is_empty() && !send_frame(&sender, frame, &mut frames) {
                    return;
                }
                let _ = sender.send(ReaderEvent::End);
                return;
            }
            Ok(read) => {
                total += read;
                if total > MAX_OUTPUT_BYTES {
                    let _ = sender.send(ReaderEvent::OutputLimitExceeded);
                    return;
                }
                for byte in &chunk[..read] {
                    if *byte == b'\n' {
                        if !frame.is_empty()
                            && !send_frame(&sender, std::mem::take(&mut frame), &mut frames)
                        {
                            return;
                        }
                    } else if *byte != b'\r' {
                        frame.push(*byte);
                    }
                }
            }
            Err(_) => {
                let _ = sender.send(ReaderEvent::ReadFailed);
                return;
            }
        }
    }
}

fn send_frame(sender: &mpsc::SyncSender<ReaderEvent>, frame: Vec<u8>, frames: &mut usize) -> bool {
    *frames += 1;
    if *frames > MAX_FRAMES {
        let _ = sender.send(ReaderEvent::OutputLimitExceeded);
        false
    } else {
        sender.send(ReaderEvent::Frame(frame)).is_ok()
    }
}

fn receive_catalog(
    receiver: &mpsc::Receiver<ReaderEvent>,
    deadline: Instant,
    model_limit: usize,
    cancellation: DiscoveryCancellation,
) -> Result<ClaudeCatalogResult, ProviderDiscoveryError> {
    loop {
        cancellation.check("Claude Code")?;
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or_else(|| {
                discovery_error(
                    ProviderDiscoveryErrorCode::TimedOut,
                    "Claude model discovery timed out",
                )
            })?;
        let event = match receiver.recv_timeout(remaining.min(CANCELLATION_POLL_INTERVAL)) {
            Ok(event) => event,
            Err(mpsc::RecvTimeoutError::Timeout) if remaining > CANCELLATION_POLL_INTERVAL => {
                continue;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return Err(discovery_error(
                    ProviderDiscoveryErrorCode::TimedOut,
                    "Claude model discovery timed out",
                ));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(discovery_error(
                    ProviderDiscoveryErrorCode::InvalidResponse,
                    "Claude model discovery ended without a catalog",
                ));
            }
        };

        match event {
            ReaderEvent::Frame(frame) => {
                if let Some(catalog) = protocol::parse_frame(&frame, model_limit)? {
                    return Ok(catalog);
                }
            }
            ReaderEvent::End => {
                return Err(discovery_error(
                    ProviderDiscoveryErrorCode::InvalidResponse,
                    "Claude model discovery ended without a catalog",
                ));
            }
            ReaderEvent::ReadFailed => {
                return Err(discovery_error(
                    ProviderDiscoveryErrorCode::InvalidResponse,
                    "Could not read Claude model discovery output",
                ));
            }
            ReaderEvent::OutputLimitExceeded => {
                return Err(discovery_error(
                    ProviderDiscoveryErrorCode::OutputLimit,
                    "Claude model discovery exceeded the output limit",
                ));
            }
        }
    }
}

fn ensure_before_deadline(deadline: Instant) -> Result<(), ProviderDiscoveryError> {
    if Instant::now() < deadline {
        Ok(())
    } else {
        Err(discovery_error(
            ProviderDiscoveryErrorCode::TimedOut,
            "Claude model discovery timed out",
        ))
    }
}

fn discovery_error(
    code: ProviderDiscoveryErrorCode,
    message: &'static str,
) -> ProviderDiscoveryError {
    let retryable = matches!(
        code,
        ProviderDiscoveryErrorCode::SpawnFailed
            | ProviderDiscoveryErrorCode::HandshakeFailed
            | ProviderDiscoveryErrorCode::TimedOut
            | ProviderDiscoveryErrorCode::Unavailable
    );
    ProviderDiscoveryError {
        code,
        message: message.to_string(),
        retryable,
    }
}
