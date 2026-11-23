#[test]
fn batch_covers_only_reviewed_pending_requests_and_later_requests_still_ask() {
    for provider in [AiProvider::ClaudeCode, AiProvider::CodexCli] {
        let fixture = Fixture::new(provider);
        let mut decided = 0;
        let result = fixture.run("bulk", "string", |_| {}, |status| {
            let Some(pending) = status.pending_permission else { return };
            if decided == 0 && status.queued_permissions.len() != 2 { return; }
            let batch = decided == 0;
            fixture.jobs.decide_chat_permission(ChatPermissionDecisionRequest {
                job_id: status.job_id,
                session_id: status.session_id,
                request_id: pending.request_id,
                provider,
                decision: if batch { ChatPermissionDecision::ApproveBatch } else { ChatPermissionDecision::Approve },
                additional_request_ids: status.queued_permissions.into_iter().map(|request| request.request_id).collect(),
            }).unwrap();
            decided += 1;
        }).unwrap();
        assert!(result.success(), "{provider:?}: {}", result.failure_message());
        assert_eq!(decided, 2);
        assert_eq!(fs::read_to_string(fixture.dir.join("tool-marker")).unwrap().lines().count(), 4);
    }
}
