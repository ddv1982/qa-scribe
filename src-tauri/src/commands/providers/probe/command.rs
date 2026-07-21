use std::{
    fs::{self, File, OpenOptions},
    io::ErrorKind,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

use crate::process_io::{configure_process_group, kill_child_group};

use super::CommandProbe;
use super::cancel::DiscoveryCancellation;

pub(in crate::commands::providers) const MAX_PROVIDER_OUTPUT_BYTES: u64 = 1024 * 1024;

#[cfg(test)]
pub(in crate::commands::providers) fn run_command_with_timeout(
    command: Command,
    timeout: Duration,
) -> std::io::Result<Output> {
    let cancellation = DiscoveryCancellation::capture();
    run_command_with_cancellation_check(command, timeout, || cancellation.is_cancelled())
}

pub(super) fn run_command_with_cancellation(
    command: Command,
    timeout: Duration,
    cancellation: &DiscoveryCancellation,
) -> std::io::Result<Output> {
    run_command_with_cancellation_check(command, timeout, || cancellation.is_cancelled())
}

fn run_command_with_cancellation_check(
    command: Command,
    timeout: Duration,
    is_cancelled: impl Fn() -> bool,
) -> std::io::Result<Output> {
    run_command_with_output_files(command, timeout, is_cancelled, ProbeOutputFiles::new())
}

fn run_command_with_output_files(
    mut command: Command,
    timeout: Duration,
    is_cancelled: impl Fn() -> bool,
    output_files: ProbeOutputFiles,
) -> std::io::Result<Output> {
    if is_cancelled() {
        return Err(std::io::Error::new(
            ErrorKind::Interrupted,
            "provider probe was cancelled",
        ));
    }
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
    directory_path: PathBuf,
    pub(in crate::commands::providers) stdout_path: PathBuf,
    pub(in crate::commands::providers) stderr_path: PathBuf,
}

impl ProbeOutputFiles {
    pub(in crate::commands::providers) fn new() -> Self {
        let directory_path = std::env::temp_dir().join(format!(
            "qa-scribe-provider-probe-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ));
        Self {
            stdout_path: directory_path.join("stdout"),
            stderr_path: directory_path.join("stderr"),
            directory_path,
        }
    }

    pub(in crate::commands::providers) fn create(&self) -> std::io::Result<(File, File)> {
        create_private_directory(&self.directory_path)?;
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
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

fn create_private_directory(path: &Path) -> std::io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)
}

impl Drop for ProbeOutputFiles {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory_path);
    }
}

impl CommandProbe {
    pub(in crate::commands::providers) fn from_output(output: Output) -> Self {
        Self {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
            not_found: false,
            scope_error: None,
        }
    }

    pub(in crate::commands::providers) fn not_found() -> Self {
        Self {
            success: false,
            stdout: String::new(),
            stderr: "command not found".to_string(),
            not_found: true,
            scope_error: None,
        }
    }

    pub(in crate::commands::providers) fn scope_unavailable(message: String) -> Self {
        Self {
            success: false,
            stdout: String::new(),
            stderr: message.clone(),
            not_found: false,
            scope_error: Some(message),
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
        let output_files = ProbeOutputFiles::new();
        let handles = output_files
            .create()
            .expect("probe files should be created");
        drop(handles);
        fs::write(&output_files.stdout_path, vec![b'a'; 600]).unwrap();
        fs::write(&output_files.stderr_path, vec![b'b'; 600]).unwrap();

        assert!(output_files.exceeds_limit(1_000));
        assert!(!output_files.exceeds_limit(1_200));
    }

    #[test]
    fn spawn_failure_removes_only_its_owned_output_directory() {
        let output_files = ProbeOutputFiles::new();
        let owned_directory = output_files.directory_path.clone();
        let ambient_output_files = ProbeOutputFiles::new();
        let ambient_directory = ambient_output_files.directory_path.clone();
        drop(
            ambient_output_files
                .create()
                .expect("ambient probe files should be created"),
        );

        let error = run_command_with_output_files(
            Command::new("qa-scribe-provider-probe-command-that-does-not-exist"),
            Duration::from_millis(10),
            || false,
            output_files,
        )
        .expect_err("missing command should fail to spawn");

        assert_eq!(error.kind(), ErrorKind::NotFound);
        assert!(!owned_directory.exists());
        assert!(ambient_directory.exists());
    }

    #[cfg(unix)]
    #[test]
    fn probe_output_directory_and_files_are_private() {
        use std::os::unix::fs::PermissionsExt;

        let output_files = ProbeOutputFiles::new();
        let handles = output_files
            .create()
            .expect("probe files should be created");
        drop(handles);

        assert_eq!(
            fs::metadata(&output_files.directory_path)
                .expect("directory metadata")
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        for path in [&output_files.stdout_path, &output_files.stderr_path] {
            assert_eq!(
                fs::metadata(path)
                    .expect("file metadata")
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
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
