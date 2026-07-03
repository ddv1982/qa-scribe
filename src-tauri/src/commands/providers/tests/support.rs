//! Shared test doubles for the provider-detection test modules.

use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    path::PathBuf,
};

use super::super::probe::{CommandProbe, ProbeRunner};

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
        "Usage: copilot [options]\n  -p, --prompt <prompt> Execute a prompt in non-interactive mode",
    )
}

pub(super) fn command_key(program: &str, args: &[&str]) -> String {
    if args.is_empty() {
        program.to_string()
    } else {
        format!("{} {}", program, args.join(" "))
    }
}
