use std::{collections::HashSet, env, path::PathBuf, process::Command, sync::OnceLock};

static PROVIDER_PATH: OnceLock<Option<String>> = OnceLock::new();

pub fn apply_provider_path(command: &mut Command) {
    if let Some(path) = provider_command_path() {
        command.env("PATH", path);
    }
}

fn provider_command_path() -> Option<String> {
    PROVIDER_PATH
        .get_or_init(build_provider_command_path)
        .clone()
}

fn build_provider_command_path() -> Option<String> {
    let mut paths = Vec::new();
    if let Some(path) = read_login_shell_path() {
        paths.push(path);
    }
    if let Ok(path) = env::var("PATH") {
        paths.push(path);
    }
    paths.push(fallback_provider_path());
    merge_paths(paths)
}

fn read_login_shell_path() -> Option<String> {
    let shell = resolve_login_shell()?;
    let output = Command::new(shell)
        .args(["-ilc", "printf %s \"$PATH\""])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() { None } else { Some(path) }
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

fn fallback_provider_path() -> String {
    let mut paths = Vec::new();
    if let Some(home) = env::var_os("HOME").filter(|value| !value.is_empty()) {
        let home = PathBuf::from(home);
        paths.push(home.join(".local/bin").display().to_string());
        paths.push(home.join(".bun/bin").display().to_string());
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
        .map(str::to_string),
    );
    paths.join(":")
}

fn merge_paths(paths: Vec<String>) -> Option<String> {
    let mut seen = HashSet::new();
    let mut parts = Vec::new();
    for part in paths
        .iter()
        .flat_map(|path| path.split(':'))
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        if seen.insert(part.to_string()) {
            parts.push(part.to_string());
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(":"))
    }
}

#[cfg(test)]
mod tests {
    use super::merge_paths;

    #[test]
    fn merge_paths_deduplicates_and_drops_empty_segments() {
        let path = merge_paths(vec![
            "/a:/b::".to_string(),
            " /b : /c ".to_string(),
            String::new(),
        ]);

        assert_eq!(path.as_deref(), Some("/a:/b:/c"));
    }
}
