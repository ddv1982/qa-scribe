use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, ErrorKind, Write},
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::{
        OnceLock,
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};

use serde_json::{Value, json};

use crate::{
    commands::providers::{ProviderDiscoveryError, ProviderDiscoveryErrorCode},
    process_io::{configure_process_group, kill_child_group},
    provider_command::{
        NeutralProviderCwd, ProviderPathMode, apply_provider_path, provider_executable_path,
    },
};

const PROVIDER_PROBE_TIMEOUT: Duration = Duration::from_secs(4);
static PROVIDER_PROBE_OUTPUT_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(super) enum DetectionMode {
    Fast,
    Deep,
}

impl From<DetectionMode> for ProviderPathMode {
    fn from(mode: DetectionMode) -> Self {
        match mode {
            DetectionMode::Fast => ProviderPathMode::Fast,
            DetectionMode::Deep => ProviderPathMode::Deep,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct CommandProbe {
    pub(super) success: bool,
    pub(super) stdout: String,
    pub(super) stderr: String,
    pub(super) not_found: bool,
}

pub(super) trait ProbeRunner {
    fn executable_path(&self, program: &str) -> Option<PathBuf>;
    fn run(&self, program: &str, args: &[&str]) -> CommandProbe;
    fn codex_app_server_defaults(&self) -> CodexDefaultsProbe {
        CodexDefaultsProbe::NotAttempted
    }
}

pub(super) struct SystemProbeRunner {
    path_mode: ProviderPathMode,
    codex_defaults: OnceLock<CodexDefaultsProbe>,
}

impl SystemProbeRunner {
    pub(super) fn new(path_mode: ProviderPathMode) -> Self {
        Self {
            path_mode,
            codex_defaults: OnceLock::new(),
        }
    }
}

impl ProbeRunner for SystemProbeRunner {
    fn executable_path(&self, program: &str) -> Option<PathBuf> {
        provider_executable_path(program, self.path_mode)
    }

    fn run(&self, program: &str, args: &[&str]) -> CommandProbe {
        let mut command = Command::new(program);
        command.args(args);
        apply_provider_path(&mut command);
        if program == "copilot" {
            command.env("COPILOT_AUTO_UPDATE", "false");
        }

        match run_command_with_timeout(command, PROVIDER_PROBE_TIMEOUT) {
            Ok(output) => CommandProbe::from_output(output),
            Err(error) => CommandProbe {
                success: false,
                stdout: String::new(),
                stderr: error.to_string(),
                not_found: error.kind() == ErrorKind::NotFound,
            },
        }
    }

    fn codex_app_server_defaults(&self) -> CodexDefaultsProbe {
        if self.path_mode != ProviderPathMode::Deep {
            return CodexDefaultsProbe::NotAttempted;
        }
        self.codex_defaults
            .get_or_init(|| match read_codex_app_server_defaults() {
                Ok(defaults) => CodexDefaultsProbe::Success(defaults),
                Err(error) => CodexDefaultsProbe::Failed(error),
            })
            .clone()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct CodexAppServerDefaults {
    pub(super) config: Value,
    pub(super) models: Vec<Value>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum CodexDefaultsProbe {
    NotAttempted,
    Success(CodexAppServerDefaults),
    Failed(ProviderDiscoveryError),
}

fn read_codex_app_server_defaults() -> Result<CodexAppServerDefaults, ProviderDiscoveryError> {
    let provider_cwd = NeutralProviderCwd::new();
    let mut command = Command::new("codex");
    command.arg("app-server").current_dir(provider_cwd.path());
    apply_provider_path(&mut command);
    configure_process_group(&mut command);
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| discovery_error(ProviderDiscoveryErrorCode::SpawnFailed, error))?;
    let Some(mut stdin) = child.stdin.take() else {
        kill_child_group(&mut child);
        let _ = child.wait();
        return Err(discovery_error(
            ProviderDiscoveryErrorCode::HandshakeFailed,
            "Codex app-server stdin was unavailable",
        ));
    };
    let Some(stdout) = child.stdout.take() else {
        kill_child_group(&mut child);
        let _ = child.wait();
        return Err(discovery_error(
            ProviderDiscoveryErrorCode::HandshakeFailed,
            "Codex app-server stdout was unavailable",
        ));
    };
    let (sender, receiver) = mpsc::channel();
    let reader = thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                let _ = sender.send(value);
            }
        }
    });

    let result = (|| {
        let mut responses = ResponseRouter::new(&receiver);
        send_request(
            &mut stdin,
            &json!({
                "method": "initialize",
                "id": 0,
                "params": {
                    "clientInfo": {"name": "qa-scribe", "version": env!("CARGO_PKG_VERSION")},
                    "capabilities": {}
                }
            }),
        )?;
        responses.receive(0, PROVIDER_PROBE_TIMEOUT)?;

        send_request(&mut stdin, &json!({"method": "initialized", "params": {}}))?;
        send_request(
            &mut stdin,
            &json!({
                "method": "config/read",
                "id": 1,
                "params": {
                    "cwd": provider_cwd.path().to_string_lossy(),
                    "includeLayers": false
                }
            }),
        )?;
        send_request(
            &mut stdin,
            &json!({"method": "model/list", "id": 2, "params": {"limit": 100}}),
        )?;

        // Responses are deliberately requested together. The router keeps
        // out-of-order responses instead of discarding the one for the other
        // request ID.
        let config = responses.receive(1, PROVIDER_PROBE_TIMEOUT)?;
        let page = responses.receive(2, PROVIDER_PROBE_TIMEOUT)?;
        let models = collect_model_pages(page, |request_id, cursor| {
            send_request(
                &mut stdin,
                &json!({
                    "method": "model/list",
                    "id": request_id,
                    "params": {"limit": 100, "cursor": cursor}
                }),
            )?;
            responses.receive(request_id, PROVIDER_PROBE_TIMEOUT)
        })?;
        Ok(CodexAppServerDefaults { config, models })
    })();

    drop(stdin);
    kill_child_group(&mut child);
    let _ = child.wait();
    let _ = reader.join();
    result
}

struct ResponseRouter<'a> {
    receiver: &'a mpsc::Receiver<Value>,
    pending: HashMap<i64, Value>,
}

