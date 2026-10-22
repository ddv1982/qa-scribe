//! Bounded duplex stdio execution. Protocol completion, not server exit, owns
//! the turn outcome. Every return revokes pending UI permission and reaps peers.
use std::{
    collections::VecDeque,
    io::Write,
    path::Path,
    process::{Command, Stdio},
    sync::mpsc::{self, Receiver, TryRecvError},
    thread,
    time::{Duration, Instant},
};

use qa_scribe_core::{
    ai::{
        GenerationCommand, GenerationOutputFormat, ProviderExecutionError,
        ProviderGenerationOutput,
        chat_protocol::{ChatProtocol, ChatProtocolEvent, ChatProtocolPermission},
        stream::StreamUpdate,
    },
    domain::AiProvider,
};

use crate::{
    jobs::{
        ChatPermissionDecision, ChatPermissionDecisionRequest, ChatPermissionDetails,
        GenerationJobStatus, JobControl, JobStore,
    },
    process_io::{configure_process_group, kill_child_group},
    provider_command::{NeutralProviderCwd, apply_provider_path, provider_process_path},
};

mod process;
use process::{Peer, read_lines, read_stderr};

pub(crate) struct ChatDuplexContext<'a> {
    pub job_id: &'a str,
    pub jobs: &'a JobStore,
    pub control: &'a JobControl,
    pub provider: AiProvider,
    pub app_data_dir: &'a Path,
    pub model: &'a str,
    pub reasoning_effort: Option<&'a str>,
}

// Keep test bounds local to a call, not global environment variables shared by
// concurrently executing tests. Production callers use only run_chat_duplex.
struct DuplexLimits {
    watchdog: Duration,
    line_bytes: usize,
    total_bytes: usize,
}

pub(crate) fn run_chat_duplex(
    command: &GenerationCommand,
    context: &ChatDuplexContext<'_>,
    on_update: impl FnMut(StreamUpdate),
    on_status: impl FnMut(GenerationJobStatus),
) -> Result<ProviderGenerationOutput, ProviderExecutionError> {
    run_chat_duplex_with_limits(
        command,
        context,
        on_update,
        on_status,
        DuplexLimits {
            watchdog: Duration::from_secs(15 * 60),
            line_bytes: 1024 * 1024,
            total_bytes: qa_scribe_core::ai::MAX_PROVIDER_STDOUT_BYTES,
        },
    )
}

fn run_chat_duplex_with_limits(
    command: &GenerationCommand,
    context: &ChatDuplexContext<'_>,
    on_update: impl FnMut(StreamUpdate),
    on_status: impl FnMut(GenerationJobStatus),
    limits: DuplexLimits,
) -> Result<ProviderGenerationOutput, ProviderExecutionError> {
    execute_chat_duplex(command, context, on_update, on_status, limits).map_err(|mut error| {
        error.message = bounded_error_tail(&error.message);
        error
    })
}

// One outer boundary bounds every returned error, including setup failures and
// protocol errors without stderr. Match core's UTF-8-safe 1600-byte tail policy.
fn bounded_error_tail(error: &str) -> String {
    let mut start = error.len().saturating_sub(1600);
    while !error.is_char_boundary(start) {
        start += 1;
    }
    error[start..].to_string()
}

