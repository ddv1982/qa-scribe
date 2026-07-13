//! Streaming provider execution driver — the Tauri-side
//! [`ProviderExecutor`] implementation.
//!
//! This is the process I/O core of a streaming generation: it spawns the
//! provider CLI, feeds it the prompt on stdin, and streams raw stdout lines
//! to the caller's sink (core layers the per-format stream parsing on top via
//! [`run_streaming_generation`]). The ordering of the steps here is
//! load-bearing and fixes several confirmed process defects; see
//! [`ProcessProviderExecutor::execute`].

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
    GenerationCommand, ProviderExecution, ProviderExecutor, ProviderGenerationOutput,
    run_streaming_generation, stream::StreamUpdate,
};

use crate::{
    jobs::JobControl,
    process_io::{configure_process_group, kill_child_group},
    provider_command::{NeutralProviderCwd, apply_provider_path},
};

/// Overall watchdog bound for a single streaming generation. A CLI that emits
/// no terminal state within this window is killed and the job fails with an
/// actionable message. This is a safety net for stuck processes; normal
/// user-driven cancellation is not bounded by this value.
const GENERATION_WATCHDOG_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// How often the watchdog thread wakes to check the elapsed time and whether
/// the read loop has finished.
const WATCHDOG_POLL_INTERVAL: Duration = Duration::from_millis(250);

/// Run one streaming generation through the real process executor, parsing
/// the provider's stdout with core's per-format stream parsers.
pub(super) fn run_generation_command_streaming(
    command: &GenerationCommand,
    control: &JobControl,
    on_update: impl FnMut(StreamUpdate),
) -> Result<ProviderGenerationOutput, String> {
    run_streaming_generation(&ProcessProviderExecutor::new(control), command, on_update)
}

/// [`ProviderExecutor`] backed by a real child process with watchdog and
/// process-group kill, wired to a job's [`JobControl`] for cancellation.
pub(super) struct ProcessProviderExecutor<'a> {
    control: &'a JobControl,
    watchdog_timeout: Duration,
}

impl<'a> ProcessProviderExecutor<'a> {
    pub(super) fn new(control: &'a JobControl) -> Self {
        Self {
            control,
            watchdog_timeout: GENERATION_WATCHDOG_TIMEOUT,
        }
    }

    #[cfg(test)]
    fn with_timeout(control: &'a JobControl, watchdog_timeout: Duration) -> Self {
        Self {
            control,
            watchdog_timeout,
        }
    }
}

