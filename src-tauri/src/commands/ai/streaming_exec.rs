//! Streaming provider execution driver.
//!
//! This is the process I/O core of a streaming generation: it spawns the
//! provider CLI, feeds it the prompt on stdin, and streams its stdout through
//! the [`ProviderStreamParser`]. The ordering of the steps here is load-bearing
//! and fixes several confirmed process defects; see
//! [`run_generation_command_streaming_with_timeout`].

use std::{
    io::{BufRead, BufReader, Read, Write},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use qa_scribe_core::ai::{
    GenerationCommand,
    stream::{ProviderStreamParser, StreamUpdate},
};

use super::provider_execution::ProviderGenerationOutput;
use crate::{
    jobs::JobControl,
    process_io::{configure_process_group, kill_child_group},
    provider_command::apply_provider_path,
};

/// Overall watchdog bound for a single streaming generation. A CLI that emits
/// no terminal state within this window is killed and the job fails with an
/// actionable message. This is a safety net for stuck processes; normal
/// user-driven cancellation is not bounded by this value.
const GENERATION_WATCHDOG_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// How often the watchdog thread wakes to check the elapsed time and whether
/// the read loop has finished.
const WATCHDOG_POLL_INTERVAL: Duration = Duration::from_millis(250);

pub(super) fn run_generation_command_streaming(
    command: &GenerationCommand,
    control: &JobControl,
    on_update: impl FnMut(StreamUpdate),
) -> Result<ProviderGenerationOutput, String> {
    run_generation_command_streaming_with_timeout(
        command,
        control,
        GENERATION_WATCHDOG_TIMEOUT,
        on_update,
    )
}

/// Streaming driver for a provider CLI.
///
/// The ordering here is load-bearing and fixes several process defects:
///
/// * The child is registered with [`JobControl`] immediately after spawn, so a
///   cancel arriving during the (potentially large) stdin write or a long
///   silent "thinking" phase kills it promptly (defect 3).
/// * stdin is written from its own thread and the stderr drain is spawned
///   before that write, so a child that floods stderr/stdout before consuming
///   its (>64KB) prompt cannot deadlock against a blocked stdin write (defect
///   1).
/// * Every exit path funnels through [`ChildGuard`], which kills the process
///   group and reaps the child, so no error path leaks a zombie (defect 2).
/// * A watchdog thread bounds the whole generation: a fully silent child is
///   killed after `watchdog_timeout`, which unblocks the reader (defect 4).
fn run_generation_command_streaming_with_timeout(
    command: &GenerationCommand,
    control: &JobControl,
    watchdog_timeout: Duration,
    mut on_update: impl FnMut(StreamUpdate),
) -> Result<ProviderGenerationOutput, String> {
    if control.is_cancelled() {
        return Ok(ProviderGenerationOutput::cancelled());
    }

    let mut process = Command::new(&command.program);
    process
        .args(&command.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_provider_path(&mut process);
    configure_process_group(&mut process);

    let mut child = process.spawn().map_err(|error| error.to_string())?;

    // Take the pipes up front. If any is missing, kill+reap before returning so
    // we never leak a zombie (defect 2).
    let stdin = child.stdin.take();
    let (stdout, stderr) = match (child.stdout.take(), child.stderr.take()) {
        (Some(stdout), Some(stderr)) => (stdout, stderr),
        _ => {
            kill_child_group(&mut child);
            let _ = child.wait();
            return Err("provider stdio pipes were not available".to_string());
        }
    };

    // Register the child before writing stdin so a cancel during the write or a
    // long silent phase can kill it (defect 3). From here on the child lives in
    // `control`; the guard funnels every exit through cleanup (defect 2).
    control.set_child(child)?;
    let guard = ChildGuard::new(control);

    // Drain stderr on its own thread *before* writing stdin, so a child that
    // emits >64KB of stderr before reading its prompt cannot deadlock the
    // stdin write (defect 1).
    let stderr_reader = thread::spawn(move || {
        let mut buffer = Vec::new();
        let mut reader = BufReader::new(stderr);
        let _ = reader.read_to_end(&mut buffer);
        buffer
    });

    // Write stdin from a dedicated thread and drop the handle so the child sees
    // EOF. A BrokenPipe from an early-exiting CLI is expected and non-fatal here
    // (the exit status/stderr carry the real error).
    let stdin_payload = command.stdin.clone().into_bytes();
    let stdin_writer = thread::spawn(move || {
        if let Some(mut stdin) = stdin {
            let _ = stdin.write_all(&stdin_payload);
            // `stdin` drops here, closing the pipe (EOF for the child).
        }
    });

    // Watchdog: a fully silent child blocks the reader forever, so a monitor
    // thread kills the group after the timeout, which unblocks `read_until`
    // (defect 4).
    let reader_finished = Arc::new(AtomicBool::new(false));
    let watchdog_fired = Arc::new(AtomicBool::new(false));
    let watchdog = spawn_watchdog(
        control,
        watchdog_timeout,
        Arc::clone(&reader_finished),
        Arc::clone(&watchdog_fired),
    );

    let mut stdout_reader = BufReader::new(stdout);
    let mut stdout_bytes = Vec::new();
    let mut parser = ProviderStreamParser::new(command.output_format);
    let mut chunk = Vec::new();

    let read_result = loop {
        chunk.clear();
        let read = match stdout_reader.read_until(b'\n', &mut chunk) {
            Ok(read) => read,
            Err(error) => {
                // The child may still be alive here (e.g. an EIO/EBADF on the
                // pipe without the process having exited). `finish()` below
                // only reaps via `wait()` and does not kill, so without this
                // the reap would block until the child exits on its own.
                // Kill in place (no take/wait) so `guard.finish()` remains the
                // sole reaper and the watchdog join ordering is unchanged.
                let _ = control.kill_registered_child();
                break Err(error.to_string());
            }
        };
        if read == 0 {
            break Ok(());
        }
        stdout_bytes.extend_from_slice(&chunk);
        for update in parser.push_bytes(&chunk) {
            on_update(update);
        }
        if control.is_cancelled() {
            let _ = control.kill_registered_child();
        }
    };

    // Reader loop is done; stop the watchdog and reap the child via the guard.
    reader_finished.store(true, Ordering::SeqCst);
    let _ = watchdog.join();
    let _ = stdin_writer.join();
    let status = guard.finish()?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| "provider stderr reader panicked".to_string())?;

    read_result?;

    if watchdog_fired.load(Ordering::SeqCst) && !control.is_cancelled() {
        return Err(format!(
            "Generation timed out after {} with no response from the provider. \
             The provider process was stopped. Try again or check the provider CLI.",
            format_watchdog_duration(watchdog_timeout)
        ));
    }

    Ok(ProviderGenerationOutput {
        status,
        stdout: stdout_bytes,
        stderr,
        assistant_text: parser.finish(),
        cancelled: control.is_cancelled(),
    })
}

/// Render a watchdog bound for the timeout error message. Whole minutes when
/// the bound is at least a minute, seconds otherwise, so a sub-minute bound
/// (as used in tests, and plausible for a tightened production value) never
/// renders as "timed out after 0 minutes".
fn format_watchdog_duration(duration: Duration) -> String {
    let secs = duration.as_secs();
    if secs >= 60 {
        format!("{} minutes", secs / 60)
    } else {
        format!("{secs} seconds")
    }
}

fn spawn_watchdog(
    control: &JobControl,
    timeout: Duration,
    reader_finished: Arc<AtomicBool>,
    watchdog_fired: Arc<AtomicBool>,
) -> thread::JoinHandle<()> {
    let control = control.clone();
    thread::spawn(move || {
        let started = Instant::now();
        while !reader_finished.load(Ordering::SeqCst) {
            if started.elapsed() >= timeout {
                watchdog_fired.store(true, Ordering::SeqCst);
                let _ = control.kill_registered_child();
                return;
            }
            thread::sleep(WATCHDOG_POLL_INTERVAL);
        }
    })
}

/// RAII cleanup for the registered child: on any exit (including `?` and
/// panics) it kills the process group and reaps the child so nothing is left as
/// a zombie (defect 2). The happy path calls [`ChildGuard::finish`] to reap and
/// recover the exit status.
struct ChildGuard<'a> {
    control: &'a JobControl,
    active: bool,
}

