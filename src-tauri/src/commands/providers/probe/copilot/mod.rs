use std::{
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::Instant,
};

use serde_json::Value;

use crate::{
    commands::providers::{ProviderDiscoveryError, ProviderDiscoveryErrorCode},
    process_io::{configure_process_group, kill_child_group},
    provider_command::{NeutralProviderCwd, apply_provider_path},
};

mod framing;
mod normalization;
mod protocol;

#[cfg(test)]
mod tests;

use framing::{read_stdout_frames, send_request};
use normalization::parse_models;
use protocol::{ResponseRouter, RpcStage, parse_connect, parse_status, require_authenticated};

const COPILOT_PROTOCOL_VERSION: u64 = 3;
const MAX_FRAME_BYTES: usize = 1024 * 1024;
const MAX_TRANSACTION_BYTES: usize = 1024 * 1024;
const MAX_HEADER_BYTES: usize = 8 * 1024;
const MAX_FRAMES: usize = 1_024;
const MAX_MODELS: usize = 1_000;
const CONNECT_REQUEST_ID: u64 = 1;
const STATUS_REQUEST_ID: u64 = 2;
const AUTH_REQUEST_ID: u64 = 3;
const MODELS_REQUEST_ID: u64 = 4;
const SHUTDOWN_REQUEST_ID: u64 = 5;
const DISCOVERY_METHODS: [&str; 5] = [
    "connect",
    "status.get",
    "auth.getStatus",
    "models.list",
    "runtime.shutdown",
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct CopilotCatalogResult {
    pub(super) models: Vec<Value>,
    pub(super) cli_version: Option<String>,
}

/// Discover the catalog exposed by the logged-in Copilot CLI runtime.
///
/// This is a deliberately small, protocol-3 adapter rather than a general SDK
/// client. It never creates a session or sends prompt-bearing data, and every
/// provider value is rebuilt from an explicit allowlist before it leaves this
/// module.
pub(super) fn discover(
    executable: &Path,
    deadline: Instant,
) -> Result<CopilotCatalogResult, ProviderDiscoveryError> {
    super::cancel::DiscoveryCancellation::capture().check("GitHub Copilot")?;
    ensure_before_deadline(deadline)?;

    let provider_cwd = NeutralProviderCwd::new();
    let mut command = Command::new(executable);
    command
        .args(["--server", "--stdio", "--no-auto-update"])
        .current_dir(provider_cwd.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    apply_provider_path(&mut command);
    configure_process_group(&mut command);

    let child = command.spawn().map_err(|_| {
        discovery_error(
            ProviderDiscoveryErrorCode::SpawnFailed,
            "Could not start GitHub Copilot model discovery.",
        )
    })?;
    let mut child = ChildGuard::new(child);

    let Some(mut stdin) = child.child_mut().stdin.take() else {
        return Err(discovery_error(
            ProviderDiscoveryErrorCode::HandshakeFailed,
            "GitHub Copilot model discovery input was unavailable.",
        ));
    };
    let Some(stdout) = child.child_mut().stdout.take() else {
        drop(stdin);
        return Err(discovery_error(
            ProviderDiscoveryErrorCode::HandshakeFailed,
            "GitHub Copilot model discovery output was unavailable.",
        ));
    };

    let (sender, receiver) = mpsc::channel();
    let reader = thread::spawn(move || read_stdout_frames(stdout, sender));

    let result = (|| {
        let mut responses = ResponseRouter::new(&receiver);

        ensure_before_deadline(deadline)?;
        send_request(&mut stdin, CONNECT_REQUEST_ID, DISCOVERY_METHODS[0])?;
        let connect = responses.receive(CONNECT_REQUEST_ID, deadline, RpcStage::Connect)?;
        let connect_version = parse_connect(connect)?;

        ensure_before_deadline(deadline)?;
        send_request(&mut stdin, STATUS_REQUEST_ID, DISCOVERY_METHODS[1])?;
        let status = responses.receive(STATUS_REQUEST_ID, deadline, RpcStage::Status)?;
        let status_version = parse_status(status)?;

        ensure_before_deadline(deadline)?;
        send_request(&mut stdin, AUTH_REQUEST_ID, DISCOVERY_METHODS[2])?;
        let auth = responses.receive(AUTH_REQUEST_ID, deadline, RpcStage::Auth)?;
        require_authenticated(auth)?;

        ensure_before_deadline(deadline)?;
        send_request(&mut stdin, MODELS_REQUEST_ID, DISCOVERY_METHODS[3])?;
        let models = responses.receive(MODELS_REQUEST_ID, deadline, RpcStage::Models)?;
        let models = parse_models(models, MAX_MODELS)?;
        ensure_before_deadline(deadline)?;

        Ok(CopilotCatalogResult {
            models,
            cli_version: status_version.or(connect_version),
        })
    })();

    // This is the only permitted post-catalog RPC. It is intentionally
    // best-effort: the absolute discovery deadline also governs shutdown.
    if Instant::now() < deadline {
        let _ = send_request(&mut stdin, SHUTDOWN_REQUEST_ID, DISCOVERY_METHODS[4]);
    }
    drop(stdin);

    // Terminate and reap the entire process group on success and every error
    // path. Killing the child also releases a reader blocked on stdout.
    child.terminate();
    let _ = reader.join();

    result
}

struct ChildGuard {
    child: Option<Child>,
}

impl ChildGuard {
    fn new(child: Child) -> Self {
        Self { child: Some(child) }
    }

    fn child_mut(&mut self) -> &mut Child {
        self.child.as_mut().expect("child guard must own a process")
    }

    fn terminate(&mut self) {
        if let Some(mut child) = self.child.take() {
            kill_child_group(&mut child);
            let _ = child.wait();
        }
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        self.terminate();
    }
}

fn invalid_response() -> ProviderDiscoveryError {
    discovery_error(
        ProviderDiscoveryErrorCode::InvalidResponse,
        "GitHub Copilot model discovery returned an invalid response.",
    )
}

fn ensure_before_deadline(deadline: Instant) -> Result<(), ProviderDiscoveryError> {
    if Instant::now() < deadline {
        Ok(())
    } else {
        Err(discovery_error(
            ProviderDiscoveryErrorCode::TimedOut,
            "GitHub Copilot model discovery timed out.",
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
            | ProviderDiscoveryErrorCode::Network
            | ProviderDiscoveryErrorCode::RateLimited
            | ProviderDiscoveryErrorCode::Unavailable
    );
    ProviderDiscoveryError {
        code,
        message: message.to_string(),
        retryable,
    }
}