impl ProviderExecutor for ProcessProviderExecutor<'_> {
    /// Streaming driver for a provider CLI.
    ///
    /// The ordering here is load-bearing and fixes several process defects:
    ///
    /// * The child is registered with [`JobControl`] immediately after spawn,
    ///   so a cancel arriving during the (potentially large) stdin write or a
    ///   long silent "thinking" phase kills it promptly (defect 3).
    /// * stdin is written from its own thread and the stderr drain is spawned
    ///   before that write, so a child that floods stderr/stdout before
    ///   consuming its (>64KB) prompt cannot deadlock against a blocked stdin
    ///   write (defect 1).
    /// * Every exit path funnels through [`ChildGuard`], which kills the
    ///   process group and reaps the child, so no error path leaks a zombie
    ///   (defect 2).
    /// * A watchdog thread bounds the whole generation: a fully silent child
    ///   is killed after the watchdog timeout, which unblocks the reader
    ///   (defect 4).
    fn execute(
        &self,
        command: &GenerationCommand,
        on_line: &mut dyn FnMut(&[u8]),
    ) -> Result<ProviderExecution, String> {
        let control = self.control;
        if control.is_cancelled() {
            return Ok(ProviderExecution::cancelled());
        }

        // Owned for the whole call; its directory is removed when this drops
        // at function exit (every return path, including `?` and panics).
        let provider_cwd = NeutralProviderCwd::new();

        let mut process = Command::new(&command.program);
        process
            .args(&command.args)
            .current_dir(provider_cwd.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        apply_provider_path(&mut process);
        configure_process_group(&mut process);

        let mut child = process.spawn().map_err(|error| error.to_string())?;

        // Take the pipes up front. If any is missing, kill+reap before
        // returning so we never leak a zombie (defect 2).
        let stdin = child.stdin.take();
        let (stdout, stderr) = match (child.stdout.take(), child.stderr.take()) {
            (Some(stdout), Some(stderr)) => (stdout, stderr),
            _ => {
                kill_child_group(&mut child);
                let _ = child.wait();
                return Err("provider stdio pipes were not available".to_string());
            }
        };

        // Register the child before writing stdin so a cancel during the
        // write or a long silent phase can kill it (defect 3). From here on
        // the child lives in `control`; the guard funnels every exit through
        // cleanup (defect 2).
        control.set_child(child)?;
        let guard = ChildGuard::new(control);

        // Drain stderr on its own thread *before* writing stdin, so a child
        // that emits >64KB of stderr before reading its prompt cannot
        // deadlock the stdin write (defect 1).
        let stderr_reader = thread::spawn(move || {
            let mut buffer = Vec::new();
            let mut reader = BufReader::new(stderr);
            let _ = reader.read_to_end(&mut buffer);
            buffer
        });

        // Write stdin from a dedicated thread and drop the handle so the
        // child sees EOF. A BrokenPipe from an early-exiting CLI is expected
        // and non-fatal here (the exit status/stderr carry the real error).
        let stdin_payload = command.stdin.clone().into_bytes();
        let stdin_writer = thread::spawn(move || {
            if let Some(mut stdin) = stdin {
                let _ = stdin.write_all(&stdin_payload);
                // `stdin` drops here, closing the pipe (EOF for the child).
            }
        });

        // Watchdog: a fully silent child blocks the reader forever, so a
        // monitor thread kills the group after the timeout, which unblocks
        // `read_until` (defect 4).
        let reader_finished = Arc::new(AtomicBool::new(false));
        let watchdog_fired = Arc::new(AtomicBool::new(false));
        let watchdog = spawn_watchdog(
            control,
            self.watchdog_timeout,
            Arc::clone(&reader_finished),
            Arc::clone(&watchdog_fired),
        );

        let mut stdout_reader = BufReader::new(stdout);
        let mut chunk = Vec::new();

        let read_result = loop {
            chunk.clear();
            let read = match stdout_reader.read_until(b'\n', &mut chunk) {
                Ok(read) => read,
                Err(error) => {
                    // The child may still be alive here (e.g. an EIO/EBADF on
                    // the pipe without the process having exited). `finish()`
                    // below only reaps via `wait()` and does not kill, so
                    // without this the reap would block until the child exits
                    // on its own. Kill in place (no take/wait) so
                    // `guard.finish()` remains the sole reaper and the
                    // watchdog join ordering is unchanged.
                    let _ = control.kill_registered_child();
                    break Err(error.to_string());
                }
            };
            if read == 0 {
                break Ok(());
            }
            on_line(&chunk);
            if control.is_cancelled() {
                let _ = control.kill_registered_child();
            }
        };

        // Reader loop is done. If stdout closed while the process stayed alive
        // and stopped reading stdin, the writer thread can still be blocked on
        // a full pipe. Kill first so joining the writer cannot deadlock; the
        // guard remains the sole reaper.
        if read_result.is_ok() {
            let _ = control.kill_registered_child();
        }
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
                format_watchdog_duration(self.watchdog_timeout)
            ));
        }

        Ok(ProviderExecution {
            exit_success: status.map(|status| status.success()),
            stderr,
            cancelled: control.is_cancelled(),
        })
    }
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
/// panics) it kills the process group and reaps the child so nothing is left
/// as a zombie (defect 2). The happy path calls [`ChildGuard::finish`] to
/// reap and recover the exit status.
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

    /// Reap the child normally, returning its exit status. Disarms the guard
    /// so `Drop` does nothing.
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
mod tests;
