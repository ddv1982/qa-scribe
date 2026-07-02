//! Low-level process I/O helpers shared by the job store and the streaming
//! provider execution path.
//!
//! Provider CLIs (claude/codex/copilot) spawn their own grandchildren (node,
//! MCP servers). To avoid orphaning those on cancel or app exit we spawn each
//! child in its own process group (unix) and kill the whole group.

use std::process::{Child, Command};

/// Place the child in its own process group so that killing it also kills the
/// grandchildren it spawns (node, MCP servers, ...).
///
/// Windows note: process-group isolation would require Job Objects, which we
/// deliberately do not add in this task. On Windows we fall back to killing the
/// direct child only; grandchildren may be orphaned. This is a documented
/// limitation.
pub fn configure_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // A group id of 0 tells the OS to put the child in a new process group
        // whose group id equals the child's pid.
        command.process_group(0);
    }
    #[cfg(not(unix))]
    {
        let _ = command;
    }
}

/// Kill a child process. On unix the whole process group is signalled (the
/// child was spawned via [`configure_process_group`], so its pgid equals its
/// pid), which also terminates grandchildren. On other platforms only the
/// direct child is killed.
///
/// This does not reap the child; the owner must still `wait()` on it.
pub fn kill_child_group(child: &mut Child) {
    #[cfg(unix)]
    {
        // SAFETY: `killpg` with a valid pgid is safe; a stale pgid simply
        // returns ESRCH which we ignore. We fall back to the direct kill if the
        // group signal fails for any reason.
        let pid = child.id() as libc::pid_t;
        let killed_group = unsafe { libc::killpg(pid, libc::SIGKILL) == 0 };
        if !killed_group {
            let _ = child.kill();
        }
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
    }
}
