use std::{
    fs::{self, File, OpenOptions},
    io::ErrorKind,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};

use crate::process_io::{configure_process_group, kill_child_group};

use super::CommandProbe;
use super::cancel::DiscoveryCancellation;

pub(in crate::commands::providers) const MAX_PROVIDER_OUTPUT_BYTES: u64 = 1024 * 1024;
static PROVIDER_PROBE_OUTPUT_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(in crate::commands::providers) fn run_command_with_timeout(
    command: Command,
    timeout: Duration,
) -> std::io::Result<Output> {
    let cancellation = DiscoveryCancellation::capture();
    run_command_with_cancellation_check(command, timeout, || cancellation.is_cancelled())
}

fn run_command_with_cancellation_check(
    mut command: Command,
    timeout: Duration,
    is_cancelled: impl Fn() -> bool,
) -> std::io::Result<Output> {
    if is_cancelled() {
        return Err(std::io::Error::new(
            ErrorKind::Interrupted,
            "provider probe was cancelled",
        ));
    }
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
        if is_cancelled() {
            kill_child_group(&mut child);
            let _ = child.wait();
            return Err(std::io::Error::new(
                ErrorKind::Interrupted,
                "provider probe was cancelled",
            ));
        }
        if let Some(status) = child.try_wait()? {
            if output_files.exceeds_limit(MAX_PROVIDER_OUTPUT_BYTES) {
                return Err(std::io::Error::new(
                    ErrorKind::InvalidData,
                    "provider probe exceeded the output limit",
                ));
            }
            let stdout = fs::read(&output_files.stdout_path)?;
            let stderr = fs::read(&output_files.stderr_path)?;
            return Ok(Output {
                status,
                stdout,
                stderr,
            });
        }

        if output_files.exceeds_limit(MAX_PROVIDER_OUTPUT_BYTES) {
            kill_child_group(&mut child);
            let _ = child.wait();
            return Err(std::io::Error::new(
                ErrorKind::InvalidData,
                "provider probe exceeded the output limit",
            ));
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

pub(in crate::commands::providers) struct ProbeOutputFiles {
    pub(in crate::commands::providers) stdout_path: PathBuf,
    pub(in crate::commands::providers) stderr_path: PathBuf,
}

impl ProbeOutputFiles {
    pub(in crate::commands::providers) fn new(output_id: u64) -> Self {
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

    pub(in crate::commands::providers) fn create(&self) -> std::io::Result<(File, File)> {
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

    fn exceeds_limit(&self, limit: u64) -> bool {
        [&self.stdout_path, &self.stderr_path]
            .into_iter()
            .filter_map(|path| fs::metadata(path).ok())
            .fold(0_u64, |total, metadata| {
                total.saturating_add(metadata.len())
            })
            > limit
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
    pub(in crate::commands::providers) fn from_output(output: Output) -> Self {
        Self {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
            not_found: false,
        }
    }

    pub(in crate::commands::providers) fn not_found() -> Self {
        Self {
            success: false,
            stdout: String::new(),
            stderr: "command not found".to_string(),
            not_found: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };

    use super::*;

    #[test]
    fn stdout_and_stderr_share_one_output_budget() {
        let output_id = PROVIDER_PROBE_OUTPUT_COUNTER.fetch_add(1, Ordering::Relaxed);
        let output_files = ProbeOutputFiles::new(output_id);
        let handles = output_files
            .create()
            .expect("probe files should be created");
        drop(handles);
        fs::write(&output_files.stdout_path, vec![b'a'; 600]).unwrap();
        fs::write(&output_files.stderr_path, vec![b'b'; 600]).unwrap();

        assert!(output_files.exceeds_limit(1_000));
        assert!(!output_files.exceeds_limit(1_200));
    }

    #[cfg(unix)]
    #[test]
    fn in_flight_cancellation_interrupts_and_reaps_the_probe() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancellation_signal = Arc::clone(&cancelled);
        let setter = thread::spawn(move || {
            thread::sleep(Duration::from_millis(100));
            cancellation_signal.store(true, Ordering::Release);
        });
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 120"]);
        let started = Instant::now();

        let error = run_command_with_cancellation_check(command, Duration::from_secs(10), || {
            cancelled.load(Ordering::Acquire)
        })
        .expect_err("the cancellation signal should interrupt the probe");
        setter.join().unwrap();

        assert_eq!(error.kind(), ErrorKind::Interrupted);
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
