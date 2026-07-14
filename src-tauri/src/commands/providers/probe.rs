use std::{
    collections::HashMap,
    io::{BufRead, BufReader, ErrorKind, Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{OnceLock, mpsc},
    thread,
    time::{Duration, Instant},
};

use qa_scribe_core::domain::AiProvider;
use serde_json::{Value, json};

use crate::{
    commands::providers::{ProviderDiscoveryError, ProviderDiscoveryErrorCode},
    process_io::{configure_process_group, kill_child_group},
    provider_command::{
        NeutralProviderCwd, ProviderPathMode, apply_provider_path, provider_executable_path,
    },
};

mod cancel;
mod claude;
mod command;
mod copilot;
mod identity;

pub(super) use cancel::cancel_all_provider_discovery;
use cancel::{CANCELLATION_POLL_INTERVAL, DiscoveryCancellation};
#[cfg(test)]
pub(super) use command::ProbeOutputFiles;
pub(super) use command::{MAX_PROVIDER_OUTPUT_BYTES, run_command_with_timeout};
use identity::{discovery_cache_fingerprint, provider_executable};

const PROVIDER_PROBE_TIMEOUT: Duration = Duration::from_secs(4);
const PROVIDER_TRANSACTION_TIMEOUT: Duration = Duration::from_secs(12);
pub(super) const MAX_PROVIDER_MODELS: usize = 1_000;

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
    fn cache_fingerprint(&self, _provider: AiProvider) -> u64 {
        0
    }
    fn codex_app_server_defaults(&self) -> CodexDefaultsProbe {
        CodexDefaultsProbe::NotAttempted
    }
    fn claude_structured_catalog(&self) -> StructuredCatalogProbe {
        StructuredCatalogProbe::NotAttempted
    }
    fn copilot_structured_catalog(&self) -> StructuredCatalogProbe {
        StructuredCatalogProbe::NotAttempted
    }
}

pub(super) struct SystemProbeRunner {
    path_mode: ProviderPathMode,
    deadline: Instant,
    codex_defaults: OnceLock<CodexDefaultsProbe>,
    claude_catalog: OnceLock<StructuredCatalogProbe>,
    copilot_catalog: OnceLock<StructuredCatalogProbe>,
}

impl SystemProbeRunner {
    pub(super) fn new(path_mode: ProviderPathMode) -> Self {
        Self {
            path_mode,
            deadline: Instant::now() + PROVIDER_TRANSACTION_TIMEOUT,
            codex_defaults: OnceLock::new(),
            claude_catalog: OnceLock::new(),
            copilot_catalog: OnceLock::new(),
        }
    }

    fn remaining(&self) -> Duration {
        self.deadline
            .saturating_duration_since(Instant::now())
            .min(PROVIDER_PROBE_TIMEOUT)
    }
}

impl ProbeRunner for SystemProbeRunner {
    fn executable_path(&self, program: &str) -> Option<PathBuf> {
        provider_executable_path(program, self.path_mode)
    }

    fn run(&self, program: &str, args: &[&str]) -> CommandProbe {
        let executable = provider_executable_path(program, self.path_mode)
            .unwrap_or_else(|| PathBuf::from(program));
        let provider_cwd = NeutralProviderCwd::new();
        let mut command = Command::new(executable);
        command.args(args);
        command.current_dir(provider_cwd.path());
        apply_provider_path(&mut command);
        if program == "copilot" {
            command.env("COPILOT_AUTO_UPDATE", "false");
        }

        match run_command_with_timeout(command, self.remaining()) {
            Ok(output) => CommandProbe::from_output(output),
            Err(error) => CommandProbe {
                success: false,
                stdout: String::new(),
                stderr: error.to_string(),
                not_found: error.kind() == ErrorKind::NotFound,
            },
        }
    }

    fn cache_fingerprint(&self, provider: AiProvider) -> u64 {
        discovery_cache_fingerprint(
            provider,
            provider_executable_path(provider_executable(provider), self.path_mode).as_deref(),
        )
    }

    fn codex_app_server_defaults(&self) -> CodexDefaultsProbe {
        if self.path_mode != ProviderPathMode::Deep {
            return CodexDefaultsProbe::NotAttempted;
        }
        self.codex_defaults
            .get_or_init(|| match read_codex_app_server_defaults(self.deadline) {
                Ok(defaults) => CodexDefaultsProbe::Success(defaults),
                Err(error) => CodexDefaultsProbe::Failed(error),
            })
            .clone()
    }

    fn claude_structured_catalog(&self) -> StructuredCatalogProbe {
        if self.path_mode != ProviderPathMode::Deep {
            return StructuredCatalogProbe::NotAttempted;
        }
        self.claude_catalog
            .get_or_init(|| {
                let Some(executable) = provider_executable_path("claude", self.path_mode) else {
                    return StructuredCatalogProbe::NotAttempted;
                };
                let version = self.run("claude", &["--version"]);
                if !version.success || !claude::version_is_supported(&version.stdout) {
                    return StructuredCatalogProbe::Failed(ProviderDiscoveryError {
                        code: ProviderDiscoveryErrorCode::Unsupported,
                        message: "This Claude Code version does not support safe model discovery."
                            .to_string(),
                        retryable: false,
                    });
                }
                match claude::discover(&executable, self.deadline) {
                    Ok(result) => StructuredCatalogProbe::Success(StructuredCatalog {
                        models: result.models,
                        cli_version: Some(version.stdout),
                    }),
                    Err(error) => StructuredCatalogProbe::Failed(error),
                }
            })
            .clone()
    }

