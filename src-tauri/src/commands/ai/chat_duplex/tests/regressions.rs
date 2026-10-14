#[test]
fn chat_duplex_process_output_line_total_bounds_and_silent_watchdog() {
    for mode in ["line", "total", "silent"] {
        let fixture = Fixture::new(AiProvider::ClaudeCode);
        let started = Instant::now();
        let error = fixture.run(mode, "number", |_| {}, |_| {}).unwrap_err();
        assert!(!fixture.records().is_empty());
        let expected = match mode {
            "line" => "line exceeded", "total" => "output exceeded", _ => "timed out",
        };
        assert!(error.to_lowercase().contains(expected), "{mode}: {error}");
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(!fixture.dir.join("tool-marker").exists());
    }
}

#[test]
fn chat_duplex_process_cwd_scopes_are_private_stable_or_neutral() {
    for provider in PROVIDERS {
        let fixture = Fixture::new(provider);
        let mut paths = Vec::new();
        for _ in 0..2 {
            fixture.run("deny", "string", |_| {}, |status| {
                fixture.decide(status, ChatPermissionDecision::Deny);
            }).unwrap();
            let records = fixture.records();
            let cwd = records.iter().rev().find_map(|r| r["cwd"].as_str()).unwrap();
            paths.push(PathBuf::from(cwd));
        }
        if provider == AiProvider::CopilotCli {
            assert_eq!(paths[0], paths[1]);
            assert_eq!(paths[0], fixture.dir.join("copilot-chat").canonicalize().unwrap());
            #[cfg(unix)] {
                use std::os::unix::fs::PermissionsExt;
                assert_eq!(fs::metadata(&paths[0]).unwrap().permissions().mode() & 0o777, 0o700);
            }
        } else {
            assert_ne!(paths[0], paths[1]);
            for path in paths { assert!(!path.exists(), "neutral cwd must be removed"); }
        }
    }
}

#[test]
fn chat_duplex_process_pending_provider_cancel_duplicate_and_live_eof_cleanup() {
    for provider in PROVIDERS {
        for mode in ["pending_cancel", "pending_duplicate", "eof_live"] {
            let fixture = Fixture::new(provider);
            let mut pending_seen = false;
            let mut final_pending = false;
            let started = Instant::now();
            let result = fixture.run(mode, "string", |_| {}, |status| {
                final_pending = status.pending_permission.is_some();
                pending_seen |= final_pending;
                // Intentionally leave permission undecided. Reading must not
                // block on UI input while the provider invalidates its turn.
            });
            assert!(!fixture.records().is_empty());
            let error = result.expect_err("invalidated turn must fail");
            assert!(!error.contains("timed out"), "{provider:?}/{mode}: {error}");
            assert!(started.elapsed() < Duration::from_secs(2));
            assert_eq!(pending_seen, mode != "eof_live");
            assert!(!final_pending, "observer must receive permission revocation");
            assert!(fixture.jobs.status("job").unwrap().pending_permission.is_none());
            assert!(!fixture.dir.join("tool-marker").exists());
        }
    }
}

#[test]
fn chat_duplex_process_reported_model_preserves_trusted_protocol_metadata() {
    for provider in [AiProvider::ClaudeCode, AiProvider::CodexCli] {
        let fixture = Fixture::new(provider);
        let output = fixture.run("approve", "string", |_| {}, |status| {
            fixture.decide(status, ChatPermissionDecision::Approve);
        }).expect("model metadata requires a successful real protocol exchange");
        assert!(output.success(), "{provider:?}: {}", output.failure_message());
        assert!(fixture.records().iter().any(|record| record["verified_reply"] == true));
        assert_eq!(output.response_text().unwrap(), "Connected.");
        // Selection is chosen-model. The child reports actualmodel through
        // Claude assistant.model or Codex thread/start result.model instead.
        assert_eq!(output.reported_model().as_deref(), Some("actualmodel"),
            "{provider:?}: AI Run must retain the trusted resolved model");
    }
}

#[test]
fn chat_duplex_process_huge_failure_diagnostics_are_bounded_and_utf8_safe() {
    for provider in PROVIDERS {
        let fixture = Fixture::new(provider);
        let mut pending = false;
        let error = fixture.run("huge_failure", "string", |_| {}, |status| {
            pending |= status.pending_permission.is_some();
        }).expect_err("child failure must remain visible");
        assert!(fixture.records().iter().any(|record|
            record["huge_failure_bytes"].as_u64().is_some_and(|bytes| bytes > 256 * 1024)),
            "must exercise real child diagnostics beyond the capture tail");
        assert!(error.len() <= 1600,
            "{provider:?}: persisted Chat error exceeds 1600 bytes: {}", error.len());
        assert!(!error.contains('\u{fffd}'), "must not split valid UTF-8 diagnostics");
        assert!(error.ends_with("diagnostic-tail-🧪"), "must retain actionable diagnostic tail");
        assert!(!pending);
        assert!(!fixture.dir.join("tool-marker").exists());
        assert!(fixture.jobs.status("job").unwrap().pending_permission.is_none());
    }
}
