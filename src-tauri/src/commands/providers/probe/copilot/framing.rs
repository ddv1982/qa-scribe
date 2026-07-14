use std::{
    io::{BufRead, BufReader, Read, Write},
    process::ChildStdout,
    sync::mpsc,
};

use serde_json::{Value, json};

use crate::commands::providers::{ProviderDiscoveryError, ProviderDiscoveryErrorCode};

use super::{
    MAX_FRAME_BYTES, MAX_FRAMES, MAX_HEADER_BYTES, MAX_TRANSACTION_BYTES, discovery_error,
};

pub(super) fn send_request(
    stdin: &mut impl Write,
    id: u64,
    method: &'static str,
) -> Result<(), ProviderDiscoveryError> {
    let body = serde_json::to_vec(&json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": {}
    }))
    .map_err(|_| {
        discovery_error(
            ProviderDiscoveryErrorCode::HandshakeFailed,
            "Could not encode a GitHub Copilot model discovery request.",
        )
    })?;
    write!(stdin, "Content-Length: {}\r\n\r\n", body.len())
        .and_then(|_| stdin.write_all(&body))
        .and_then(|_| stdin.flush())
        .map_err(|_| {
            discovery_error(
                ProviderDiscoveryErrorCode::HandshakeFailed,
                "Could not write a GitHub Copilot model discovery request.",
            )
        })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum FrameFailure {
    Malformed,
    OutputLimit,
    FrameLimit,
    ReadFailed,
}

pub(super) enum ReaderEvent {
    Frame(Value),
    End,
    Failed(FrameFailure),
}

#[derive(Default)]
pub(super) struct FrameBudget {
    pub(super) frames: usize,
    pub(super) bytes: usize,
}

pub(super) fn read_stdout_frames(stdout: ChildStdout, sender: mpsc::Sender<ReaderEvent>) {
    let mut reader = BufReader::new(stdout);
    let mut budget = FrameBudget::default();
    loop {
        match read_frame(&mut reader, &mut budget) {
            Ok(Some(value)) => {
                if sender.send(ReaderEvent::Frame(value)).is_err() {
                    return;
                }
            }
            Ok(None) => {
                let _ = sender.send(ReaderEvent::End);
                return;
            }
            Err(error) => {
                let _ = sender.send(ReaderEvent::Failed(error));
                return;
            }
        }
    }
}

pub(super) fn read_frame(
    reader: &mut impl BufRead,
    budget: &mut FrameBudget,
) -> Result<Option<Value>, FrameFailure> {
    if budget.frames >= MAX_FRAMES {
        return match reader.fill_buf() {
            Ok([]) => Ok(None),
            Ok(_) => Err(FrameFailure::FrameLimit),
            Err(_) => Err(FrameFailure::ReadFailed),
        };
    }

    let (header_bytes, content_length) = read_headers(reader)?;
    let Some(content_length) = content_length else {
        return if header_bytes == 0 {
            Ok(None)
        } else {
            Err(FrameFailure::Malformed)
        };
    };
    if content_length > MAX_FRAME_BYTES {
        return Err(FrameFailure::OutputLimit);
    }
    let transaction_bytes = header_bytes
        .checked_add(content_length)
        .and_then(|frame_bytes| budget.bytes.checked_add(frame_bytes))
        .ok_or(FrameFailure::OutputLimit)?;
    if transaction_bytes > MAX_TRANSACTION_BYTES {
        return Err(FrameFailure::OutputLimit);
    }

    let mut body = vec![0_u8; content_length];
    reader
        .read_exact(&mut body)
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::UnexpectedEof => FrameFailure::Malformed,
            _ => FrameFailure::ReadFailed,
        })?;
    let value = serde_json::from_slice(&body).map_err(|_| FrameFailure::Malformed)?;

    budget.frames += 1;
    budget.bytes = transaction_bytes;
    Ok(Some(value))
}

fn read_headers(reader: &mut impl BufRead) -> Result<(usize, Option<usize>), FrameFailure> {
    let mut header_bytes = 0_usize;
    let mut content_length = None;
    loop {
        let remaining = MAX_HEADER_BYTES.saturating_sub(header_bytes);
        if remaining == 0 {
            return Err(FrameFailure::OutputLimit);
        }

        let mut line = Vec::new();
        let read = reader
            .take((remaining + 1) as u64)
            .read_until(b'\n', &mut line)
            .map_err(|_| FrameFailure::ReadFailed)?;
        if read == 0 {
            return Ok((header_bytes, None));
        }
        header_bytes = header_bytes
            .checked_add(read)
            .ok_or(FrameFailure::OutputLimit)?;
        if header_bytes > MAX_HEADER_BYTES {
            return Err(FrameFailure::OutputLimit);
        }
        if !line.ends_with(b"\n") {
            return Err(FrameFailure::Malformed);
        }
        if line == b"\n" || line == b"\r\n" {
            return Ok((header_bytes, content_length));
        }

        let line = line.strip_suffix(b"\n").ok_or(FrameFailure::Malformed)?;
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        let line = std::str::from_utf8(line).map_err(|_| FrameFailure::Malformed)?;
        let (name, value) = line.split_once(':').ok_or(FrameFailure::Malformed)?;
        if name.eq_ignore_ascii_case("Content-Length") {
            if content_length.is_some() {
                return Err(FrameFailure::Malformed);
            }
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|_| FrameFailure::Malformed)?,
            );
        }
    }
}

pub(super) fn frame_error(failure: FrameFailure) -> ProviderDiscoveryError {
    match failure {
        FrameFailure::OutputLimit | FrameFailure::FrameLimit => discovery_error(
            ProviderDiscoveryErrorCode::OutputLimit,
            "GitHub Copilot model discovery exceeded the output limit.",
        ),
        FrameFailure::Malformed => discovery_error(
            ProviderDiscoveryErrorCode::InvalidResponse,
            "GitHub Copilot model discovery returned a malformed frame.",
        ),
        FrameFailure::ReadFailed => discovery_error(
            ProviderDiscoveryErrorCode::InvalidResponse,
            "Could not read GitHub Copilot model discovery output.",
        ),
    }
}
