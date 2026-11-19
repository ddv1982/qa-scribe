/// Providers whose permission requests name the tool, so "Approve all" applies.
const NAMED_TOOL_PROVIDERS: [AiProvider; 2] = [AiProvider::ClaudeCode, AiProvider::CodexCli];

#[test]
fn chat_duplex_process_bulk_covers_queued_and_later_requests_but_not_next_attempt() {
    let bulk: ChatPermissionDecision = serde_json::from_str("\"approveAll\"").unwrap();
    for provider in NAMED_TOOL_PROVIDERS {
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
fn chat_duplex_process_bulk_is_refused_when_the_provider_does_not_name_the_tool() {
    // Copilot permission requests carry only a display title, which cannot
    // scope "Approve all" to one tool, so only one-time decisions are taken.
    let fixture = Fixture::new(AiProvider::CopilotCli);
    let mut prompts = 0;
    let result = fixture.run("deny", "number", |_| {}, |status| {
        if let Some(pending) = status.pending_permission {
            prompts += 1;
            assert_eq!(pending.tool_name, None);
            let bulk = fixture.jobs.decide_chat_permission(ChatPermissionDecisionRequest {
                job_id: status.job_id.clone(), session_id: status.session_id.clone(),
                request_id: pending.request_id.clone(), provider: pending.provider,
                decision: ChatPermissionDecision::ApproveAll,
            });
            assert!(bulk.is_err(), "unnamed tools must not be bulk approved");
            fixture.jobs.decide_chat_permission(ChatPermissionDecisionRequest {
                job_id: status.job_id, session_id: status.session_id,
                request_id: pending.request_id, provider: pending.provider,
                decision: ChatPermissionDecision::Deny,
            }).unwrap();
        }
    }).unwrap();
    assert!(result.success());
    assert!(prompts >= 1);
}

#[test]
fn chat_duplex_process_bulk_cancel_or_delete_before_next_prompt_revokes_queued_authority() {
    for provider in NAMED_TOOL_PROVIDERS {
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