impl<'a> ResponseRouter<'a> {
    fn new(receiver: &'a mpsc::Receiver<Value>) -> Self {
        Self {
            receiver,
            pending: HashMap::new(),
        }
    }

    fn receive(&mut self, id: i64, timeout: Duration) -> Result<Value, ProviderDiscoveryError> {
        if let Some(value) = self.pending.remove(&id) {
            return response_result(value);
        }
        let started_at = Instant::now();
        loop {
            let remaining = timeout.checked_sub(started_at.elapsed()).ok_or_else(|| {
                discovery_error(
                    ProviderDiscoveryErrorCode::TimedOut,
                    format!("Codex app-server request {id} timed out"),
                )
            })?;
            let value = self.receiver.recv_timeout(remaining).map_err(|error| {
                let code = match error {
                    mpsc::RecvTimeoutError::Timeout => ProviderDiscoveryErrorCode::TimedOut,
                    mpsc::RecvTimeoutError::Disconnected => {
                        ProviderDiscoveryErrorCode::InvalidResponse
                    }
                };
                discovery_error(
                    code,
                    format!("Codex app-server request {id} failed: {error}"),
                )
            })?;
            let Some(response_id) = value.get("id").and_then(Value::as_i64) else {
                continue;
            };
            if response_id == id {
                return response_result(value);
            }
            self.pending.insert(response_id, value);
        }
    }
}

fn response_result(value: Value) -> Result<Value, ProviderDiscoveryError> {
    if let Some(error) = value.get("error") {
        let code = if error.get("code").and_then(Value::as_i64) == Some(-32601) {
            ProviderDiscoveryErrorCode::Unsupported
        } else {
            ProviderDiscoveryErrorCode::InvalidResponse
        };
        return Err(discovery_error(
            code,
            format!("Codex app-server returned an error: {error}"),
        ));
    }
    value.get("result").cloned().ok_or_else(|| {
        discovery_error(
            ProviderDiscoveryErrorCode::InvalidResponse,
            "Codex app-server response did not include a result",
        )
    })
}

fn send_request(stdin: &mut impl Write, request: &Value) -> Result<(), ProviderDiscoveryError> {
    writeln!(stdin, "{request}").map_err(|error| {
        discovery_error(
            ProviderDiscoveryErrorCode::HandshakeFailed,
            format!("Could not write to Codex app-server: {error}"),
        )
    })
}

