use std::{
    env, fs,
    hash::{DefaultHasher, Hash, Hasher},
    path::{Path, PathBuf},
};

use qa_scribe_core::domain::AiProvider;

use crate::commands::providers::rollout::provider_catalog_rollout;

pub(super) fn provider_executable(provider: AiProvider) -> &'static str {
    match provider {
        AiProvider::ClaudeCode => "claude",
        AiProvider::CodexCli => "codex",
        AiProvider::CopilotCli => "copilot",
    }
}

pub(super) fn discovery_cache_fingerprint(provider: AiProvider, executable: Option<&Path>) -> u64 {
    const DISCOVERY_SCHEMA_VERSION: u16 = 2;
    let mut hasher = DefaultHasher::new();
    DISCOVERY_SCHEMA_VERSION.hash(&mut hasher);
    provider.hash(&mut hasher);
    provider_catalog_rollout().hash(&mut hasher);
    if let Some(executable) = executable {
        executable.hash(&mut hasher);
        hash_file_metadata(executable, &mut hasher);
    }

    let (variables, files): (&[&str], Vec<PathBuf>) = match provider {
        AiProvider::ClaudeCode => (
            &[
                "ANTHROPIC_API_KEY",
                "ANTHROPIC_AUTH_TOKEN",
                "CLAUDE_CODE_USE_BEDROCK",
                "CLAUDE_CODE_USE_VERTEX",
                "CLAUDE_CODE_USE_FOUNDRY",
                "CLAUDE_CONFIG_DIR",
            ],
            claude_identity_files(),
        ),
        AiProvider::CodexCli => (&["OPENAI_API_KEY", "CODEX_HOME"], codex_identity_files()),
        AiProvider::CopilotCli => (
            &[
                "COPILOT_GITHUB_TOKEN",
                "GH_TOKEN",
                "GITHUB_TOKEN",
                "COPILOT_HOME",
            ],
            copilot_identity_files(),
        ),
    };
    for variable in variables {
        variable.hash(&mut hasher);
        env::var_os(variable)
            .is_some_and(|value| !value.is_empty())
            .hash(&mut hasher);
    }
    let scope_variables: &[&str] = match provider {
        AiProvider::ClaudeCode => &[
            "CLAUDE_CODE_USE_BEDROCK",
            "CLAUDE_CODE_USE_VERTEX",
            "CLAUDE_CODE_USE_FOUNDRY",
        ],
        AiProvider::CodexCli => &[],
        AiProvider::CopilotCli => &["GH_HOST"],
    };
    for variable in scope_variables {
        variable.hash(&mut hasher);
        // These values select a provider class or host and are not
        // credentials. Hash them directly into the in-memory cache key so a
        // scope switch invalidates the catalog without retaining the value.
        env::var_os(variable).hash(&mut hasher);
    }
    for file in files {
        file.hash(&mut hasher);
        hash_file_metadata(&file, &mut hasher);
    }
    hasher.finish()
}

fn hash_file_metadata(path: &Path, hasher: &mut DefaultHasher) {
    let Ok(metadata) = fs::metadata(path) else {
        false.hash(hasher);
        return;
    };
    true.hash(hasher);
    metadata.len().hash(hasher);
    metadata.modified().ok().hash(hasher);
}

fn home_relative_identity_files(paths: &[&str]) -> Vec<PathBuf> {
    let Some(home) = env::var_os("HOME").filter(|value| !value.is_empty()) else {
        return Vec::new();
    };
    let home = PathBuf::from(home);
    paths.iter().map(|path| home.join(path)).collect()
}

fn codex_identity_files() -> Vec<PathBuf> {
    if let Some(directory) = env::var_os("CODEX_HOME").filter(|value| !value.is_empty()) {
        let directory = PathBuf::from(directory);
        vec![directory.join("auth.json"), directory.join("config.toml")]
    } else {
        home_relative_identity_files(&[".codex/auth.json", ".codex/config.toml"])
    }
}

fn claude_identity_files() -> Vec<PathBuf> {
    claude_identity_files_from_sources(
        env::var_os("CLAUDE_CONFIG_DIR")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from),
        env::var_os("HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from),
        claude_managed_identity_files(),
    )
}

fn claude_identity_files_from_sources(
    config: Option<PathBuf>,
    home: Option<PathBuf>,
    managed: Vec<PathBuf>,
) -> Vec<PathBuf> {
    let mut files = if let Some(config) = config {
        vec![
            config.join(".credentials.json"),
            config.join("settings.json"),
        ]
    } else if let Some(home) = home {
        vec![
            home.join(".claude/.credentials.json"),
            home.join(".claude/settings.json"),
        ]
    } else {
        Vec::new()
    };
    files.extend(managed);
    files
}

fn claude_managed_identity_files() -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        vec![PathBuf::from(
            "/Library/Application Support/ClaudeCode/managed-settings.json",
        )]
    } else if cfg!(windows) {
        env::var_os("PROGRAMDATA")
            .map(PathBuf::from)
            .map(|path| path.join("ClaudeCode/managed-settings.json"))
            .into_iter()
            .collect()
    } else {
        vec![PathBuf::from("/etc/claude-code/managed-settings.json")]
    }
}

