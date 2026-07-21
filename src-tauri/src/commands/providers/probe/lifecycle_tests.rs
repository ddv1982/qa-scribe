use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

use crate::{jobs::JobControl, provider_command::ProviderPathMode};

use super::{ProbeRunner, SystemProbeRunner};

struct FakeProbeCli {
    directory: PathBuf,
    executable: PathBuf,
}

impl FakeProbeCli {
    fn new(script: &str) -> Self {
        let directory = std::env::temp_dir().join(format!(
            "qa-scribe-readiness-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir(&directory).expect("fake probe directory should create");
        let executable = directory.join("provider-probe");
        fs::write(&executable, script).expect("fake probe executable should write");
        let mut permissions = fs::metadata(&executable).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions)
            .expect("fake probe executable should be executable");
        Self {
            directory,
            executable,
        }
    }
}

impl Drop for FakeProbeCli {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

fn run(runner: &SystemProbeRunner, executable: &Path) -> super::CommandProbe {
    runner.run(&executable.to_string_lossy(), &[])
}

#[test]
fn private_scope_failure_prevents_probe_spawn() {
    let marker = std::env::temp_dir().join(format!(
        "qa-scribe-probe-spawn-marker-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let cli = FakeProbeCli::new(&format!("#!/bin/sh\ntouch '{}'\n", marker.display()));
    let blocked_parent = cli.directory.join("blocked-parent");
    fs::write(&blocked_parent, b"not a directory").expect("blocking file should create");
    let runner =
        SystemProbeRunner::with_provider_cwd_parent(ProviderPathMode::Fast, blocked_parent);

    let probe = run(&runner, &cli.executable);

    assert!(!probe.success);
    assert!(
        probe
            .scope_error
            .as_deref()
            .is_some_and(|error| error.contains("private working directory"))
    );
    assert!(probe.stderr.contains("provider was not started"));
    assert!(!marker.exists(), "probe subprocess must not have spawned");
}

#[test]
fn readiness_probe_observes_per_job_cancellation_and_reaps_child() {
    let cli = FakeProbeCli::new("#!/bin/sh\nsleep 120\n");
    let control = JobControl::default();
    let cancel_control = control.clone();
    let runner = SystemProbeRunner::for_job(ProviderPathMode::Fast, &control);
    let canceller = thread::spawn(move || {
        thread::sleep(Duration::from_millis(100));
        cancel_control
            .request_cancel()
            .expect("job cancellation should be recorded");
    });
    let started = Instant::now();

    let probe = run(&runner, &cli.executable);
    canceller.join().unwrap();

    assert!(!probe.success);
    assert!(probe.stderr.contains("provider probe was cancelled"));
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "readiness cancellation should not wait for the probe timeout"
    );
}

#[test]
fn successful_probe_cleans_its_owned_private_scope() {
    let cli = FakeProbeCli::new("#!/bin/sh\npwd\n");
    let runner = SystemProbeRunner::new(ProviderPathMode::Fast);

    let probe = run(&runner, &cli.executable);
    let observed_cwd = PathBuf::from(&probe.stdout);

    assert!(probe.success, "probe failed: {}", probe.stderr);
    assert!(
        observed_cwd
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("qa-scribe-provider-cwd-"))
    );
    assert!(
        !observed_cwd.exists(),
        "probe-owned private scope should be removed after completion"
    );
}
