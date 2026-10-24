//! Pipe bounds and unconditional registered-process cleanup for duplex turns.
use crate::{jobs::JobControl, process_io::kill_child_group};
use std::{
    collections::VecDeque,
    io::{BufRead, BufReader, Read},
    sync::mpsc::{Receiver, SyncSender},
    thread::JoinHandle,
};

/// Drop bounded queues before joining to wake backpressured readers/writers.
pub(super) struct Peer<'a> {
    control: &'a JobControl,
    pub(super) sender: Option<SyncSender<Vec<u8>>>,
    pub(super) reader: Option<Receiver<Result<Vec<u8>, String>>>,
    pub(super) threads: Vec<JoinHandle<()>>,
    pub(super) stderr: Option<JoinHandle<Vec<u8>>>,
}

impl<'a> Peer<'a> {
    pub(super) fn new(control: &'a JobControl) -> Self {
        Self {
            control,
            sender: None,
            reader: None,
            threads: Vec::new(),
            stderr: None,
        }
    }

    pub(super) fn send(&self, message: &serde_json::Value, limit: usize) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(message).map_err(|error| error.to_string())?;
        if bytes.len() > limit {
            return Err("Provider input frame exceeded the safety limit".into());
        }
        bytes.push(b'\n');
        // Queueing is serialized with accepted cancellation, not the blocking
        // OS write. Cancellation kills the pipe to wake that write promptly.
        self.control
            .run_if_not_cancelled(|| {
                self.sender
                    .as_ref()
                    .ok_or("Provider stdin is closed")?
                    .try_send(bytes)
                    .map_err(|_| "Provider protocol write queue is full or closed")
            })?
            .ok_or_else(|| "Generation cancelled.".to_string())?
            .map_err(str::to_string)
    }

    pub(super) fn shutdown(&mut self) -> Vec<u8> {
        self.sender.take();
        self.reader.take();
        // Never wait for app-server OS exit or join a blocked pipe before kill.
        let _ = self.control.kill_registered_child();
        if let Ok(Some(mut child)) = self.control.take_child() {
            kill_child_group(&mut child);
            let _ = child.wait();
        }
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
        self.stderr
            .take()
            .and_then(|thread| thread.join().ok())
            .unwrap_or_default()
    }
}

impl Drop for Peer<'_> {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

#[cfg(test)]
pub(super) fn read_lines(
    stdout: impl Read,
    sender: SyncSender<Result<Vec<u8>, String>>,
    line: usize,
    total: usize,
) {
    read_lines_with_echo(stdout, sender, line, total, None)
}

pub(super) fn read_lines_with_echo(
    stdout: impl Read,
    sender: SyncSender<Result<Vec<u8>, String>>,
    line: usize,
    total: usize,
    mut echo: Option<ImageEchoPolicy>,
) {
    let mut reader = BufReader::new(stdout);
    let mut consumed = 0usize;
    let mut frames = 0usize;
    loop {
        let mut bytes = Vec::new();
        let result = (&mut reader)
            .take(
                echo.as_ref()
                    .map_or(line, |policy| policy.remaining_bytes.max(line))
                    .saturating_add(1) as u64,
            )
            .read_until(b'\n', &mut bytes);
        if result.is_ok() && echo.as_mut().is_some_and(|policy| policy.consume(&bytes)) {
            continue;
        }
        let error = match result {
            Ok(0) => return,
            Ok(_) if bytes.len() > line => {
                Some("Provider output line exceeded the safety limit".to_string())
            }
            Ok(count) => {
                consumed = consumed.saturating_add(count);
                frames += 1;
                if consumed > total {
                    Some("Provider output exceeded the total byte safety limit".into())
                } else if frames > 100_000 {
                    Some("Provider output exceeded the frame safety limit".into())
                } else {
                    None
                }
            }
            Err(error) => Some(format!("Could not read provider stdout: {error}")),
        };
        if let Some(error) = error {
            let _ = sender.send(Err(error));
            return;
        }
        if sender.send(Ok(bytes)).is_err() {
            return;
        }
    }
}

pub(super) enum DiagnosticCapture {
    Tail,
    Discard,
}

pub(super) fn read_stderr(mut stderr: impl Read, capture: DiagnosticCapture) -> Vec<u8> {
    const LIMIT: usize = 256 * 1024;
    let mut tail = VecDeque::new();
    let mut chunk = [0u8; 8192];
    loop {
        let count = match stderr.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        if matches!(capture, DiagnosticCapture::Discard) {
            continue;
        }
        let overflow = (tail.len() + count).saturating_sub(LIMIT);
        tail.drain(..overflow);
        tail.extend(&chunk[..count]);
    }
    tail.into_iter().collect()
}

pub(super) struct ImageEchoPolicy {
    provider: qa_scribe_core::domain::AiProvider,
    blocks: Vec<serde_json::Value>,
    remaining_bytes: usize,
}

impl ImageEchoPolicy {
    pub(super) fn new(
        input: &qa_scribe_core::chat::ChatInput,
        provider: qa_scribe_core::domain::AiProvider,
    ) -> Option<Self> {
        if !input.has_images() || provider == qa_scribe_core::domain::AiProvider::CodexCli {
            return None;
        }
        let blocks = input.content_blocks(provider);
        let remaining_bytes = blocks
            .iter()
            .map(|block| block.to_string().len() + 1)
            .sum::<usize>()
            .saturating_add(64 * 1024)
            .min(qa_scribe_core::chat::MAX_CHAT_INPUT_FRAME_BYTES);
        Some(Self {
            provider,
            blocks,
            remaining_bytes,
        })
    }

    fn consume(&mut self, bytes: &[u8]) -> bool {
        if self.blocks.is_empty() || bytes.len() > self.remaining_bytes {
            return false;
        }
        let Ok(frame) = serde_json::from_slice::<serde_json::Value>(bytes) else {
            return false;
        };
        let matches = match self.provider {
            qa_scribe_core::domain::AiProvider::ClaudeCode => {
                if frame["type"] != "user" || frame["message"]["role"] != "user" {
                    return false;
                }
                if frame["message"]["content"].as_array() != Some(&self.blocks) {
                    return false;
                }
                self.blocks.clear();
                true
            }
            qa_scribe_core::domain::AiProvider::CopilotCli => {
                if frame["method"] != "session/update"
                    || frame["params"]["update"]["sessionUpdate"] != "user_message_chunk"
                {
                    return false;
                }
                let content = &frame["params"]["update"]["content"];
                if content["type"] != "image" {
                    return false;
                }
                let Some(index) = self.blocks.iter().position(|block| block == content) else {
                    return false;
                };
                self.blocks.remove(index);
                true
            }
            _ => false,
        };
        if matches {
            self.remaining_bytes -= bytes.len();
        }
        matches
    }
}

#[cfg(test)]
mod tests;
