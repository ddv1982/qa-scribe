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
    append_home_provider_paths, cached_or_compute, merge_paths, resolve_provider_executable_in_path,
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
