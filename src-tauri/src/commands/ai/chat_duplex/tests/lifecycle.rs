// auth-adapters.R39-01: parent exit must revoke pending permission even when a
// descendant keeps the pipes open. Unix group assertions are deliberately gated.
#[cfg(unix)]
#[test]
fn chat_duplex_process_parent_exit_pending_revokes_permission_and_reaps_group() {
    for provider in PROVIDERS {
        let fixture = Fixture::new(provider);
        let mut stale = None;
        let started = Instant::now();
        let result = run_chat_duplex_with_limits(
            &fixture.command("parent_exit_pending", "string"), &fixture.context(), |_| {},
            |status| {
                if let Some(pending) = status.pending_permission {
                    stale = Some(ChatPermissionDecisionRequest {
                        job_id: status.job_id, session_id: status.session_id,
                        request_id: pending.request_id, provider: pending.provider,
                        decision: ChatPermissionDecision::Approve,
                    });
                }
            },
            DuplexLimits { watchdog: Duration::from_secs(5), line_bytes: 4096, total_bytes: 8192 },
        );
        let elapsed = started.elapsed();
        let error = result.expect_err("exited parent cannot retain actionable permission");
        let records = fixture.records();
        assert!(records.iter().any(|r| r["parent_exiting_pending"] == true));
        assert!(stale.is_some(), "must first publish real permission");
        assert!(fixture.jobs.status("job").unwrap().pending_permission.is_none());
        assert!(fixture.jobs.decide_chat_permission(stale.unwrap()).is_err(), "stale approval must be rejected");
        assert!(fixture.control.child_exit_status().is_err(), "direct child must be reaped and unregistered");
        let heartbeat = fs::read(fixture.dir.join("heartbeat")).unwrap();
        assert!(!heartbeat.is_empty());
        thread::sleep(Duration::from_millis(100));
        assert_eq!(fs::read(fixture.dir.join("heartbeat")).unwrap(), heartbeat, "descendant escaped group cleanup");
        let parent = records.iter().find_map(|r| r["pid"].as_i64()).unwrap();
        // SAFETY: signal zero only probes this fixture's already exited parent.
        assert_eq!(unsafe { libc::kill(parent as libc::pid_t, 0) }, -1, "parent zombie was not reaped");
        assert!(!fixture.dir.join("tool-marker").exists());
        assert!(!error.contains("timed out"), "watchdog failure is not parent-exit detection: {error}");
        assert!(elapsed < Duration::from_secs(1), "{provider:?}: exit detection took {elapsed:?}");
    }
}

// Preserve buffered terminal frames when adding the R39-01 parent-exit poll.
#[cfg(unix)]
#[test]
fn chat_duplex_process_parent_exit_preserves_buffered_successful_terminal_frame() {
    for provider in PROVIDERS {
        let fixture = Fixture::new(provider);
        let mut delayed_final = false;
        let output = run_chat_duplex_with_limits(
            &fixture.command("parent_exit_complete", "number"), &fixture.context(),
            |update| {
                let final_text = match update {
                    StreamUpdate::PartialDelta(text) | StreamUpdate::PartialSnapshot(text) => text == "Connected.",
                    _ => false,
                };
                if final_text && !delayed_final {
                    delayed_final = true;
                    // Let the parent exit while its terminal frame is queued.
                    thread::sleep(Duration::from_millis(150));
                }
            },
            |status| fixture.decide(status, ChatPermissionDecision::Approve),
            DuplexLimits { watchdog: Duration::from_secs(5), line_bytes: 4096, total_bytes: 8192 },
        ).expect("buffered protocol completion takes precedence over parent exit");
        assert!(delayed_final);
        assert!(output.success(), "{}", output.failure_message());
        assert_eq!(output.response_text().unwrap(), "Connected.");
        assert!(fixture.records().iter().any(|r| r["parent_exiting_complete"] == true));
        assert_eq!(fs::read_to_string(fixture.dir.join("tool-marker")).unwrap(), "executed\n");
        assert!(fixture.control.child_exit_status().is_err());
        let heartbeat = fs::read(fixture.dir.join("heartbeat")).unwrap();
        thread::sleep(Duration::from_millis(100));
        assert_eq!(fs::read(fixture.dir.join("heartbeat")).unwrap(), heartbeat);
    }
}

// auth-adapters.R39-02: continuous valid notifications cannot starve a UI reply.
#[test]
fn chat_duplex_process_busy_peer_services_permission_before_notifications_stop() {
    for provider in PROVIDERS {
        let fixture = Fixture::new(provider);
        let output = run_chat_duplex_with_limits(
            &fixture.command("busy_peer", "string"), &fixture.context(), |_| {},
            |status| fixture.decide(status, ChatPermissionDecision::Approve),
            DuplexLimits { watchdog: Duration::from_secs(5), line_bytes: 4096, total_bytes: 2 * 1024 * 1024 },
        ).expect("busy peer must complete successfully, not time out");
        assert!(output.success(), "{}", output.failure_message());
        assert_eq!(fs::read_to_string(fixture.dir.join("tool-marker")).unwrap(), "executed\n");
        let records = fixture.records();
        let progress = records.iter().find(|r| r.get("busy_frames").is_some()).unwrap();
        assert!(progress["busy_frames"].as_u64().unwrap() >= 100, "fixture must keep stdout busy");
        assert!(progress["busy_seconds"].as_f64().unwrap() >= 1.0);
        let latency = records.iter().find_map(|r| r["tool_marker_seconds"].as_f64()).unwrap();
        assert!(latency < 0.3, "{provider:?}: approval waited {latency:.3}s for stdout quiet");
        assert_eq!(output.response_text().unwrap(), "Connected.");
    }
}
