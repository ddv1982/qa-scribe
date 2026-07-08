use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};

use qa_scribe_core::ai::{
    GenerationCommand, GenerationOutputFormat, run_streaming_generation, stream::StreamUpdate,
};

use super::{ProcessProviderExecutor, run_generation_command_streaming};
use crate::jobs::JobControl;
use crate::process_io::configure_process_group;

/// Monotonic counter making every [`FakeCli`] path globally unique, so two
/// instances built with the same `name` on the same thread never collide on
/// one path. Reusing a path means writing an executable to a location a
/// just-dropped instance removed and immediately exec'ing it, which races the
/// write and returns `ETXTBSY` ("Text file busy") on Linux.
static FAKE_CLI_SEQ: AtomicU64 = AtomicU64::new(0);

/// A tiny fake provider CLI written to a temp dir. Each instance gets its own
/// directory so parallel test runs do not collide.
struct FakeCli {
    dir: PathBuf,
    path: PathBuf,
}

impl FakeCli {
    fn new(name: &str, script: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "qa-scribe-fake-cli-{}-{}-{:?}-{}",
            name,
            std::process::id(),
            thread::current().id(),
            FAKE_CLI_SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).expect("fake cli dir is created");
        let path = dir.join(name);
        fs::write(&path, script).expect("fake cli script is written");
        let mut permissions = fs::metadata(&path)
            .expect("fake cli metadata exists")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).expect("fake cli is executable");
        Self { dir, path }
    }

    fn command(&self, stdin: String, output_format: GenerationOutputFormat) -> GenerationCommand {
        GenerationCommand {
            program: self.path.to_string_lossy().to_string(),
            args: Vec::new(),
            stdin,
            output_format,
        }
    }
}

impl Drop for FakeCli {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

/// Run `f` on a worker thread and fail (rather than hang the whole test
/// suite) if it does not finish within `deadline`. A regression that
/// reintroduces a deadlock then fails loudly instead of hanging CI.
fn run_bounded<T: Send + 'static>(deadline: Duration, f: impl FnOnce() -> T + Send + 'static) -> T {
    let (tx, rx) = mpsc::channel();
    let handle = thread::spawn(move || {
        let _ = tx.send(f());
    });
    match rx.recv_timeout(deadline) {
        Ok(value) => {
            let _ = handle.join();
            value
        }
        Err(_) => panic!("operation did not finish within {deadline:?} (possible deadlock)"),
    }
}

/// Run the pwd-reporting fake CLI once and return the working directory the
/// child observed.
///
/// Spawning a freshly written executable can transiently fail with `ETXTBSY`
/// ("Text file busy") when a concurrent test's `fork` momentarily holds a
/// write handle to it — an environmental race unrelated to the cwd behavior
/// under test. Retry a bounded number of times on that specific error with a
/// fresh binary each attempt.
fn reported_provider_cwd() -> PathBuf {
    for attempt in 0.. {
        let cli = FakeCli::new("fake-pwd", "#!/bin/sh\ncat >/dev/null\npwd\n");
        let command = cli.command("prompt".to_string(), GenerationOutputFormat::PlainText);
        let control = JobControl::default();

        let output = run_bounded(Duration::from_secs(10), move || {
            run_generation_command_streaming(&command, &control, |_| {})
        });

        match output {
            Ok(output) => {
                assert!(output.success(), "expected success, got {output:?}");
                return PathBuf::from(output.response_text().trim());
            }
            Err(error) if error.contains("Text file busy") && attempt < 5 => {
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) => panic!("streaming completes: {error:?}"),
        }
    }
    unreachable!("retry loop returns or panics")
}

#[test]
fn provider_process_runs_in_a_neutral_working_directory() {
    // Providers are coding-agent CLIs that auto-load project context
    // (CLAUDE.md, .mcp.json, hooks) from their working directory. If the
    // child inherited the app's cwd, whatever directory QA Scribe happened
    // to be launched from would silently contaminate every generation. The
    // per-run directory is already removed by the time we inspect it, so we
    // reason about the reported path itself (which `pwd` resolved) rather
    // than re-canonicalizing a directory that no longer exists.
    let reported = reported_provider_cwd();

    // `pwd` resolves symlinks, so compare against the canonical temp dir
    // (macOS temp is under a /var -> /private/var symlink).
    let temp = std::env::temp_dir()
        .canonicalize()
        .expect("temp dir resolves");

    let parent = reported.parent().expect("provider cwd has a parent");
    assert_eq!(
        parent, temp,
        "provider cwd {reported:?} should sit directly under the temp dir {temp:?}"
    );
    assert!(
        reported
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("qa-scribe-provider-cwd-")),
        "provider cwd {reported:?} should use the per-run prefix"
    );
}

