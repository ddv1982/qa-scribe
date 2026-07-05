use std::{
    fs::{self, File, OpenOptions},
    io::ErrorKind,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};

use crate::provider_command::{ProviderPathMode, apply_provider_path, provider_executable_path};

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
}

pub(super) struct SystemProbeRunner {
    path_mode: ProviderPathMode,
}

impl SystemProbeRunner {
    pub(super) fn new(path_mode: ProviderPathMode) -> Self {
        Self { path_mode }
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
}

pub(super) fn run_command_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> std::io::Result<Output> {
    let output_id = PROVIDER_PROBE_OUTPUT_COUNTER.fetch_add(1, Ordering::Relaxed);
    let output_files = ProbeOutputFiles::new(output_id);
    let (stdout, stderr) = output_files.create()?;
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
            let _ = child.kill();
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