fn execute_chat_duplex(
    command: &GenerationCommand,
    context: &ChatDuplexContext<'_>,
    mut on_update: impl FnMut(StreamUpdate),
    mut on_status: impl FnMut(GenerationJobStatus),
    limits: DuplexLimits,
) -> Result<ProviderGenerationOutput, ProviderExecutionError> {
    if context.control.is_cancelled() {
        return Ok(output(None, true));
    }
    let cwd = if context.provider == AiProvider::CopilotCli {
        NeutralProviderCwd::persistent(&context.app_data_dir.join("copilot-chat"))
    } else {
        NeutralProviderCwd::new()
    }
    .map_err(|error| format!("The provider was not started: {error}"))?;
    let mut protocol = ChatProtocol::new(
        context.provider,
        &command.stdin,
        context.model,
        context.reasoning_effort,
        &cwd.path().to_string_lossy(),
    );
    if context.control.is_cancelled() {
        return Ok(output(None, true));
    }
    let executable = provider_process_path(&command.program)
        .map_err(|error| format!("Could not start provider: {error}"))?;
    let mut process = Command::new(executable);
    process
        .args(&command.args)
        .current_dir(cwd.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_provider_path(&mut process);
    configure_process_group(&mut process);
    let mut child = process
        .spawn()
        .map_err(|error| format!("Could not start provider: {error}"))?;
    let pipes = (child.stdin.take(), child.stdout.take(), child.stderr.take());
    let (Some(mut stdin), Some(stdout), Some(stderr)) = pipes else {
        kill_child_group(&mut child);
        let _ = child.wait();
        return Err("Provider stdio pipes were not available".into());
    };
    // Register before any pipe I/O. JobStore cancellation now kills the whole
    // group even if a writer is blocked or the peer has not emitted a byte.
    context.control.set_child(child)?;
    let mut peer = Peer::new(context.control);
    let permission_cleanup = PermissionCleanup(context);
    let (send, receive) = mpsc::sync_channel(8);
    let (writer_error, writer_errors) = mpsc::channel();
    peer.sender = Some(send);
    peer.threads.push(thread::spawn(move || {
        while let Ok(frame) = receive.recv() {
            if let Err(error) = stdin.write_all(&frame).and_then(|_| stdin.flush()) {
                let _ = writer_error.send(error.to_string());
                break;
            }
        }
    }));
    let (lines, reader) = mpsc::sync_channel(8);
    peer.reader = Some(reader);
    let line_limit = limits.line_bytes;
    let total_limit = limits.total_bytes;
    peer.threads.push(thread::spawn(move || {
        read_lines(stdout, lines, line_limit, total_limit)
    }));
    peer.stderr = Some(thread::spawn(move || read_stderr(stderr)));
    let started = Instant::now();
    let mut pending: Option<Receiver<ChatPermissionDecision>> = None;
    // Consent expires with this execution, including cancellation and retries.
    let mut approve_all = false;
    let mut exited_at: Option<Instant> = None;
    let mut writer_failure: Option<(String, Instant)> = None;
    let mut frames_since_service = 0usize;
    let mut priority_frames = VecDeque::new();
    let mut service_due = false;
    let result = (|| {
        peer.send(&protocol.initial_message(), limits.line_bytes)?;
        loop {
            if context.control.is_cancelled() {
                return Ok(None);
            }
            if started.elapsed() >= limits.watchdog {
                return Err("Generation timed out waiting for the provider. The provider process was stopped.".into());
            }
            // Pipe EOF does not identify parent exit: a descendant can retain
            // both pipes. Pending permission loses authority immediately.
            if context.control.child_exit_status()?.is_some() {
                let exited = exited_at.get_or_insert_with(Instant::now);
                if pending.is_some() {
                    return Err(
                        "Provider exited while a chat permission request was pending".into(),
                    );
                }
                if exited.elapsed() >= Duration::from_secs(2) {
                    return Err("Provider exited before completing the chat turn".into());
                }
            }
            // Poll independently of stdout idleness, but keep a bounded drain
            // grace so BrokenPipe cannot discard a buffered successful result.
            if let Ok(error) = writer_errors.try_recv() {
                writer_failure.get_or_insert((error, Instant::now()));
            }
            if let Some((error, failed_at)) = &writer_failure
                && (pending.is_some() || failed_at.elapsed() >= Duration::from_secs(2))
            {
                return Err(format!(
                    "Could not write provider protocol message: {error}"
                ));
            }
            // Service at least once per 16 frames even under continuous stdout.
            // Snapshot the bounded queue first, preserving already queued
            // cancellations/duplicates ahead of an approval. Do not drain a
            // continuously refilling queue indefinitely (auth-adapters.R39-02).
            if frames_since_service >= 16 && !service_due {
                priority_frames.extend(peer.reader.as_ref().unwrap().try_iter().take(8));
                service_due = true;
            }
            if service_due && priority_frames.is_empty() {
                if let Some(decision) = pending.as_ref() {
                    match decision.try_recv() {
                        Ok(decision) => {
                            // Re-check immediately before using a queued UI
                            // decision. Parent exit cannot authorize descendants.
                            if context.control.child_exit_status()?.is_some() {
                                return Err(
                                    "Provider exited before the chat permission decision".into()
                                );
                            }
                            approve_all |= decision == ChatPermissionDecision::ApproveAll;
                            let reply = protocol
                                .permission_reply(decision != ChatPermissionDecision::Deny)
                                .map_err(|error| error.to_string())?;
                            peer.send(&reply, limits.line_bytes)?;
                            pending = None;
                            on_status(
                                context
                                    .jobs
                                    .status(context.job_id)
                                    .map_err(|error| error.to_string())?,
                            );
                            if let Some(details) = protocol.take_queued_permission() {
                                pending = Some(publish_permission(
                                    context,
                                    details,
                                    approve_all,
                                    &mut on_status,
                                )?);
                            }
                        }
                        Err(TryRecvError::Empty) => {}
                        Err(TryRecvError::Disconnected) => {
                            if context.control.is_cancelled() {
                                return Ok(None);
                            }
                            return Err("Chat permission decision was revoked".into());
                        }
                    }
                }
                frames_since_service = 0;
                service_due = false;
            }
            let received = if let Some(frame) = priority_frames.pop_front() {
                Ok(frame)
            } else {
                peer.reader
                    .as_ref()
                    .unwrap()
                    .recv_timeout(Duration::from_millis(10))
            };
            let frame = match received {
                Ok(frame) => frame?,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    frames_since_service = 16;
                    continue;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("Provider closed stdout before completing the chat turn".into());
                }
            };
            frames_since_service += 1;
            let frame: serde_json::Value = serde_json::from_slice(&frame)
                .map_err(|error| format!("Invalid provider protocol JSON: {error}"))?;
            let handled = context
                .control
                .run_if_not_cancelled(|| protocol.handle(&frame))?;
            let Some(handled) = handled else {
                return Ok(None);
            };
            for event in handled.map_err(|error| error.to_string())? {
                match event {
                    ChatProtocolEvent::Send(message) => peer.send(&message, limits.line_bytes)?,
                    ChatProtocolEvent::Update(update) => on_update(update),
                    ChatProtocolEvent::Permission(details) => {
                        if pending.is_some() {
                            return Err("A chat permission request is already pending".into());
                        }
                        pending = Some(publish_permission(
                            context,
                            details,
                            approve_all,
                            &mut on_status,
                        )?);
                    }
                    ChatProtocolEvent::Complete => {
                        if pending.is_some() {
                            return Err(
                                "Provider completed with an unresolved permission request".into()
                            );
                        }
                        return protocol
                            .finish()
                            .map(Some)
                            .map_err(|error| error.to_string());
                    }
                }
            }
        }
    })();
    // Revocation is store-only: never manufacture a provider approval/denial
    // reply after a malformed frame, EOF, timeout or accepted cancellation.
    drop(permission_cleanup);
    if let Ok(status) = context.jobs.status(context.job_id) {
        on_status(status);
    }
    let model_report = protocol.model_report();
    let stderr = peer.shutdown();
    if context.control.is_cancelled() {
        let mut output = output(None, true);
        output.model_report = model_report;
        return Ok(output);
    }
    match result {
        Ok(text) => {
            let mut output = output(text, false);
            output.model_report = model_report;
            output.stderr = stderr;
            Ok(output)
        }
        Err(error) => {
            let diagnostic = String::from_utf8_lossy(&stderr);
            let message = if diagnostic.trim().is_empty() {
                error
            } else {
                format!("{error}: {}", diagnostic.trim())
            };
            Err(ProviderExecutionError {
                message,
                model_report,
            })
        }
    }
}

