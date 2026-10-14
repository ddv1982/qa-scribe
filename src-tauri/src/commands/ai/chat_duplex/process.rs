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

pub(super) fn read_lines(
    stdout: impl Read,
    sender: SyncSender<Result<Vec<u8>, String>>,
    line: usize,
    total: usize,
) {
    let mut reader = BufReader::new(stdout);
    let mut consumed = 0usize;
    let mut frames = 0usize;
    loop {
        let mut bytes = Vec::new();
        let result = (&mut reader)
            .take(line.saturating_add(1) as u64)
            .read_until(b'\n', &mut bytes);
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

pub(super) fn read_stderr(mut stderr: impl Read) -> Vec<u8> {
    const LIMIT: usize = 256 * 1024;
    let mut tail = VecDeque::new();
    let mut chunk = [0u8; 8192];
    loop {
        let count = match stderr.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        let overflow = (tail.len() + count).saturating_sub(LIMIT);
        tail.drain(..overflow);
        tail.extend(&chunk[..count]);
    }
    tail.into_iter().collect()
}
