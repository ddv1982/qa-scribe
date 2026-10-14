use std::{
    sync::{
        Arc, Barrier,
        mpsc::{Receiver, TryRecvError},
    },
    thread,
};

use qa_scribe_core::domain::AiProvider;

use super::{
    ChatPermissionDecision, ChatPermissionDecisionRequest, ChatPermissionDetails,
    GenerationJobState, GenerationJobStatus, JobControl, JobStore,
};

fn details() -> ChatPermissionDetails {
    ChatPermissionDetails {
        provider: AiProvider::ClaudeCode,
        title: "Read a file".into(),
        tool_name: Some("read_file".into()),
        server_name: Some("local".into()),
        input_json: Some(r#"{"path":"README.md"}"#.into()),
    }
}

fn insert(store: &JobStore, action: &str, running: bool) -> JobControl {
    let (_, control) = store
        .insert_generation_job("job".into(), "session".into(), action.into())
        .expect("job inserts");
    if running {
        store.mark_running("job", "run".into(), "Ready").unwrap();
    }
    control
}

fn publish(store: &JobStore) -> (GenerationJobStatus, Receiver<ChatPermissionDecision>) {
    store
        .publish_chat_permission("job", details())
        .expect("running chat requests permission")
}

fn decision(status: &GenerationJobStatus) -> ChatPermissionDecisionRequest {
    let pending = status.pending_permission.as_ref().expect("pending request");
    ChatPermissionDecisionRequest {
        job_id: status.job_id.clone(),
        session_id: status.session_id.clone(),
        request_id: pending.request_id.clone(),
        provider: pending.provider,
        decision: ChatPermissionDecision::Approve,
    }
}

fn assert_cleared(store: &JobStore, receiver: &Receiver<ChatPermissionDecision>) {
    assert!(store.status("job").unwrap().pending_permission.is_none());
    assert_eq!(receiver.try_recv(), Err(TryRecvError::Disconnected));
}

#[test]
fn chat_permission_publish_exposes_metadata_and_opaque_uuid() {
    let store = JobStore::default();
    insert(&store, "chat", true);
    let (status, receiver) = publish(&store);
    assert_eq!(status.state, GenerationJobState::Running);
    let pending = status.pending_permission.as_ref().unwrap();
    assert!(uuid::Uuid::parse_str(&pending.request_id).is_ok());
    assert_eq!(pending.provider, details().provider);
    assert_eq!(pending.title, details().title);
    assert_eq!(pending.tool_name, details().tool_name);
    assert_eq!(pending.server_name, details().server_name);
    assert_eq!(pending.input_json, details().input_json);
    assert_eq!(store.status("job").unwrap(), status);
    assert_eq!(store.active_jobs().unwrap(), vec![status.clone()]);
    assert_eq!(receiver.try_recv(), Err(TryRecvError::Empty));
    let json = serde_json::to_value(status).unwrap();
    assert_eq!(json["pendingPermission"]["toolName"], "read_file");
    assert!(json["pendingPermission"]["requestId"].is_string());
}

#[test]
fn chat_permission_absent_payload_and_decision_wire_contract() {
    let store = JobStore::default();
    insert(&store, "chat", false);
    let json = serde_json::to_value(store.status("job").unwrap()).unwrap();
    assert!(json.get("pendingPermission").is_none());
    assert_eq!(
        serde_json::to_value(ChatPermissionDecision::Approve).unwrap(),
        "approve"
    );
    assert_eq!(
        serde_json::to_value(ChatPermissionDecision::Deny).unwrap(),
        "deny"
    );
    let request: ChatPermissionDecisionRequest = serde_json::from_value(serde_json::json!({
        "jobId": "job", "sessionId": "session", "requestId": "token",
        "provider": "claude_code", "decision": "deny"
    }))
    .unwrap();
    assert_eq!(request.decision, ChatPermissionDecision::Deny);
    assert_eq!(request.session_id, "session");
}

#[test]
fn chat_permission_approve_and_deny_delivered_once_with_unique_tokens() {
    let store = JobStore::default();
    insert(&store, "chat", true);
    let (first, receiver) = publish(&store);
    let request = decision(&first);
    let decided = store
        .decide_chat_permission(request.clone())
        .expect("approve");
    assert!(decided.pending_permission.is_none());
    assert_eq!(receiver.try_recv(), Ok(ChatPermissionDecision::Approve));
    assert_eq!(receiver.try_recv(), Err(TryRecvError::Disconnected));
    assert!(store.decide_chat_permission(request.clone()).is_err());
    let (second, receiver) = publish(&store);
    let mut deny = decision(&second);
    assert_ne!(request.request_id, deny.request_id);
    assert!(store.decide_chat_permission(request).is_err());
    assert_eq!(store.status("job").unwrap(), second);
    deny.decision = ChatPermissionDecision::Deny;
    store.decide_chat_permission(deny).expect("deny");
    assert_eq!(receiver.try_recv(), Ok(ChatPermissionDecision::Deny));
    assert_eq!(receiver.try_recv(), Err(TryRecvError::Disconnected));
}

#[test]
fn chat_permission_forged_identity_does_not_consume_pending_request() {
    let store = JobStore::default();
    insert(&store, "chat", true);
    let (status, receiver) = publish(&store);
    let legitimate = decision(&status);
    for field in ["job", "session", "token", "provider"] {
        let mut forged = legitimate.clone();
        match field {
            "job" => forged.job_id = "other-job".into(),
            "session" => forged.session_id = "other-session".into(),
            "token" => forged.request_id = uuid::Uuid::new_v4().to_string(),
            _ => forged.provider = AiProvider::CodexCli,
        }
        assert!(store.decide_chat_permission(forged).is_err(), "{field}");
        assert_eq!(store.status("job").unwrap(), status);
        assert_eq!(receiver.try_recv(), Err(TryRecvError::Empty));
    }
    assert!(store.publish_chat_permission("job", details()).is_err());
    assert_eq!(store.status("job").unwrap(), status);
    store.decide_chat_permission(legitimate).unwrap();
    assert_eq!(receiver.try_recv(), Ok(ChatPermissionDecision::Approve));
}

#[test]
fn chat_permission_rejects_nonchat_starting_and_missing_jobs() {
    for (action, running) in [("chat", false), ("testware", true), ("summary", true)] {
        let store = JobStore::default();
        insert(&store, action, running);
        let before = store.status("job").unwrap();
        assert!(store.publish_chat_permission("job", details()).is_err());
        assert_eq!(store.status("job").unwrap(), before);
    }
    assert!(
        JobStore::default()
            .publish_chat_permission("missing", details())
            .is_err()
    );
}

#[test]
fn chat_permission_invalid_metadata_rejected_without_poisoning_next_request() {
    for field in [
        "empty-title",
        "blank-title",
        "title",
        "tool",
        "server",
        "input",
    ] {
        let store = JobStore::default();
        insert(&store, "chat", true);
        let mut invalid = details();
        let oversized = "x".repeat(1_000_000);
        match field {
            "empty-title" => invalid.title.clear(),
            "blank-title" => invalid.title = " \n\t".into(),
            "title" => invalid.title = oversized,
            "tool" => invalid.tool_name = Some(oversized),
            "server" => invalid.server_name = Some(oversized),
            _ => invalid.input_json = Some(format!("\"{oversized}\"")),
        }
        assert!(
            store.publish_chat_permission("job", invalid).is_err(),
            "{field}"
        );
        assert!(store.status("job").unwrap().pending_permission.is_none());
        let (_, receiver) = publish(&store);
        assert_eq!(receiver.try_recv(), Err(TryRecvError::Empty));
    }
}

#[test]
fn chat_permission_cancel_and_terminal_paths_disconnect_pending_receiver() {
    for ending in ["cancel", "complete", "fail", "delete"] {
        let store = JobStore::default();
        insert(&store, "chat", true);
        let (status, receiver) = publish(&store);
        match ending {
            "cancel" => {
                store.cancel("job").unwrap();
                assert_cleared(&store, &receiver);
                store.mark_cancelled("job").unwrap();
            }
            "complete" => {
                store.complete("job").unwrap();
            }
            "fail" => {
                store.fail("job", "provider failed").unwrap();
            }
            _ => {
                let deletion = store.begin_session_deletion("session").unwrap();
                deletion.cancel_jobs().unwrap();
            }
        }
        assert_cleared(&store, &receiver);
        assert!(store.decide_chat_permission(decision(&status)).is_err());
        assert!(store.publish_chat_permission("job", details()).is_err());
    }
}

#[test]
fn chat_permission_direct_control_cancel_rejects_publish_and_decision() {
    let store = JobStore::default();
    let control = insert(&store, "chat", true);
    let (status, receiver) = publish(&store);
    control.request_cancel().unwrap();
    assert!(store.decide_chat_permission(decision(&status)).is_err());
    assert_cleared(&store, &receiver);
    assert!(store.publish_chat_permission("job", details()).is_err());

    let store = JobStore::default();
    let control = insert(&store, "chat", true);
    control.request_cancel().unwrap();
    assert!(store.publish_chat_permission("job", details()).is_err());
}

#[test]
fn chat_permission_public_cancel_races_decision_without_leaking_pending() {
    let store = Arc::new(JobStore::default());
    insert(&store, "chat", true);
    let (status, receiver) = publish(&store);
    let request = decision(&status);
    let barrier = Arc::new(Barrier::new(2));
    let cancelling = {
        let store = Arc::clone(&store);
        let barrier = Arc::clone(&barrier);
        thread::spawn(move || {
            barrier.wait();
            store.cancel("job").expect("public cancel accepted")
        })
    };
    barrier.wait();
    let result = store.decide_chat_permission(request);
    assert_eq!(
        cancelling.join().unwrap().state,
        GenerationJobState::Cancelling
    );
    if result.is_ok() {
        assert_eq!(receiver.try_recv(), Ok(ChatPermissionDecision::Approve));
    }
    assert_cleared(&store, &receiver);
}
