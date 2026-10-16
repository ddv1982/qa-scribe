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
        assert!(!error.message.contains("timed out"), "watchdog failure is not parent-exit detection: {error}");
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

// R8-02: exercise the real queue, then cross each authority-loss boundary.
// No decision is submitted until a later stdout update proves all three
// permission frames have passed through the core protocol FIFO.
#[test]
fn chat_duplex_process_queued_ui_cancel_between_head_and_next_publish() {
    for provider in PROVIDERS {
        assert_queued_authority_boundary(provider, "queued_ui_cancel");
    }
}

#[test]
fn chat_duplex_process_queued_session_delete_between_head_and_next_publish() {
    for provider in PROVIDERS {
        assert_queued_authority_boundary(provider, "queued_session_delete");
    }
}

#[test]
fn chat_duplex_process_queued_metadata_fails_at_next_publish_after_head_reply() {
    for provider in PROVIDERS {
        assert_queued_authority_boundary(provider, "queued_bad_publish");
    }
}

#[test]
fn chat_duplex_process_queued_watchdog_revokes_without_replies() {
    for provider in PROVIDERS {
        assert_queued_authority_boundary(provider, "queued_watchdog");
    }
}

#[cfg(unix)]
#[test]
fn chat_duplex_process_queued_parent_exit_revokes_and_reaps_group() {
    for provider in PROVIDERS {
        assert_queued_authority_boundary(provider, "queued_parent_exit");
    }
}

fn wait_for_queued_fixture_marker(fixture: &Fixture, name: &str) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while !fixture.dir.join(name).exists() {
        assert!(Instant::now() < deadline, "fixture never wrote {name}");
        thread::sleep(Duration::from_millis(2));
    }
}

fn assert_queued_authority_boundary(provider: AiProvider, mode: &str) {
    use std::cell::{Cell, RefCell};

    let fixture = Fixture::new(provider);
    let stale = RefCell::new(None::<ChatPermissionDecisionRequest>);
    let buffered = Cell::new(false);
    let head_consumed = Cell::new(false);
    let mut publications = 0;
    let mut final_pending = false;
    let mut deletion = None;
    let resolves_head = matches!(mode,
        "queued_ui_cancel" | "queued_session_delete" | "queued_bad_publish");
    let result = run_chat_duplex_with_limits(
        &fixture.command(mode, "string"), &fixture.context(),
        |update| {
            let marker = match update {
                StreamUpdate::PartialDelta(text) | StreamUpdate::PartialSnapshot(text) =>
                    text == "Queued requests buffered.",
                _ => false,
            };
            if !marker { return; }
            assert!(!buffered.replace(true), "queue marker must be unique");
            let request = stale.borrow().clone().expect("head published before queue marker");
            if resolves_head {
                fixture.jobs.decide_chat_permission(request).unwrap();
            } else if mode == "queued_parent_exit" {
                fs::write(fixture.dir.join("exit-release"), "exit\n").unwrap();
                // Hold the callback until the actual parent has exited. The
                // next runner iteration must revoke the still-pending head.
                let deadline = Instant::now() + Duration::from_secs(2);
                while fixture.control.child_exit_status().unwrap().is_none() {
                    assert!(Instant::now() < deadline, "fixture parent did not exit");
                    thread::sleep(Duration::from_millis(2));
                }
            }
        },
        |status| {
            final_pending = status.pending_permission.is_some();
            if let Some(pending) = status.pending_permission {
                publications += 1;
                assert_eq!(publications, 1, "unresolved queued requests must never publish");
                *stale.borrow_mut() = Some(ChatPermissionDecisionRequest {
                    job_id: status.job_id, session_id: status.session_id,
                    request_id: pending.request_id, provider: pending.provider,
                    decision: ChatPermissionDecision::Deny,
                });
            } else if resolves_head && buffered.get() && !head_consumed.replace(true) {
                // This is the runner's post-reply callback, before it takes and
                // publishes request two. Wait for child-side receipt, not time.
                wait_for_queued_fixture_marker(&fixture, "head-replied");
                assert!(fixture.jobs.status("job").unwrap().pending_permission.is_none());
                if mode == "queued_ui_cancel" {
                    fixture.jobs.cancel("job").unwrap();
                } else if mode == "queued_session_delete" {
                    deletion = Some(fixture.jobs.begin_session_deletion("session").unwrap());
                }
            }
        },
        DuplexLimits { watchdog: Duration::from_secs(3), line_bytes: 16 * 1024,
            total_bytes: 64 * 1024 },
    );
    assert!(buffered.get(), "must parse all three requests before the boundary");
    assert_eq!(publications, 1);
    assert_eq!(head_consumed.get(), resolves_head);
    assert!(!final_pending, "observer must receive revocation");
    assert!(fixture.jobs.status("job").unwrap().pending_permission.is_none());
    let mut stale = stale.into_inner().unwrap();
    stale.decision = ChatPermissionDecision::Approve;
    assert!(fixture.jobs.decide_chat_permission(stale).is_err(), "retained token must reject");
    assert!(fixture.control.child_exit_status().is_err(), "child must be reaped and unregistered");
    assert!(!fixture.dir.join("tool-marker").exists());
    if mode == "queued_ui_cancel" {
        assert!(fixture.control.is_cancelled());
        assert!(result.is_ok_and(|output| output.cancelled));
    } else {
        let error = result.expect_err("lost authority or invalid queued metadata must fail closed");
        let expected = match mode {
            "queued_session_delete" => "running chat job",
            "queued_bad_publish" if provider == AiProvider::ClaudeCode => "512 bytes",
            "queued_bad_publish" => "4096 bytes",
            "queued_watchdog" => "timed out",
            "queued_parent_exit" => "exited",
            _ => unreachable!(),
        };
        assert!(error.message.contains(expected), "{provider:?}/{mode}: {error}");
    }
    let records = fixture.records();
    let replies = records.iter().filter_map(|r| r.get("received"))
        .filter(|r| r["type"] == "control_response" || r.get("result").is_some()).count();
    assert_eq!(replies, usize::from(resolves_head), "no reply for unresolved requests");
    if resolves_head {
        assert!(records.iter().any(|r|
            r["verified_concurrent_reply"] == 0 && r["approved"] == false));
    }
    if mode == "queued_parent_exit" {
        assert!(records.iter().any(|r| r["parent_exiting_queued"] == true));
        let heartbeat = fs::read(fixture.dir.join("heartbeat")).unwrap();
        assert!(!heartbeat.is_empty());
        thread::sleep(Duration::from_millis(100));
        assert_eq!(fs::read(fixture.dir.join("heartbeat")).unwrap(), heartbeat,
            "descendant escaped queued-authority cleanup");
        #[cfg(unix)]
        {
            let parent = records.iter().find_map(|r| r["pid"].as_i64()).unwrap();
            // SAFETY: signal zero only probes this fixture's exited parent.
            assert_eq!(unsafe { libc::kill(parent as libc::pid_t, 0) }, -1);
        }
    }
    drop(deletion);
}