fn copilot_identity_files() -> Vec<PathBuf> {
    let mut files =
        if let Some(config) = env::var_os("COPILOT_HOME").filter(|value| !value.is_empty()) {
            let config = PathBuf::from(config);
            vec![config.join("settings.json"), config.join("config.json")]
        } else {
            home_relative_identity_files(&[".copilot/settings.json", ".copilot/config.json"])
        };
    files.extend(home_relative_identity_files(&[".config/gh/hosts.yml"]));
    files
}

#[cfg(test)]
mod tests {
    use super::claude_identity_files_from_sources;
    use std::path::PathBuf;

    #[test]
    fn claude_identity_always_includes_managed_policy_with_a_config_override() {
        let managed = PathBuf::from("/managed/ClaudeCode/managed-settings.json");
        let files = claude_identity_files_from_sources(
            Some(PathBuf::from("/custom/claude")),
            Some(PathBuf::from("/ignored/home")),
            vec![managed.clone()],
        );

        assert_eq!(
            files,
            vec![
                PathBuf::from("/custom/claude/.credentials.json"),
                PathBuf::from("/custom/claude/settings.json"),
                managed,
            ]
        );
    }
    #[test]
    fn codex_override_metadata_and_directory_changes_invalidate_fingerprint() {
        const CHILD: &str = "QA_SCRIBE_CODEX_IDENTITY_TEST_CHILD";
        if std::env::var(CHILD).as_deref() == Ok("codex") {
            println!(
                "CODEX_FINGERPRINT={}",
                super::discovery_cache_fingerprint(
                    qa_scribe_core::domain::AiProvider::CodexCli,
                    None
                )
            );
            return;
        }
        struct Scope(PathBuf);
        impl Drop for Scope {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let scope =
            Scope(std::env::temp_dir().join(format!("qa-codex-identity-{}", uuid::Uuid::new_v4())));
        let home = scope.0.join("synthetic-home");
        let default = home.join(".codex");
        let first = scope.0.join("first-override");
        let second = scope.0.join("second-override");
        for directory in [&default, &first, &second] {
            std::fs::create_dir_all(directory).unwrap();
            std::fs::write(directory.join("auth.json"), "synthetic-auth").unwrap();
            std::fs::write(directory.join("config.toml"), "synthetic-config").unwrap();
        }
        let fingerprint = |override_path: Option<&std::path::Path>| {
            use std::{
                process::{Command, Stdio},
                time::{Duration, Instant},
            };
            let mut command = Command::new(std::env::current_exe().unwrap());
            command.args(["--exact", "commands::providers::probe::identity::tests::codex_override_metadata_and_directory_changes_invalidate_fingerprint", "--nocapture"])
                .env(CHILD, "codex").env("HOME", &home).stdout(Stdio::piped()).stderr(Stdio::piped());
            match override_path {
                Some(path) => {
                    command.env("CODEX_HOME", path);
                }
                None => {
                    command.env_remove("CODEX_HOME");
                }
            }
            let mut child = command.spawn().unwrap();
            let deadline = Instant::now() + Duration::from_secs(5);
            while child.try_wait().unwrap().is_none() {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    panic!("identity child exceeded five-second deadline");
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            let output = child.wait_with_output().unwrap();
            assert!(output.status.success());
            String::from_utf8(output.stdout)
                .unwrap()
                .lines()
                .find_map(|line| {
                    line.strip_prefix("CODEX_FINGERPRINT=")
                        .map(|value| value.parse::<u64>().unwrap())
                })
                .expect("actual child fingerprint")
        };
        let before_auth = fingerprint(Some(&first));
        std::fs::write(
            first.join("auth.json"),
            "synthetic-auth-with-changed-length",
        )
        .unwrap();
        let after_auth = fingerprint(Some(&first));
        assert_ne!(
            before_auth, after_auth,
            "actual override auth metadata must invalidate the fingerprint"
        );
        std::fs::write(
            first.join("config.toml"),
            "synthetic-config-with-changed-length",
        )
        .unwrap();
        let after_config = fingerprint(Some(&first));
        assert_ne!(
            after_auth, after_config,
            "actual override config metadata must invalidate the fingerprint"
        );
        std::fs::write(
            default.join("auth.json"),
            "unused-default-auth-with-changed-length",
        )
        .unwrap();
        assert_eq!(
            after_config,
            fingerprint(Some(&first)),
            "unused HOME metadata must not replace the active override identity"
        );
        assert_ne!(
            fingerprint(Some(&first)),
            fingerprint(Some(&second)),
            "switching nonempty override directories must invalidate the fingerprint"
        );
        let fallback = fingerprint(None);
        assert_eq!(
            fallback,
            fingerprint(Some(std::path::Path::new(""))),
            "empty override delegates to HOME/.codex"
        );
        std::fs::write(
            default.join("config.toml"),
            "default-config-with-changed-length",
        )
        .unwrap();
        assert_ne!(
            fallback,
            fingerprint(None),
            "fallback config metadata must still invalidate the fingerprint"
        );
    }
}
