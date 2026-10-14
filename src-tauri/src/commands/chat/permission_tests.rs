use qa_scribe_core::domain::AiProvider;

use super::apply_chat_permission_decision;
use crate::{
    commands::error::CommandErrorKind,
    jobs::{
        ChatPermissionDecision, ChatPermissionDecisionRequest, ChatPermissionDetails, JobStore,
    },
};

fn pending_decision(
    jobs: &JobStore,
) -> (
    ChatPermissionDecisionRequest,
    std::sync::mpsc::Receiver<ChatPermissionDecision>,
) {
    jobs.insert_generation_job("job".into(), "session".into(), "chat".into())
        .expect("insert Chat job");
    jobs.mark_running("job", "run".into(), "Ready")
        .expect("start Chat job");
    let (status, receiver) = jobs
        .publish_chat_permission(
            "job",
            ChatPermissionDetails {
                provider: AiProvider::ClaudeCode,
                title: "Read a file".into(),
                tool_name: Some("read_file".into()),
                server_name: None,
                input_json: Some(r#"{"path":"README.md"}"#.into()),
            },
        )
        .expect("publish permission");
    let pending = status.pending_permission.expect("pending permission");
    let request = ChatPermissionDecisionRequest {
        job_id: status.job_id,
        session_id: status.session_id,
        request_id: pending.request_id,
        provider: pending.provider,
        decision: ChatPermissionDecision::Approve,
    };
    (request, receiver)
}

#[test]
fn stale_chat_permission_decision_serializes_as_validation_error() {
    let jobs = JobStore::default();
    let (request, _receiver) = pending_decision(&jobs);
    jobs.cancel("job").expect("cancel job");
    jobs.mark_cancelled("job").expect("retire job");

    let error = apply_chat_permission_decision(&jobs, request)
        .expect_err("stale permission must reject at the command boundary");

    assert_eq!(error.kind, CommandErrorKind::Validation);
    let json = serde_json::to_value(&error).expect("serialize command rejection");
    assert_eq!(json["kind"], "validation");
    assert_eq!(json["message"], error.message);
    assert!(!error.message.is_empty());
}

#[test]
fn chat_permission_identity_mismatch_is_validation_not_internal() {
    for mismatch in ["session", "request", "provider"] {
        let jobs = JobStore::default();
        let (mut request, _receiver) = pending_decision(&jobs);
        match mismatch {
            "session" => request.session_id = "another-session".into(),
            "request" => request.request_id = "stale-request".into(),
            _ => request.provider = AiProvider::CodexCli,
        }

        let error = apply_chat_permission_decision(&jobs, request)
            .expect_err("identity mismatch must reject at the command boundary");

        assert_eq!(error.kind, CommandErrorKind::Validation, "{mismatch}");
        assert!(!error.message.is_empty(), "{mismatch}");
    }
}
