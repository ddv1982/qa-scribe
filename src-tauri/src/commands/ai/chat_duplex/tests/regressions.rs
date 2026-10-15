// Exercise fixture cwd validation independently of production cwd selection.
// Frames come from the real adapter, including all protocol/session fields.
#[cfg(unix)]
fn fixture_cwd_policy_handshake(provider: AiProvider, equivalent: bool) {
    use std::os::unix::fs::symlink;

    let fixture = Fixture::new(provider);
    let actual = fixture.dir.join("actual");
    let distinct = fixture.dir.join("distinct");
    let alias = fixture.dir.join("cwd-alias");
    fs::create_dir(&actual).unwrap();
    fs::create_dir(&distinct).unwrap();
    let actual = actual.canonicalize().unwrap();
    symlink(&actual, &alias).unwrap();
    let transmitted = if equivalent { &alias } else { &distinct };
    assert_ne!(transmitted, &actual, "must not test raw string equality");
    assert_eq!(transmitted.canonicalize().unwrap() == actual, equivalent);

    let mut protocol = ChatProtocol::new(
        provider,
        "fixture prompt",
        "chosen-model",
        Some("high"),
        transmitted.to_str().unwrap(),
    );
    let initial = protocol.initial_message();
    let initialized = match provider {
        AiProvider::CodexCli => json!({"id":initial["id"],"result":{}}),
        AiProvider::CopilotCli => json!({"jsonrpc":"2.0","id":initial["id"],
            "result":{"protocolVersion":1}}),
        _ => unreachable!(),
    };
    let mut frames = vec![initial];
    for event in protocol.handle(&initialized).unwrap() {
        if let ChatProtocolEvent::Send(frame) = event {
            frames.push(frame);
        }
    }
    let new = frames.last().unwrap();
    assert_eq!(new["params"]["cwd"], transmitted.to_str().unwrap());
    let created = match provider {
        AiProvider::CodexCli => {
            assert_eq!(new["method"], "thread/start");
            assert_eq!(new["params"]["ephemeral"], true);
            for key in ["approvalPolicy", "sandbox", "sandboxPolicy"] {
                assert!(new["params"].get(key).is_none());
            }
            json!({"id":new["id"],"result":{"thread":{"id":"thread-1"},"model":"actualmodel"}})
        }
        AiProvider::CopilotCli => {
            assert_eq!(new["method"], "session/new");
            assert_eq!(new["params"], json!({"cwd":transmitted,"mcpServers":[]}));
            json!({"jsonrpc":"2.0","id":new["id"],"result":{"sessionId":"session-1"}})
        }
        _ => unreachable!(),
    };
    let cwd_frame_count = frames.len();
    for event in protocol.handle(&created).unwrap() {
        if let ChatProtocolEvent::Send(frame) = event {
            frames.push(frame);
        }
    }
    assert_eq!(frames.len(), cwd_frame_count + 1);
    let prompt = frames.last().unwrap();
    match provider {
        AiProvider::CodexCli => {
            assert_eq!(prompt["method"], "turn/start");
            assert_eq!(prompt["params"]["threadId"], "thread-1");
            assert_eq!(prompt["params"]["input"][0]["text"], "fixture prompt");
        }
        AiProvider::CopilotCli => {
            assert_eq!(prompt["method"], "session/prompt");
            assert_eq!(prompt["params"]["sessionId"], "session-1");
            assert_eq!(prompt["params"]["prompt"], json!([{"type":"text","text":"fixture prompt"}]));
        }
        _ => unreachable!(),
    }

    let command = fixture.command("policy", "string");
    let mut child = Command::new(&command.program)
        .args(&command.args)
        .current_dir(&actual)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // Policy mode exits after the prompt, so it never needs a permission reply
    // or the cleanup of a long-lived server. Close stdin to bound malformed input.
    let mut stdin = child.stdin.take().unwrap();
    let input: String = frames.iter().map(|frame| format!("{frame}\n")).collect();
    // One sub-PIPE_BUF write avoids racing a rejection against later writes.
    assert!(input.len() < 4096);
    stdin.write_all(input.as_bytes()).unwrap();
    drop(stdin);
    let started = Instant::now();
    while child.try_wait().unwrap().is_none() {
        if started.elapsed() > Duration::from_secs(3) {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!("{provider:?}: fixture handshake timed out");
        }
        thread::sleep(Duration::from_millis(5));
    }
    let output = child.wait_with_output().unwrap();
    let stderr = String::from_utf8(output.stderr).unwrap();
    let records = fixture.records();
    assert_eq!(records[0]["cwd"], actual.to_str().unwrap());
    assert!(!fixture.dir.join("tool-marker").exists());
    let received: Vec<_> = records.iter().filter_map(|r| r.get("received")).cloned().collect();
    if equivalent {
        assert_eq!(output.status.code(), Some(7),
            "{provider:?}: equivalent cwd must reach policy denial, not a handshake assertion: {stderr}");
        assert_eq!(stderr, "Permission denied by configured policy\n");
        assert_eq!(received, frames, "the entire valid handshake must reach the child");
        let replies: Vec<Value> = String::from_utf8(output.stdout).unwrap().lines()
            .map(|line| serde_json::from_str(line).unwrap()).collect();
        let expected = match provider {
            AiProvider::CodexCli => vec![
                json!({"id":"qa-scribe-init","result":{}}),
                json!({"id":"qa-scribe-thread","result":{"thread":{"id":"thread-1"},"model":"actualmodel"}}),
                json!({"id":"qa-scribe-turn","result":{"turn":{"id":"turn-1","status":"inProgress"}}}),
            ],
            AiProvider::CopilotCli => vec![
                json!({"jsonrpc":"2.0","id":"qa-scribe-init","result":{"protocolVersion":1}}),
                json!({"jsonrpc":"2.0","id":"qa-scribe-session","result":{"sessionId":"session-1"}}),
            ],
            _ => unreachable!(),
        };
        assert_eq!(replies, expected);
    } else {
        assert_eq!(output.status.code(), Some(1), "{provider:?}: {stderr}");
        assert!(stderr.contains("AssertionError") && stderr.contains("cwd"), "{stderr}");
        assert!(!stderr.contains("Permission denied by configured policy"));
        assert_eq!(received, frames[..cwd_frame_count],
            "a distinct directory must be rejected before accepting the prompt");
    }
}

#[cfg(unix)]
#[test]
fn chat_duplex_fixture_codex_symlink_cwd_reaches_policy_denial() {
    fixture_cwd_policy_handshake(AiProvider::CodexCli, true);
}

#[cfg(unix)]
#[test]
fn chat_duplex_fixture_copilot_symlink_cwd_reaches_policy_denial() {
    fixture_cwd_policy_handshake(AiProvider::CopilotCli, true);
}

#[cfg(unix)]
#[test]
fn chat_duplex_fixture_distinct_cwd_rejected_before_policy_denial() {
    for provider in [AiProvider::CodexCli, AiProvider::CopilotCli] {
        fixture_cwd_policy_handshake(provider, false);
    }
}

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
