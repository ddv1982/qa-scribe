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

use crate::process_io::{configure_process_group, kill_child_group};

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

/// Fresh, empty working directory used for every provider inspection and
/// generation. Coding-agent CLIs discover project configuration from their
/// working directory, so both paths must use the same neutral-scope policy.
pub struct NeutralProviderCwd {
    path: PathBuf,
}

impl NeutralProviderCwd {
    pub fn new() -> std::io::Result<Self> {
        Self::new_in(&env::temp_dir())
    }

    pub(crate) fn new_in(parent: &Path) -> std::io::Result<Self> {
        let unique = parent.join(format!(
            "qa-scribe-provider-cwd-{}",
            uuid::Uuid::new_v4().simple()
        ));
        create_private_provider_directory(&unique).map_err(|error| {
            std::io::Error::new(
                error.kind(),
                format!(
                    "Could not create a private working directory for the provider. The provider was not started: {error}"
                ),
            )
        })?;
        Ok(Self { path: unique })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

fn create_private_provider_directory(path: &Path) -> std::io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)
}

impl Drop for NeutralProviderCwd {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
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
    // A feature-gated override makes the built-app E2E provider deterministic
    // even on developer machines that have a real authenticated CLI installed.
    // The variable has no effect in production builds.
    #[cfg(feature = "e2e")]
    if let Some(path) = env::var_os("QA_SCRIBE_E2E_PROVIDER_PATH").filter(|value| !value.is_empty())
    {
        paths.push(path);
    }
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
    let mut command = Command::new(shell);
    command
        .args(["-ilc", "printf %s \"$PATH\""])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    configure_process_group(&mut command);
    let mut child = command.spawn().ok()?;
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
                kill_child_group(&mut child);
                let _ = child.wait();
                return None;
            }
            Err(_) => {
                kill_child_group(&mut child);
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
    node_bins.sort_by(
        |left, right| match (nvm_version(left), nvm_version(right)) {
            (Some(left), Some(right)) => left.cmp(&right),
            (Some(_), None) => std::cmp::Ordering::Greater,
            (None, Some(_)) => std::cmp::Ordering::Less,
            (None, None) => left.cmp(right),
        },
    );
    node_bins.reverse();
    paths.extend(node_bins);
}

fn nvm_version(bin_path: &Path) -> Option<Vec<u64>> {
    let version = bin_path.parent()?.file_name()?.to_str()?;
    let version = version.strip_prefix('v').unwrap_or(version);
    if version.is_empty() {
        return None;
    }
    version
        .split('.')
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()
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
mod tests;
