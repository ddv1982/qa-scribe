//! Shared test doubles for the provider-detection test modules.

use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Mutex, MutexGuard, OnceLock},
};

use super::super::probe::{CommandProbe, ProbeRunner};

/// `READINESS_CACHE` (in `cache.rs`) is a process-global static keyed by
/// `(AiProvider, DetectionMode)`. Tests that seed/read/clear it for
/// `AiProvider::CodexCli` run as separate threads in the same test binary,
/// so without serialization they race on the same cache entries: one test's
/// Fast-miss (`InstallRequired`) write can be observed by another test's
/// `provider_readiness_with_runners` call, which short-circuits on any cached
/// Fast entry instead of consulting the test's own mock runner.
///
/// Any test that seeds, reads, or clears `READINESS_CACHE` must hold this
/// lock for its full body. Recover from poisoning (a prior test panicking
/// while holding the lock) rather than propagating it, so one failing test
/// doesn't cascade into unrelated failures.
static READINESS_CACHE_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub(super) fn readiness_cache_guard() -> MutexGuard<'static, ()> {
    READINESS_CACHE_TEST_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Default)]
pub(super) struct MockRunner {
    executables: HashSet<String>,
    probes: HashMap<String, CommandProbe>,
    calls: RefCell<Vec<String>>,
}

impl MockRunner {
    pub(super) fn with_executable(mut self, program: &str) -> Self {
        self.executables.insert(program.to_string());
        self
    }

    pub(super) fn with(mut self, program: &str, args: &[&str], probe: CommandProbe) -> Self {
        if probe.success {
            self.executables.insert(program.to_string());
        }
        self.probes.insert(command_key(program, args), probe);
        self
    }

    pub(super) fn calls(&self) -> Vec<String> {
        self.calls.borrow().clone()
    }
}

impl ProbeRunner for MockRunner {
    fn executable_path(&self, program: &str) -> Option<PathBuf> {
        self.executables
            .contains(program)
            .then(|| PathBuf::from(format!("/mock/bin/{program}")))
    }

    fn run(&self, program: &str, args: &[&str]) -> CommandProbe {
        self.calls.borrow_mut().push(command_key(program, args));
        self.probes
            .get(&command_key(program, args))
            .cloned()
            .unwrap_or_else(CommandProbe::not_found)
    }
}

impl CommandProbe {
    pub(super) fn success() -> Self {
        Self {
            success: true,
            stdout: String::new(),
            stderr: String::new(),
            not_found: false,
        }
    }

    pub(super) fn success_with_stdout(stdout: &str) -> Self {
        Self {
            success: true,
            stdout: stdout.to_string(),
            stderr: String::new(),
            not_found: false,
        }
    }

    pub(super) fn failed(stderr: &str) -> Self {
        Self {
            success: false,
            stdout: String::new(),
            stderr: stderr.to_string(),
            not_found: false,
        }
    }
}

pub(super) fn copilot_prompt_help() -> CommandProbe {
    CommandProbe::success_with_stdout(
        "Usage: copilot [options]\n  -p, --prompt <prompt> Execute a prompt in non-interactive mode\n  --model <model> Use 'claude-sonnet-4.6', 'gpt-5.5', 'gpt-5.3-codex', 'claude-opus-4.6-fast', or 'gemini-3.5-flash'",
    )
}

pub(super) fn command_key(program: &str, args: &[&str]) -> String {
    if args.is_empty() {
        program.to_string()
    } else {
        format!("{} {}", program, args.join(" "))
    }
}
