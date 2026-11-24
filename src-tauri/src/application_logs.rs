use std::{
    ffi::OsString,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

use qa_scribe_core::domain::{QueriedApplicationLogs, ValidatedApplicationLogQuery};
use serde::Serialize;

use crate::{
    process_io::{configure_process_group, kill_child_group},
    provider_command::{
        NeutralProviderCwd, ProviderPathMode, provider_executable_path, provider_process_path,
    },
};

mod response;

const RAW_OUTPUT_MAX: u64 = 4 * 1024 * 1024;
const ERROR_OUTPUT_MAX: u64 = 16 * 1024;
const QUERY_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ApplicationLogAccess {
    Ready,
    Unsupported,
    CliMissing,
    ExtensionMissing,
    SignedOut,
    AccessDenied,
    Failed,
    TimedOut,
}

#[derive(Debug, PartialEq, Eq)]
pub enum LogQueryError {
    Access(ApplicationLogAccess),
    Cancelled,
    TooMuchOutput,
    InvalidResponse,
}

impl LogQueryError {
    pub fn message(&self) -> &'static str {
        match self {
            Self::Access(ApplicationLogAccess::Unsupported) => {
                "Application logs are available on macOS and Linux."
            }
            Self::Access(ApplicationLogAccess::CliMissing) => "Azure CLI (az) was not found.",
            Self::Access(ApplicationLogAccess::ExtensionMissing) => {
                "Install the Azure CLI extension with az extension add --name application-insights."
            }
            Self::Access(ApplicationLogAccess::SignedOut) => "Sign in to Azure CLI with az login.",
            Self::Access(ApplicationLogAccess::AccessDenied) => {
                "Azure denied access to an Application Insights target."
            }
            Self::Access(ApplicationLogAccess::TimedOut) => "The Azure CLI query timed out.",
            Self::Access(_) => {
                "Azure CLI could not run the query. Check the KQL and the target resource IDs."
            }
            Self::Cancelled => "The application log query was cancelled.",
            Self::TooMuchOutput => {
                "Azure returned too much data. Narrow the window or summarize the results in KQL."
            }
            Self::InvalidResponse => "Azure CLI returned an incomplete or invalid log response.",
        }
    }
}

fn resolve_az() -> Result<PathBuf, LogQueryError> {
    if !cfg!(any(target_os = "linux", target_os = "macos")) {
        return Err(LogQueryError::Access(ApplicationLogAccess::Unsupported));
    }
    let missing = LogQueryError::Access(ApplicationLogAccess::CliMissing);
    let fixture = provider_process_path("az")
        .map_err(|_| LogQueryError::Access(ApplicationLogAccess::CliMissing))?;
    if fixture.is_absolute() {
        return Ok(fixture);
    }
    if cfg!(feature = "e2e") {
        return Err(missing);
    }
    let path = provider_executable_path("az", ProviderPathMode::Fast).ok_or(missing)?;
    std::path::absolute(path).map_err(|_| LogQueryError::Access(ApplicationLogAccess::Failed))
}

pub fn run(
    query: &ValidatedApplicationLogQuery,
    cancelled: &AtomicBool,
) -> Result<QueriedApplicationLogs, LogQueryError> {
    execute(&resolve_az()?, query, cancelled, QUERY_TIMEOUT)
}

fn command_args(query: &ValidatedApplicationLogQuery, kql_path: &Path) -> Vec<OsString> {
    let mut from_file = OsString::from("@");
    from_file.push(kql_path);
    [
        "monitor".into(),
        "app-insights".into(),
        "query".into(),
        "--apps".into(),
        (&query.target.resource_id).into(),
        "--analytics-query".into(),
        from_file,
        "--start-time".into(),
        (&query.start).into(),
        "--end-time".into(),
        (&query.end).into(),
        "-o".into(),
        "json".into(),
    ]
    .into()
}

fn execute(
    az: &Path,
    query: &ValidatedApplicationLogQuery,
    cancelled: &AtomicBool,
    timeout: Duration,
) -> Result<QueriedApplicationLogs, LogQueryError> {
    let failed = |_| LogQueryError::Access(ApplicationLogAccess::Failed);
    if cancelled.load(Ordering::Acquire) {
        return Err(LogQueryError::Cancelled);
    }
    let cwd = NeutralProviderCwd::new().map_err(failed)?;
    let mut kql = tempfile::NamedTempFile::new_in(cwd.path()).map_err(failed)?;
    kql.write_all(query.kql.as_bytes()).map_err(failed)?;
    let mut command = Command::new(az);
    command
        .args(command_args(query, kql.path()))
        .current_dir(cwd.path())
        .env("AZURE_EXTENSION_USE_DYNAMIC_INSTALL", "no")
        .env("AZURE_CORE_COLLECT_TELEMETRY", "no")
        .env("AZURE_LOGGING_ENABLE_LOG_FILE", "false")
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    let mut child = command.spawn().map_err(|error| {
        LogQueryError::Access(if error.kind() == std::io::ErrorKind::NotFound {
            ApplicationLogAccess::CliMissing
        } else {
            ApplicationLogAccess::Failed
        })
    })?;
    let stdout = child.stdout.take().expect("piped Azure CLI stdout");
    let stderr = child.stderr.take().expect("piped Azure CLI stderr");
    let oversized = AtomicBool::new(false);
    let (status, out, err) = thread::scope(|scope| {
        let out = scope.spawn(|| read_output(stdout, RAW_OUTPUT_MAX, &oversized));
        let err = scope.spawn(|| read_output(stderr, ERROR_OUTPUT_MAX, &oversized));
        let started = Instant::now();
        let status = loop {
            if cancelled.load(Ordering::Acquire) {
                break Err(LogQueryError::Cancelled);
            }
            if started.elapsed() >= timeout {
                break Err(LogQueryError::Access(ApplicationLogAccess::TimedOut));
            }
            if oversized.load(Ordering::Acquire) {
                break Err(LogQueryError::TooMuchOutput);
            }
            match child.try_wait().map_err(failed) {
                Ok(None) => thread::sleep(Duration::from_millis(20)),
                Ok(Some(status)) => break Ok(status),
                Err(error) => break Err(error),
            }
        };
        // On ordinary exit, descendants can still hold the output pipes open.
        kill_child_group(&mut child);
        let _ = child.wait();
        (
            status,
            out.join().expect("Azure stdout reader"),
            err.join().expect("Azure stderr reader"),
        )
    });
    let status = status?;
    if oversized.load(Ordering::Acquire) {
        return Err(LogQueryError::TooMuchOutput);
    }
    let out = out.map_err(failed)?;
    let err = err.map_err(failed)?;
    let stderr = String::from_utf8_lossy(&err);
    if !status.success() {
        return Err(LogQueryError::Access(response::classify_error(&stderr)));
    }
    if response::indicates_partial_response(&stderr) {
        return Err(LogQueryError::InvalidResponse);
    }
    response::capture(query, &out)
}

fn read_output(stream: impl Read, limit: u64, oversized: &AtomicBool) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    stream.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        oversized.store(true, Ordering::Release);
    }
    Ok(bytes)
}

pub fn check(query: &ValidatedApplicationLogQuery, cancelled: &AtomicBool) -> ApplicationLogAccess {
    match run(query, cancelled) {
        Ok(_) => ApplicationLogAccess::Ready,
        Err(LogQueryError::Access(status)) => status,
        Err(_) => ApplicationLogAccess::Failed,
    }
}

#[cfg(test)]
mod tests;
