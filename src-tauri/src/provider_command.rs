use std::{
    collections::HashSet,
    env,
    ffi::OsString,
    path::{Path, PathBuf},
    process::Command,
    sync::OnceLock,
};

static PROVIDER_PATH: OnceLock<Option<OsString>> = OnceLock::new();
static LIGHTWEIGHT_PROVIDER_PATH: OnceLock<Option<OsString>> = OnceLock::new();

pub fn apply_provider_path(command: &mut Command) {
    if let Some(path) = provider_command_path() {
        command.env("PATH", path);
    }
}

pub fn provider_executable_exists(program: &str) -> bool {
    resolve_provider_executable(program).is_some()
}

fn provider_command_path() -> Option<OsString> {
    PROVIDER_PATH
        .get_or_init(build_provider_command_path)
        .clone()
}

fn lightweight_provider_path() -> Option<OsString> {
    LIGHTWEIGHT_PROVIDER_PATH
        .get_or_init(build_lightweight_provider_path)
        .clone()
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
    let output = Command::new(shell)
        .args(["-ilc", "printf %s \"$PATH\""])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(OsString::from(path))
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
    let mut paths = Vec::new();
    if let Some(home) = env::var_os("HOME").filter(|value| !value.is_empty()) {
        let home = PathBuf::from(home);
        paths.push(home.join(".local/bin"));
        paths.push(home.join(".bun/bin"));
    }
    paths.extend(
        [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ]
        .map(PathBuf::from),
    );
    env::join_paths(paths).ok()
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

fn resolve_provider_executable(program: &str) -> Option<PathBuf> {
    let program_path = Path::new(program);
    if program_path.is_absolute() || program_path.components().count() > 1 {
        return executable_file(program_path).map(Path::to_path_buf);
    }

    let path = lightweight_provider_path()?;
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
    use super::merge_paths;

    #[test]
    fn merge_paths_deduplicates_and_drops_empty_segments() {
        let path = merge_paths(vec!["/a:/b::".into(), "/b:/c".into(), String::new().into()]);

        assert_eq!(path.as_deref(), Some(std::ffi::OsStr::new("/a:/b:/c")));
    }
}