    fn copilot_structured_catalog(&self) -> StructuredCatalogProbe {
        if self.path_mode != ProviderPathMode::Deep {
            return StructuredCatalogProbe::NotAttempted;
        }
        self.copilot_catalog
            .get_or_init(|| {
                let Some(executable) = provider_executable_path("copilot", self.path_mode) else {
                    return StructuredCatalogProbe::NotAttempted;
                };
                match copilot::discover(&executable, self.deadline) {
                    Ok(result) => StructuredCatalogProbe::Success(StructuredCatalog {
                        models: result.models,
                        cli_version: result.cli_version,
                    }),
                    Err(error) => StructuredCatalogProbe::Failed(error),
                }
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct StructuredCatalog {
    pub(super) models: Vec<Value>,
    pub(super) cli_version: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum StructuredCatalogProbe {
    NotAttempted,
    Success(StructuredCatalog),
    Failed(ProviderDiscoveryError),
}

fn read_codex_app_server_defaults(
    deadline: Instant,
) -> Result<CodexAppServerDefaults, ProviderDiscoveryError> {
    DiscoveryCancellation::capture().check("Codex")?;
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
    let reader = thread::spawn(move || read_bounded_json_lines(stdout, sender));

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
        responses.receive(0, deadline)?;

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

        let config = responses.receive(1, deadline)?;
        let page = responses.receive(2, deadline)?;
        let models = collect_model_pages(page, |request_id, cursor| {
            send_request(
                &mut stdin,
                &json!({
                    "method": "model/list",
                    "id": request_id,
                    "params": {"limit": 100, "cursor": cursor}
                }),
            )?;
            responses.receive(request_id, deadline)
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
    receiver: &'a mpsc::Receiver<JsonLineEvent>,
    pending: HashMap<i64, Value>,
    cancellation: DiscoveryCancellation,
}

impl<'a> ResponseRouter<'a> {
    fn new(receiver: &'a mpsc::Receiver<JsonLineEvent>) -> Self {
        Self {
            receiver,
            pending: HashMap::new(),
            cancellation: DiscoveryCancellation::capture(),
        }
    }

    fn receive(&mut self, id: i64, deadline: Instant) -> Result<Value, ProviderDiscoveryError> {
        if let Some(value) = self.pending.remove(&id) {
            return response_result(value);
        }
        loop {
            self.cancellation.check("Codex")?;
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or_else(|| {
                    discovery_error(
                        ProviderDiscoveryErrorCode::TimedOut,
                        format!("Codex app-server request {id} timed out"),
                    )
                })?;
            let event = match self
                .receiver
                .recv_timeout(remaining.min(CANCELLATION_POLL_INTERVAL))
            {
                Ok(event) => event,
                Err(mpsc::RecvTimeoutError::Timeout) if remaining > CANCELLATION_POLL_INTERVAL => {
                    continue;
                }
                Err(error) => {
                    let code = match error {
                        mpsc::RecvTimeoutError::Timeout => ProviderDiscoveryErrorCode::TimedOut,
                        mpsc::RecvTimeoutError::Disconnected => {
                            ProviderDiscoveryErrorCode::InvalidResponse
                        }
                    };
                    return Err(discovery_error(
                        code,
                        format!("Codex app-server request {id} failed: {error}"),
                    ));
                }
            };
            let value = match event {
                JsonLineEvent::Value(value) => value,
                JsonLineEvent::OutputLimit => {
                    return Err(discovery_error(
                        ProviderDiscoveryErrorCode::OutputLimit,
                        "Codex app-server output exceeded the safety limit",
                    ));
                }
            };
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

enum JsonLineEvent {
    Value(Value),
    OutputLimit,
}

fn read_bounded_json_lines(stdout: impl Read, sender: mpsc::Sender<JsonLineEvent>) {
    let mut total = 0_u64;
    let reader = BufReader::new(stdout).take(MAX_PROVIDER_OUTPUT_BYTES + 1);
    for line in reader.lines().map_while(Result::ok) {
        total = total.saturating_add(line.len() as u64 + 1);
        if total > MAX_PROVIDER_OUTPUT_BYTES {
            let _ = sender.send(JsonLineEvent::OutputLimit);
            return;
        }
        if let Ok(value) = serde_json::from_str::<Value>(&line)
            && sender.send(JsonLineEvent::Value(value)).is_err()
        {
            return;
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
            "Codex app-server returned an error response",
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
    loop {
        if models.len() > MAX_PROVIDER_MODELS {
            return Err(discovery_error(
                ProviderDiscoveryErrorCode::OutputLimit,
                "Codex returned too many model catalog entries",
            ));
        }
        let Some(cursor) = next_cursor(&page).map(str::to_string) else {
            break;
        };
        if page_count >= 32 {
            return Err(discovery_error(
                ProviderDiscoveryErrorCode::InvalidResponse,
                "Codex returned too many model catalog pages",
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

#[cfg(test)]
mod protocol_tests;