fn model_page_data(page: &Value) -> Result<Vec<Value>, ProviderDiscoveryError> {
    page.get("data")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| {
            discovery_error(
                ProviderDiscoveryErrorCode::InvalidResponse,
                "Codex model catalog response did not include a data array",
            )
        })
}

fn next_cursor(page: &Value) -> Option<&str> {
    page.get("nextCursor")
        .or_else(|| page.get("next_cursor"))
        .and_then(Value::as_str)
        .filter(|cursor| !cursor.is_empty())
}

fn collect_model_pages(
    mut page: Value,
    mut fetch: impl FnMut(i64, &str) -> Result<Value, ProviderDiscoveryError>,
) -> Result<Vec<Value>, ProviderDiscoveryError> {
    let mut models = model_page_data(&page)?;
    let mut request_id = 3_i64;
    let mut page_count = 1_u16;
    while let Some(cursor) = next_cursor(&page).map(str::to_string) {
        if page_count >= 100 {
            return Err(discovery_error(
                ProviderDiscoveryErrorCode::InvalidResponse,
                "Codex returned more than 100 model catalog pages",
            ));
        }
        page = fetch(request_id, &cursor)?;
        models.extend(model_page_data(&page)?);
        request_id += 1;
        page_count += 1;
    }
    Ok(models)
}

fn discovery_error(
    code: ProviderDiscoveryErrorCode,
    message: impl std::fmt::Display,
) -> ProviderDiscoveryError {
    ProviderDiscoveryError {
        code,
        message: message.to_string(),
        retryable: true,
    }
}

pub(super) fn run_command_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> std::io::Result<Output> {
    let output_id = PROVIDER_PROBE_OUTPUT_COUNTER.fetch_add(1, Ordering::Relaxed);
    let output_files = ProbeOutputFiles::new(output_id);
    let (stdout, stderr) = output_files.create()?;
    configure_process_group(&mut command);
    let mut child = command
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()?;
    let started_at = Instant::now();

    loop {
        if let Some(status) = child.try_wait()? {
            let stdout = fs::read(&output_files.stdout_path)?;
            let stderr = fs::read(&output_files.stderr_path)?;
            return Ok(Output {
                status,
                stdout,
                stderr,
            });
        }

        if started_at.elapsed() >= timeout {
            kill_child_group(&mut child);
            let _ = child.wait();
            return Err(std::io::Error::new(
                ErrorKind::TimedOut,
                format!("provider probe timed out after {}s", timeout.as_secs()),
            ));
        }

        thread::sleep(Duration::from_millis(25));
    }
}

pub(super) struct ProbeOutputFiles {
    pub(super) stdout_path: PathBuf,
    pub(super) stderr_path: PathBuf,
}

impl ProbeOutputFiles {
    pub(super) fn new(output_id: u64) -> Self {
        Self {
            stdout_path: std::env::temp_dir().join(format!(
                "qa-scribe-provider-probe-{}-{output_id}.stdout",
                std::process::id()
            )),
            stderr_path: std::env::temp_dir().join(format!(
                "qa-scribe-provider-probe-{}-{output_id}.stderr",
                std::process::id()
            )),
        }
    }

    pub(super) fn create(&self) -> std::io::Result<(File, File)> {
        let stdout = exclusive_output_file(&self.stdout_path)?;
        let stderr = match exclusive_output_file(&self.stderr_path) {
            Ok(stderr) => stderr,
            Err(error) => {
                let _ = fs::remove_file(&self.stdout_path);
                return Err(error);
            }
        };
        Ok((stdout, stderr))
    }
}

fn exclusive_output_file(path: &Path) -> std::io::Result<File> {
    OpenOptions::new().write(true).create_new(true).open(path)
}

impl Drop for ProbeOutputFiles {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.stdout_path);
        let _ = fs::remove_file(&self.stderr_path);
    }
}

impl CommandProbe {
    fn from_output(output: Output) -> Self {
        Self {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
            not_found: false,
        }
    }

    pub(super) fn not_found() -> Self {
        Self {
            success: false,
            stdout: String::new(),
            stderr: "command not found".to_string(),
            not_found: true,
        }
    }

    pub(super) fn failure_detail(&self) -> Option<&str> {
        if !self.stderr.is_empty() {
            Some(self.stderr.as_str())
        } else if !self.stdout.is_empty() {
            Some(self.stdout.as_str())
        } else {
            None
        }
    }
}

#[cfg(test)]
mod protocol_tests;