#[test]
fn each_generation_gets_a_fresh_provider_cwd_that_is_cleaned_up() {
    // A single shared, persistent cwd would re-introduce contamination if any
    // run ever wrote a CLAUDE.md there, and would let concurrent runs collide.
    // Each generation must get its own directory, removed after it completes.
    let first = reported_provider_cwd();
    let second = reported_provider_cwd();

    assert_ne!(
        first, second,
        "each generation must get its own working directory"
    );
    assert!(
        !first.exists(),
        "the per-run cwd {first:?} should be removed after the generation completes"
    );
    assert!(
        !second.exists(),
        "the per-run cwd {second:?} should be removed after the generation completes"
    );
}

#[test]
fn normal_completion_accumulates_events() {
    let cli = FakeCli::new(
        "fake-normal",
        "#!/bin/sh\ncat >/dev/null\n\
         printf '%s\\n' '{\"type\":\"item/agentMessage/delta\",\"delta\":\"Hello \"}'\n\
         printf '%s\\n' '{\"type\":\"item/agentMessage/delta\",\"delta\":\"world\"}'\n\
         exit 0\n",
    );
    let command = cli.command("prompt".to_string(), GenerationOutputFormat::CodexJsonl);
    let control = JobControl::default();

    let output = run_bounded(Duration::from_secs(10), move || {
        run_generation_command_streaming(&command, &control, |_| {})
    })
    .expect("streaming completes");

    assert!(output.success(), "expected success, got {output:?}");
    assert_eq!(output.response_text(), "Hello world");
}

#[test]
fn mid_stream_cancel_kills_child_promptly() {
    // Emit one line, then sleep far longer than the test deadline. A
    // working cancel must kill the process group and unblock the reader
    // well before the sleep elapses.
    let cli = FakeCli::new(
        "fake-cancel",
        "#!/bin/sh\ncat >/dev/null\n\
         printf '%s\\n' '{\"type\":\"item/agentMessage/delta\",\"delta\":\"partial\"}'\n\
         sleep 120\n\
         exit 0\n",
    );
    let command = cli.command("prompt".to_string(), GenerationOutputFormat::CodexJsonl);
    let control = JobControl::default();
    let cancel_control = control.clone();

    // Cancel as soon as the first partial arrives.
    let started = Instant::now();
    let output = run_bounded(Duration::from_secs(15), move || {
        run_generation_command_streaming(&command, &control, move |update| {
            if let StreamUpdate::Partial(_) = update {
                // Simulate the UI requesting cancellation: sets the
                // cancel flag and kills the child's process group.
                let _ = cancel_control.request_cancel();
            }
        })
    })
    .expect("streaming returns after cancel");

    assert!(
        started.elapsed() < Duration::from_secs(10),
        "cancel should kill the child well before its 120s sleep"
    );
    assert!(
        output.cancelled,
        "expected cancelled output, got {output:?}"
    );
}

#[test]
fn already_requested_cancel_kills_child_when_registered() {
    let control = JobControl::default();
    control
        .request_cancel()
        .expect("cancel request should be recorded before spawn registration");
    let mut command = Command::new("sh");
    command
        .arg("-c")
        .arg("sleep 120")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    configure_process_group(&mut command);
    let child = command.spawn().expect("sleeping child should spawn");

    let started = Instant::now();
    control
        .set_child(child)
        .expect("child should register after cancel");
    let mut child = control
        .take_child()
        .expect("registered child should be readable")
        .expect("registered child should exist");
    let _ = child.wait();

    assert!(
        started.elapsed() < Duration::from_secs(10),
        "registration should kill an already-cancelled child promptly"
    );
}

