#[test]
fn chat_duplex_process_bulk_covers_queued_and_later_requests_but_not_next_attempt() {
    let bulk: ChatPermissionDecision = serde_json::from_str("\"approveAll\"").unwrap();
    for provider in PROVIDERS {
        let fixture = Fixture::new(provider);
        let mut prompts = 0;
        let result = fixture.run("bulk", "string", |_| {}, |status| {
            if let Some(pending) = status.pending_permission {
                prompts += 1;
                fixture.jobs.decide_chat_permission(ChatPermissionDecisionRequest {
                    job_id: status.job_id, session_id: status.session_id,
                    request_id: pending.request_id, provider, decision: bulk,
                }).unwrap();
            }
        }).unwrap();
        assert!(result.success(), "{provider:?}: {}", result.failure_message());
        assert_eq!(prompts, 1, "bulk must cover queued and later requests");
        assert_eq!(fs::read_to_string(fixture.dir.join("tool-marker")).unwrap().lines().count(), 4);
        assert_eq!(fixture.records().iter().filter(|r| r.get("verified_concurrent_reply").is_some()).count(), 4);
        // A new execution of the same Session/job has no retained bulk state.
        let mut fresh = false;
        let result = fixture.run("deny", "number", |_| {}, |status| {
            fresh |= status.pending_permission.is_some();
            fixture.decide(status, ChatPermissionDecision::Deny);
        }).unwrap();
        assert!(fresh, "consent must reset for every response/attempt");
        assert!(result.success());
        assert_eq!(fs::read_to_string(fixture.dir.join("tool-marker")).unwrap().lines().count(), 4);
    }
}

#[test]
fn chat_duplex_process_bulk_keeps_reject_only_copilot_request_explicit() {
    let fixture = Fixture::new(AiProvider::CopilotCli);
    let mut prompts = 0;
    let result = fixture.run("bulk_reject_only", "number", |_| {}, |status| {
        if let Some(pending) = status.pending_permission {
            prompts += 1;
            assert_eq!(pending.can_approve, prompts == 1);
            fixture.jobs.decide_chat_permission(ChatPermissionDecisionRequest {
                job_id: status.job_id, session_id: status.session_id,
                request_id: pending.request_id, provider: pending.provider,
                decision: if prompts == 1 { ChatPermissionDecision::ApproveAll } else { ChatPermissionDecision::Deny },
            }).unwrap();
        }
    }).unwrap();
    assert!(result.success());
    assert_eq!(prompts, 2);
    let verified = fixture.records().into_iter().filter(|r| r.get("verified_concurrent_reply").is_some()).collect::<Vec<_>>();
    assert_eq!(verified.len(), 4);
    assert_eq!(verified[1]["approved"], false);
    assert_eq!(fs::read_to_string(fixture.dir.join("tool-marker")).unwrap().lines().count(), 3);
}

#[test]
fn chat_duplex_process_bulk_cancel_or_delete_before_next_prompt_revokes_queued_authority() {
    for provider in PROVIDERS {
        for delete in [false, true] {
            let fixture = Fixture::new(provider);
            let mut granted = false;
            let mut deletion = None;
            let result = fixture.run("bulk", "number", |_| {}, |status| {
                if let Some(pending) = status.pending_permission {
                    assert!(!granted);
                    fixture.jobs.decide_chat_permission(ChatPermissionDecisionRequest {
                        job_id: status.job_id, session_id: status.session_id,
                        request_id: pending.request_id, provider,
                        decision: ChatPermissionDecision::ApproveAll,
                    }).unwrap();
                    granted = true;
                } else if granted && !fixture.control.is_cancelled() {
                    if delete {
                        let guard = fixture.jobs.begin_session_deletion("session").unwrap();
                        guard.cancel_jobs().unwrap();
                        deletion = Some(guard);
                    } else { fixture.jobs.cancel("job").unwrap(); }
                }
            });
            assert!(granted);
            assert!(result.is_err() || result.unwrap().cancelled);
            assert!(fixture.jobs.status("job").unwrap().pending_permission.is_none());
            let replies = fixture.records().iter().filter(|r| r.get("verified_concurrent_reply").is_some()).count();
            assert!(replies <= 1, "unresolved queued requests must not receive bulk replies");
            drop(deletion);
        }
    }
}