fn publish_permission(
    context: &ChatDuplexContext<'_>,
    details: ChatProtocolPermission,
    approve_all: bool,
    on_status: &mut impl FnMut(GenerationJobStatus),
) -> Result<Receiver<ChatPermissionDecision>, String> {
    if context.control.child_exit_status()?.is_some() {
        return Err("Provider exited before publishing chat permission".into());
    }
    let auto_approve = approve_all && details.can_approve;
    let (mut status, decision) = context
        .jobs
        .publish_chat_permission(
            context.job_id,
            ChatPermissionDetails {
                can_approve: details.can_approve,
                provider: context.provider,
                title: details.title,
                tool_name: details.tool_name,
                server_name: details.server_name,
                input_json: details.input_json,
            },
        )
        .map_err(|error| error.to_string())?;
    if auto_approve {
        let pending = status
            .pending_permission
            .as_ref()
            .ok_or("Missing chat permission")?;
        // Reuse click validation, including cancellation and Session deletion.
        // The peer still receives its original correlated once-only reply.
        status = context
            .jobs
            .decide_chat_permission(ChatPermissionDecisionRequest {
                job_id: status.job_id.clone(),
                session_id: status.session_id.clone(),
                request_id: pending.request_id.clone(),
                provider: pending.provider,
                decision: ChatPermissionDecision::Approve,
            })
            .map_err(|error| error.to_string())?;
    }
    on_status(status);
    Ok(decision)
}

fn output(text: Option<String>, cancelled: bool) -> ProviderGenerationOutput {
    ProviderGenerationOutput {
        exit_success: Some(!cancelled && text.is_some()),
        stdout: Vec::new(),
        stderr: Vec::new(),
        assistant_text: text,
        output_format: GenerationOutputFormat::PlainText,
        cancelled,
        model_report: None,
    }
}

struct PermissionCleanup<'a, 'b>(&'a ChatDuplexContext<'b>);

impl Drop for PermissionCleanup<'_, '_> {
    fn drop(&mut self) {
        let context = self.0;
        if let Ok(status) = context.jobs.status(context.job_id)
            && let Some(pending) = status.pending_permission
        {
            let _ = context
                .jobs
                .decide_chat_permission(ChatPermissionDecisionRequest {
                    job_id: status.job_id,
                    session_id: status.session_id,
                    request_id: pending.request_id,
                    provider: pending.provider,
                    decision: ChatPermissionDecision::Deny,
                });
        }
    }
}

#[cfg(test)]
mod tests;