#[test]
fn early_exit_without_reading_stdin_is_reaped_cleanly() {
    // Exit immediately without reading the (large) prompt. The stdin
    // writer will hit BrokenPipe, which must be swallowed; the child must
    // be reaped (no zombie) and a result returned without hanging.
    let cli = FakeCli::new("fake-early-exit", "#!/bin/sh\nexit 3\n");
    let large_prompt = "x".repeat(200_000);
    let command = cli.command(large_prompt, GenerationOutputFormat::CodexJsonl);
    let control = JobControl::default();

    let output = run_bounded(Duration::from_secs(10), move || {
        run_generation_command_streaming(&command, &control, |_| {})
    })
    .expect("streaming returns cleanly");

    // The child exited 3 without hanging and was reaped (no zombie). The
    // exact exit is surfaced as a non-success result.
    assert!(
        !output.success(),
        "early non-zero exit should not be success"
    );
    assert!(!output.cancelled, "early exit is not a cancellation");
}

#[test]
fn stdout_closed_live_child_does_not_deadlock_stdin_writer() {
    // Regression for a child that closes stdout, keeps stdin open, and never
    // drains the prompt. The read loop sees EOF immediately; cleanup must kill
    // the still-live child before joining the stdin writer.
    let cli = FakeCli::new(
        "fake-closed-stdout",
        "#!/bin/sh\nexec 1>&-\nsleep 120\nexit 0\n",
    );
    let large_prompt = "z".repeat(200_000);
    let command = cli.command(large_prompt, GenerationOutputFormat::CodexJsonl);
    let control = JobControl::default();

    let output = run_bounded(Duration::from_secs(10), move || {
        run_generation_command_streaming(&command, &control, |_| {})
    })
    .expect("streaming returns after stdout EOF cleanup");

    assert!(
        !output.success(),
        "closed-stdout child should be terminated rather than treated as success"
    );
}

#[test]
fn large_stderr_before_reading_stdin_does_not_deadlock() {
    // Regression for defect 1: the child writes ~256KB to stderr (well
    // over the ~64KB pipe buffer) *before* reading any stdin, then echoes
    // a JSONL line. With the old ordering (stdin write on the calling
    // thread before the stderr drain) this deadlocks; with the fix it
    // completes.
    let cli = FakeCli::new(
        "fake-stderr-flood",
        "#!/bin/sh\n\
         i=0\n\
         while [ $i -lt 256 ]; do\n\
           printf '%1024d' 0 1>&2\n\
           i=$((i + 1))\n\
         done\n\
         cat >/dev/null\n\
         printf '%s\\n' '{\"type\":\"item/agentMessage/delta\",\"delta\":\"done\"}'\n\
         exit 0\n",
    );
    // Supply a >64KB prompt so the child would also block writing stdin
    // if the reader were not draining concurrently.
    let large_prompt = "y".repeat(200_000);
    let command = cli.command(large_prompt, GenerationOutputFormat::CodexJsonl);
    let control = JobControl::default();

    let output = run_bounded(Duration::from_secs(20), move || {
        run_generation_command_streaming(&command, &control, |_| {})
    })
    .expect("streaming completes without deadlock");

    assert!(output.success(), "expected success, got {output:?}");
    assert_eq!(output.response_text(), "done");
}

#[test]
fn watchdog_kills_silent_child_and_fails_job() {
    // A child that never emits output and never exits must be killed by
    // the watchdog. Use a tiny timeout so the test is fast; the watchdog
    // kill unblocks the (otherwise infinite) reader.
    let cli = FakeCli::new(
        "fake-silent",
        "#!/bin/sh\ncat >/dev/null\nsleep 120\nexit 0\n",
    );
    let command = cli.command("prompt".to_string(), GenerationOutputFormat::CodexJsonl);
    let control = JobControl::default();

    let started = Instant::now();
    let result = run_bounded(Duration::from_secs(15), move || {
        let executor = ProcessProviderExecutor::with_timeout(&control, Duration::from_millis(500));
        run_streaming_generation(&executor, &command, |_| {})
    });

    assert!(
        started.elapsed() < Duration::from_secs(10),
        "watchdog should fire well before the child's own sleep"
    );
    let error = result.expect_err("watchdog should fail the generation");
    assert!(
        error.contains("timed out"),
        "expected timeout error, got: {error}"
    );
}
