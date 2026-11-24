use super::*;
use crate::jobs::ChatLogQueryApproval;
use qa_scribe_core::domain::ApplicationLogSource;

#[test]
fn provider_permission_waits_behind_an_active_log_approval() {
    let fixture = Fixture::new(AiProvider::CodexCli);
    let (log, reply) = fixture
        .jobs
        .try_publish_chat_permission(
            "job",
            ChatPermissionDetails {
                can_approve: true,
                provider: fixture.provider,
                title: "Query logs".into(),
                tool_name: None,
                server_name: None,
                input_json: None,
                log_query: Some(ChatLogQueryApproval {
                    target: ApplicationLogSource {
                        label: "Acceptance".into(),
                        resource_id: "fixture".into(),
                    },
                    kql: "print test".into(),
                    start: "start".into(),
                    end: "end".into(),
                }),
            },
        )
        .unwrap()
        .unwrap();

    thread::scope(|scope| {
        let path = fixture.dir.join("wire.jsonl");
        let fixture = &fixture;
        scope.spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(2);
            while !fs::read_to_string(&path)
                .unwrap_or_default()
                .contains("overlap_permission_sent")
            {
                assert!(Instant::now() < deadline);
                thread::sleep(Duration::from_millis(5));
            }
            // Keep the slot occupied after the peer's permission request is on the pipe.
            thread::sleep(Duration::from_millis(60));
            let request = log.pending_permission.as_ref().unwrap();
            fixture
                .jobs
                .decide_chat_permission(ChatPermissionDecisionRequest {
                    job_id: log.job_id.clone(),
                    session_id: log.session_id.clone(),
                    request_id: request.request_id.clone(),
                    provider: fixture.provider,
                    decision: ChatPermissionDecision::Deny,
                    additional_request_ids: vec![],
                })
                .unwrap();
        });
        let result = fixture
            .run(
                "log_overlap",
                "string",
                |_| {},
                |status| {
                    if status
                        .pending_permission
                        .as_ref()
                        .is_some_and(|request| request.log_query.is_none())
                    {
                        fixture.decide(status, ChatPermissionDecision::Approve);
                    }
                },
            )
            .unwrap();
        assert!(result.success(), "{}", result.failure_message());
    });
    assert_eq!(
        reply.try_recv().unwrap().decision,
        ChatPermissionDecision::Deny
    );
    assert!(
        fixture
            .records()
            .iter()
            .any(|record| record["verified_reply"] == true && record["approved"] == true)
    );
}