impl<'a> ChildGuard<'a> {
    fn new(control: &'a JobControl) -> Self {
        Self {
            control,
            active: true,
        }
    }

    /// Reap the child normally, returning its exit status. Disarms the guard so
    /// `Drop` does nothing.
    fn finish(mut self) -> Result<Option<ExitStatus>, String> {
        self.active = false;
        reap_child(self.control.take_child()?)
    }
}

impl Drop for ChildGuard<'_> {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        if let Ok(Some(mut child)) = self.control.take_child() {
            kill_child_group(&mut child);
            let _ = child.wait();
        }
    }
}

fn reap_child(child: Option<Child>) -> Result<Option<ExitStatus>, String> {
    match child {
        Some(mut child) => Ok(Some(child.wait().map_err(|error| error.to_string())?)),
        None => Ok(None),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::{
        fs,
        os::unix::fs::PermissionsExt,
        path::PathBuf,
        sync::mpsc,
        thread,
        time::{Duration, Instant},
    };

    use qa_scribe_core::ai::{GenerationCommand, GenerationOutputFormat};

    use super::{
        StreamUpdate, run_generation_command_streaming,
        run_generation_command_streaming_with_timeout,
    };
    use crate::jobs::JobControl;

    /// A tiny fake provider CLI written to a temp dir. Each test gets its own
    /// directory so parallel test runs do not collide.
    struct FakeCli {
        dir: PathBuf,
        path: PathBuf,
    }

    impl FakeCli {
        fn new(name: &str, script: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "qa-scribe-fake-cli-{}-{}-{:?}",
                name,
                std::process::id(),
                thread::current().id()
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

        fn command(
            &self,
            stdin: String,
            output_format: GenerationOutputFormat,
        ) -> GenerationCommand {
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
    fn run_bounded<T: Send + 'static>(
        deadline: Duration,
        f: impl FnOnce() -> T + Send + 'static,
    ) -> T {
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
        // Emit one line, then sleep far longer than the test deadline. A working
        // cancel must kill the process group and unblock the reader well before
        // the sleep elapses.
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
                    // Simulate the UI requesting cancellation: sets the cancel
                    // flag and kills the child's process group.
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
    fn early_exit_without_reading_stdin_is_reaped_cleanly() {
        // Exit immediately without reading the (large) prompt. The stdin writer
        // will hit BrokenPipe, which must be swallowed; the child must be reaped
        // (no zombie) and a result returned without hanging.
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
    fn large_stderr_before_reading_stdin_does_not_deadlock() {
        // Regression for defect 1: the child writes ~256KB to stderr (well over
        // the ~64KB pipe buffer) *before* reading any stdin, then echoes a JSONL
        // line. With the old ordering (stdin write on the calling thread before
        // the stderr drain) this deadlocks; with the fix it completes.
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
        // Supply a >64KB prompt so the child would also block writing stdin if
        // the reader were not draining concurrently.
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
        // A child that never emits output and never exits must be killed by the
        // watchdog. Use a tiny timeout so the test is fast; the watchdog kill
        // unblocks the (otherwise infinite) reader.
        let cli = FakeCli::new(
            "fake-silent",
            "#!/bin/sh\ncat >/dev/null\nsleep 120\nexit 0\n",
        );
        let command = cli.command("prompt".to_string(), GenerationOutputFormat::CodexJsonl);
        let control = JobControl::default();

        let started = Instant::now();
        let result = run_bounded(Duration::from_secs(15), move || {
            run_generation_command_streaming_with_timeout(
                &command,
                &control,
                Duration::from_millis(500),
                |_| {},
            )
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
}
