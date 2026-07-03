use std::{
    collections::HashSet,
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

/// Cached PATH snapshots, keyed by mode. `None` means "not computed yet";
/// the expensive login-shell probe (`Deep`) only runs lazily on first use
/// after start or after `invalidate_provider_path_cache` clears the cache,
/// e.g. from the UI's "refresh" action so newly-installed CLIs on a PATH
/// entry added after app start become discoverable without a restart.
static PROVIDER_PATH: Mutex<Option<Option<OsString>>> = Mutex::new(None);
static LIGHTWEIGHT_PROVIDER_PATH: Mutex<Option<Option<OsString>>> = Mutex::new(None);
const LOGIN_SHELL_PATH_TIMEOUT: Duration = Duration::from_secs(2);

/// Clears the cached PATH snapshots so the next lookup recomputes them
/// (including a fresh login-shell probe for the Deep snapshot). Called by
/// `refresh_provider_status` so a CLI installed to a new directory after
/// app start becomes discoverable without restarting the app.
pub fn invalidate_provider_path_cache() {
    if let Ok(mut cache) = PROVIDER_PATH.lock() {
        *cache = None;
    }
    if let Ok(mut cache) = LIGHTWEIGHT_PROVIDER_PATH.lock() {
        *cache = None;
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderPathMode {
    Fast,
    Deep,
}

pub fn apply_provider_path(command: &mut Command) {
    if let Some(path) = provider_command_path() {
        command.env("PATH", path);
    }
}

pub fn provider_executable_path(program: &str, mode: ProviderPathMode) -> Option<PathBuf> {
    resolve_provider_executable(program, mode)
}

fn provider_command_path() -> Option<OsString> {
    cached_or_compute(&PROVIDER_PATH, build_provider_command_path)
}

fn lightweight_provider_path() -> Option<OsString> {
    cached_or_compute(&LIGHTWEIGHT_PROVIDER_PATH, build_lightweight_provider_path)
}

/// Returns the cached snapshot, computing and storing it on first use (or
/// after `invalidate_provider_path_cache` cleared it). Falls back to a
/// fresh (uncached) computation if the lock is poisoned, so a panic in one
/// caller can't wedge PATH resolution for the rest of the process.
fn cached_or_compute(
    cache: &Mutex<Option<Option<OsString>>>,
    build: fn() -> Option<OsString>,
) -> Option<OsString> {
    let Ok(mut guard) = cache.lock() else {
        return build();
    };
    if let Some(cached) = guard.as_ref() {
        return cached.clone();
    }
    let computed = build();
    *guard = Some(computed.clone());
    computed
}

fn build_provider_command_path() -> Option<OsString> {
    let mut paths = Vec::new();
    if let Some(path) = read_login_shell_path() {
        paths.push(path);
    }
    paths.extend(lightweight_provider_path());
    merge_paths(paths)
}

fn build_lightweight_provider_path() -> Option<OsString> {
    let mut paths = Vec::new();
    if let Some(path) = env::var_os("PATH").filter(|value| !value.is_empty()) {
        paths.push(path);
    }
    if let Some(path) = fallback_provider_path() {
        paths.push(path);
    }
    merge_paths(paths)
}

fn read_login_shell_path() -> Option<OsString> {
    let shell = resolve_login_shell()?;
    let mut child = Command::new(shell)
        .args(["-ilc", "printf %s \"$PATH\""])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let started_at = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output().ok()?;
                if !status.success() {
                    return None;
                }

                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                return if path.is_empty() {
                    None
                } else {
                    Some(OsString::from(path))
                };
            }
            Ok(None) if started_at.elapsed() < LOGIN_SHELL_PATH_TIMEOUT => {
                thread::sleep(Duration::from_millis(25));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

fn resolve_login_shell() -> Option<PathBuf> {
    if cfg!(windows) {
        return None;
    }
    if let Some(shell) = env::var_os("SHELL").filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(shell));
    }
    if cfg!(target_os = "macos") {
        Some(PathBuf::from("/bin/zsh"))
    } else {
        Some(PathBuf::from("/bin/bash"))
    }
}

fn fallback_provider_path() -> Option<OsString> {
    env::join_paths(fallback_provider_paths()).ok()
}

fn fallback_provider_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    append_env_provider_paths(&mut paths);
    if let Some(home) = env::var_os("HOME").filter(|value| !value.is_empty()) {
        append_home_provider_paths(&mut paths, &PathBuf::from(home));
    }
    paths.extend(
        [
            "/opt/homebrew/bin",
            "/home/linuxbrew/.linuxbrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ]
        .map(PathBuf::from),
    );
    paths
}

fn append_env_provider_paths(paths: &mut Vec<PathBuf>) {
    push_env_path(paths, "PNPM_HOME", None);
    push_env_path(paths, "BUN_INSTALL", Some("bin"));
    push_env_path(paths, "CARGO_HOME", Some("bin"));
    push_env_path(paths, "ASDF_DATA_DIR", Some("shims"));
    push_env_path(paths, "MISE_DATA_DIR", Some("shims"));
    push_env_path(paths, "NVM_BIN", None);
}

fn push_env_path(paths: &mut Vec<PathBuf>, variable: &str, child: Option<&str>) {
    let Some(value) = env::var_os(variable).filter(|value| !value.is_empty()) else {
        return;
    };

    let mut path = PathBuf::from(value);
    if let Some(child) = child {
        path.push(child);
    }
    paths.push(path);
}

fn append_home_provider_paths(paths: &mut Vec<PathBuf>, home: &Path) {
    paths.push(home.join(".local/bin"));
    paths.push(home.join(".bun/bin"));
    paths.push(home.join(".cargo/bin"));
    paths.push(home.join(".npm-global/bin"));
    paths.push(home.join(".local/share/pnpm"));
    paths.push(home.join(".local/share/pnpm/bin"));
    paths.push(home.join(".asdf/shims"));
    paths.push(home.join(".local/share/mise/shims"));
    paths.push(home.join(".volta/bin"));
    append_nvm_node_bins(paths, home);
}

fn append_nvm_node_bins(paths: &mut Vec<PathBuf>, home: &Path) {
    let versions_dir = home.join(".nvm/versions/node");
    let Ok(entries) = fs::read_dir(versions_dir) else {
        return;
    };

    let mut node_bins: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .map(|path| path.join("bin"))
        .collect();
    node_bins.sort();
    node_bins.reverse();
    paths.extend(node_bins);
}

fn provider_path_for_mode(mode: ProviderPathMode) -> Option<OsString> {
    match mode {
        ProviderPathMode::Fast => lightweight_provider_path(),
        ProviderPathMode::Deep => provider_command_path(),
    }
}

fn merge_paths(paths: Vec<OsString>) -> Option<OsString> {
    let mut seen = HashSet::new();
    let mut parts = Vec::new();
    for part in paths.iter().flat_map(env::split_paths) {
        if part.as_os_str().is_empty() {
            continue;
        }
        if seen.insert(part.clone()) {
            parts.push(part);
        }
    }

    if parts.is_empty() {
        None
    } else {
        env::join_paths(parts).ok()
    }
}

fn resolve_provider_executable(program: &str, mode: ProviderPathMode) -> Option<PathBuf> {
    let program_path = Path::new(program);
    if program_path.is_absolute() || program_path.components().count() > 1 {
        return executable_file(program_path).map(Path::to_path_buf);
    }

    let path = provider_path_for_mode(mode)?;
    resolve_provider_executable_in_path(program, &path)
}

fn resolve_provider_executable_in_path(program: &str, path: &OsString) -> Option<PathBuf> {
    for directory in env::split_paths(&path) {
        let candidate = directory.join(program);
        if let Some(executable) = executable_file(&candidate) {
            return Some(executable.to_path_buf());
        }

        #[cfg(windows)]
        {
            if candidate.extension().is_none() {
                for extension in executable_extensions() {
                    let candidate = directory.join(format!("{program}{extension}"));
                    if let Some(executable) = executable_file(&candidate) {
                        return Some(executable.to_path_buf());
                    }
                }
            }
        }
    }

    None
}

fn executable_file(path: &Path) -> Option<&Path> {
    let metadata = path.metadata().ok()?;
    if !metadata.is_file() {
        return None;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return None;
        }
    }

    Some(path)
}

#[cfg(windows)]
fn executable_extensions() -> Vec<String> {
    env::var_os("PATHEXT")
        .map(|value| {
            value
                .to_string_lossy()
                .split(';')
                .filter(|extension| !extension.trim().is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_else(|| vec![".exe".to_string(), ".cmd".to_string(), ".bat".to_string()])
}

#[cfg(test)]
mod tests {
    use std::{
        ffi::OsString,
        fs,
        path::PathBuf,
        sync::{
            Mutex,
            atomic::{AtomicUsize, Ordering},
        },
    };

    #[cfg(unix)]
    use std::{os::unix::fs::PermissionsExt, path::Path};

    use super::{
        append_home_provider_paths, cached_or_compute, merge_paths,
        resolve_provider_executable_in_path,
    };

    static BUILD_CALLS: AtomicUsize = AtomicUsize::new(0);

    fn counting_build() -> Option<OsString> {
        let call = BUILD_CALLS.fetch_add(1, Ordering::SeqCst) + 1;
        Some(OsString::from(format!("/snapshot-{call}")))
    }

    #[test]
    fn cached_or_compute_reuses_cached_snapshot_until_invalidated() {
        BUILD_CALLS.store(0, Ordering::SeqCst);
        let cache: Mutex<Option<Option<OsString>>> = Mutex::new(None);

        let first = cached_or_compute(&cache, counting_build);
        let second = cached_or_compute(&cache, counting_build);
        assert_eq!(first, second);
        assert_eq!(BUILD_CALLS.load(Ordering::SeqCst), 1);

        // Simulate refresh_provider_status invalidating the snapshot: the
        // next lookup must recompute rather than keep serving stale PATH.
        *cache.lock().expect("cache lock is not poisoned") = None;

        let third = cached_or_compute(&cache, counting_build);
        assert_ne!(first, third);
        assert_eq!(BUILD_CALLS.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn merge_paths_deduplicates_and_drops_empty_segments() {
        let path = merge_paths(vec!["/a:/b::".into(), "/b:/c".into(), String::new().into()]);

        assert_eq!(path.as_deref(), Some(std::ffi::OsStr::new("/a:/b:/c")));
    }

    #[test]
    fn home_provider_paths_cover_common_cli_installers() {
        let home = PathBuf::from("/home/tester");
        let mut paths = Vec::new();

        append_home_provider_paths(&mut paths, &home);

        assert!(paths.contains(&PathBuf::from("/home/tester/.local/bin")));
        assert!(paths.contains(&PathBuf::from("/home/tester/.local/share/pnpm")));
        assert!(paths.contains(&PathBuf::from("/home/tester/.asdf/shims")));
        assert!(paths.contains(&PathBuf::from("/home/tester/.local/share/mise/shims")));
        assert!(paths.contains(&PathBuf::from("/home/tester/.cargo/bin")));
        assert!(paths.contains(&PathBuf::from("/home/tester/.volta/bin")));
    }

    #[test]
    fn executable_resolution_uses_supplied_provider_path() {
        let test_dir = std::env::temp_dir().join(format!(
            "qa-scribe-provider-command-test-{}",
            std::process::id()
        ));
        let bin_dir = test_dir.join("custom-bin");
        fs::create_dir_all(&bin_dir).expect("test bin directory is created");
        let executable = bin_dir.join("codex");
        fs::write(&executable, "#!/bin/sh\n").expect("test executable is written");
        make_executable(&executable);
        let path = std::env::join_paths([bin_dir]).expect("test path joins");

        let resolved = resolve_provider_executable_in_path("codex", &path);

        assert_eq!(resolved.as_deref(), Some(executable.as_path()));
        let _ = fs::remove_dir_all(test_dir);
    }

    #[cfg(unix)]
    fn make_executable(path: &Path) {
        let mut permissions = fs::metadata(path)
            .expect("test executable metadata exists")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).expect("test executable permissions are set");
    }

    #[cfg(not(unix))]
    fn make_executable(_path: &std::path::Path) {}
}
