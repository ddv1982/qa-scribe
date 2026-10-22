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
    NeutralProviderCwd, append_home_provider_paths, append_nvm_node_bins, cached_or_compute,
    merge_paths, resolve_provider_executable_in_path,
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
fn nvm_fallback_prefers_numeric_node_versions_over_lexical_order() {
    let home = std::env::temp_dir().join(format!(
        "qa-scribe-nvm-order-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    for version in ["v9.99.0", "v20.1.0", "v100.0.0"] {
        fs::create_dir_all(home.join(".nvm/versions/node").join(version).join("bin"))
            .expect("fake NVM version should create");
    }
    let mut paths = Vec::new();

    append_nvm_node_bins(&mut paths, &home);

    assert_eq!(
        paths,
        ["v100.0.0", "v20.1.0", "v9.99.0"]
            .map(|version| home.join(".nvm/versions/node").join(version).join("bin"))
    );
    let _ = fs::remove_dir_all(home);
}

#[cfg(unix)]
#[test]
fn neutral_provider_directory_is_private() {
    let directory = NeutralProviderCwd::new().expect("private provider directory should create");

    assert_eq!(
        fs::metadata(directory.path())
            .expect("provider directory metadata")
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
}

#[test]
fn neutral_provider_directory_creation_fails_closed() {
    let blocked_parent = std::env::temp_dir().join(format!(
        "qa-scribe-provider-cwd-blocked-{}",
        uuid::Uuid::new_v4().simple()
    ));
    fs::write(&blocked_parent, b"not a directory").expect("blocking file should create");

    let error = NeutralProviderCwd::new_in(&blocked_parent)
        .err()
        .expect("a file cannot own a child provider directory");

    assert!(
        error
            .to_string()
            .contains("Could not create a private working directory for the provider")
    );
    assert!(error.to_string().contains("provider was not started"));
    let _ = fs::remove_file(blocked_parent);
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

#[cfg(unix)]
#[test]
fn fixture_lookup_isolation() {
    use super::{
        ProviderPathMode, apply_provider_path, provider_executable_path, provider_process_path,
    };
    use std::process::Command;

    if let Some(root) = std::env::var_os("QA_SCRIBE_LOOKUP_TEST_ROOT") {
        let root = PathBuf::from(root);
        let mode = if std::env::var("QA_SCRIBE_LOOKUP_TEST_MODE").unwrap() == "fast" {
            ProviderPathMode::Fast
        } else {
            ProviderPathMode::Deep
        };
        let restricted = cfg!(feature = "e2e")
            && std::env::var_os("QA_SCRIBE_E2E_PROVIDER_PATH")
                .is_some_and(|value| !value.is_empty());
        let present = root.join("fixtures/codex").is_file();
        for program in ["claude", "codex", "copilot"] {
            let expected = if restricted {
                present.then(|| root.join("fixtures").join(program))
            } else {
                Some(root.join("host").join(program))
            };
            let resolved = provider_executable_path(program, mode);
            assert_eq!(resolved, expected, "{mode:?} lookup for {program}");
            let process_path = provider_process_path(program);
            if restricted && !present {
                assert_eq!(
                    process_path.unwrap_err().kind(),
                    std::io::ErrorKind::NotFound
                );
            } else {
                let executable = process_path.unwrap();
                if restricted {
                    assert_eq!(Some(executable.clone()), resolved);
                    assert!(executable.starts_with(&root));
                } else {
                    assert_eq!(executable, PathBuf::from(program));
                }
                let mut command = Command::new(executable);
                command.current_dir(&root);
                apply_provider_path(&mut command);
                let output = command.output().expect("synthetic executable runs");
                assert!(output.status.success(), "{output:?}");
                let expected_output = if restricted {
                    "fixture interpreter and tool preserved\n"
                } else {
                    "synthetic host executable\n"
                };
                assert_eq!(String::from_utf8(output.stdout).unwrap(), expected_output);
            }
        }
        assert_eq!(root.join("host-ran").exists(), !restricted);
        if restricted && !present {
            assert!(!root.join("shell-ran").exists());
        }
        if std::env::var("QA_SCRIBE_LOOKUP_TEST_SCENARIO").as_deref() == Ok("discovery") {
            let fast = crate::commands::providers::get_provider_status();
            assert!(fast.providers.iter().all(|provider| !provider.available));
            let deep = tauri::async_runtime::block_on(
                crate::commands::providers::refresh_provider_status(),
            );
            assert!(deep.providers.iter().all(|provider| !provider.available));
            assert!(
                !root.join("host-ran").exists(),
                "Deep discovery must not spawn a host executable when its fixture is absent"
            );
            assert!(!root.join("shell-ran").exists());
        }
        println!(
            "verified {mode:?}: fixture_authority={restricted}, fixture_present={present}, host_marker={}",
            root.join("host-ran").exists()
        );
        return;
    }

    let root = std::env::temp_dir().join(format!(
        "qa-scribe-fixture-lookup-{}",
        uuid::Uuid::new_v4().simple()
    ));
    for mode in ["fast", "deep"] {
        let mut scenarios = vec!["missing", "present", "unset", "empty"];
        if cfg!(feature = "e2e") && mode == "deep" {
            scenarios.push("discovery");
        }
        for scenario in scenarios {
            let directory = root.join(format!("{mode}-{scenario}"));
            let host = directory.join("host");
            let fixtures = directory.join("fixtures");
            fs::create_dir_all(&host).unwrap();
            fs::create_dir_all(&fixtures).unwrap();
            for program in ["claude", "codex", "copilot"] {
                let path = host.join(program);
                fs::write(&path, "#!/bin/sh\n: > \"$QA_SCRIBE_LOOKUP_HOST_MARKER\"\nprintf 'synthetic host executable\\n'\n").unwrap();
                make_executable(&path);
                if scenario == "present" {
                    let path = fixtures.join(program);
                    fs::write(&path, "#!/usr/bin/env sh\nux3-fixture-helper\n").unwrap();
                    make_executable(&path);
                }
            }
            let helper = host.join("ux3-fixture-helper");
            fs::write(
                &helper,
                "#!/bin/sh\nprintf 'fixture interpreter and tool preserved\\n'\n",
            )
            .unwrap();
            make_executable(&helper);
            let shell = directory.join("login-shell");
            fs::write(&shell, "#!/bin/sh\n: > \"$QA_SCRIBE_LOOKUP_SHELL_MARKER\"\nprintf '%s' \"$QA_SCRIBE_LOOKUP_HOST_PATH\"\n").unwrap();
            make_executable(&shell);
            let host_path =
                std::env::join_paths([host, PathBuf::from("/usr/bin"), PathBuf::from("/bin")])
                    .unwrap();
            let mut command = Command::new(std::env::current_exe().unwrap());
            command
                .args([
                    "--exact",
                    "provider_command::tests::fixture_lookup_isolation",
                    "--nocapture",
                ])
                .env("QA_SCRIBE_LOOKUP_TEST_ROOT", &directory)
                .env("QA_SCRIBE_LOOKUP_TEST_MODE", mode)
                .env("QA_SCRIBE_LOOKUP_TEST_SCENARIO", scenario)
                .env("CODEX_HOME", directory.join(".codex"))
                .env("CLAUDE_CONFIG_DIR", directory.join(".claude"))
                .env("COPILOT_HOME", directory.join(".copilot"))
                .env("XDG_CONFIG_HOME", directory.join("config"))
                .env("QA_SCRIBE_LOOKUP_HOST_MARKER", directory.join("host-ran"))
                .env("QA_SCRIBE_LOOKUP_SHELL_MARKER", directory.join("shell-ran"))
                .env("QA_SCRIBE_LOOKUP_HOST_PATH", &host_path)
                .env("PATH", host_path)
                .env("HOME", &directory)
                .env("SHELL", shell);
            match scenario {
                "unset" => {
                    command.env_remove("QA_SCRIBE_E2E_PROVIDER_PATH");
                }
                "empty" => {
                    command.env("QA_SCRIBE_E2E_PROVIDER_PATH", "");
                }
                _ => {
                    command.env("QA_SCRIBE_E2E_PROVIDER_PATH", fixtures);
                }
            }
            let output = command.output().expect("isolated lookup test starts");
            print!("{}", String::from_utf8_lossy(&output.stdout));
            assert!(
                output.status.success(),
                "{mode}-{scenario}: {}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }
    fs::remove_dir_all(root).unwrap();
}
