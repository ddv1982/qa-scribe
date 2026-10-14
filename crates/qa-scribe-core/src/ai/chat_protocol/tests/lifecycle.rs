use super::*;

#[test]
fn chat_duplex_pending_duplicate_and_stale_requests_fail_visibly() {
    for (provider, request) in [
        (AiProvider::ClaudeCode, claude_request(json!(8))),
        (AiProvider::CodexCli, codex_request(json!(8))),
        (AiProvider::CopilotCli, copilot_request(json!(8))),
    ] {
        let mut p = ready(provider);
        permission(&p.handle(&request).unwrap());
        assert!(p.handle(&request).is_err());
        let mut p = ready(provider);
        permission(&p.handle(&request).unwrap());
        p.permission_reply(false).unwrap();
        assert!(p.handle(&request).is_err());
    }
}

#[test]
fn chat_duplex_protocol_cancel_fails_visibly() {
    for (provider, request, cancel) in [
        (
            AiProvider::ClaudeCode,
            claude_request(json!(8)),
            json!({"type":"control_cancel_request","request_id":8}),
        ),
        (
            AiProvider::CodexCli,
            codex_request(json!(8)),
            json!({"method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":"interrupted"}}}),
        ),
        (
            AiProvider::CopilotCli,
            copilot_request(json!(8)),
            json!({"method":"session/cancel","params":{"sessionId":"session-1"}}),
        ),
    ] {
        let mut p = ready(provider);
        permission(&p.handle(&request).unwrap());
        assert!(p.handle(&cancel).is_err());
        assert!(p.permission_reply(true).is_err());
        assert!(p.finish().is_err());
    }
}

#[test]
fn chat_duplex_never_parses_assistant_prose_into_permission() {
    for (provider, event) in [
        (
            AiProvider::ClaudeCode,
            json!({"type":"assistant","message":{"content":[{"type":"text","text":"Please approve tool local.write"}]}}),
        ),
        (
            AiProvider::CodexCli,
            json!({"method":"item/agentMessage/delta","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"m1","delta":"Please approve tool local.write"}}),
        ),
        (
            AiProvider::CopilotCli,
            json!({"method":"session/update","params":{"sessionId":"session-1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Please approve tool local.write"}}}}),
        ),
    ] {
        let mut p = ready(provider);
        let events = p.handle(&event).unwrap();
        assert!(
            !events
                .iter()
                .any(|e| matches!(e, ChatProtocolEvent::Permission(_)))
        );
        assert!(p.permission_reply(true).is_err());
    }
}

#[test]
fn chat_duplex_claude_full_result_authoritative_and_errors_fail() {
    let mut p = ready(AiProvider::ClaudeCode);
    p.handle(&json!({"type":"assistant","message":{"model":"reported-model","content":[{"type":"text","text":"preamble"}]}})).unwrap();
    let events = p
        .handle(
            &json!({"type":"result","subtype":"success","is_error":false,"result":"final answer"}),
        )
        .unwrap();
    assert!(
        events
            .iter()
            .any(|e| matches!(e, ChatProtocolEvent::Complete))
    );
    assert_eq!(p.finish().unwrap(), "final answer");
    assert_eq!(p.reported_model().as_deref(), Some("reported-model"));
    for result in [
        json!({"type":"result","subtype":"success","is_error":true,"result":"bad"}),
        json!({"type":"result","subtype":"error_during_execution","is_error":false,"errors":["bad"]}),
    ] {
        let mut p = ready(AiProvider::ClaudeCode);
        assert!(p.handle(&result).is_err());
        assert!(p.finish().is_err());
    }
}

#[test]
fn chat_duplex_codex_final_message_replaces_preamble_and_failed_turn_errors() {
    let mut p = ready(AiProvider::CodexCli);
    p.handle(&json!({"method":"item/agentMessage/delta","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"m1","delta":"preamble"}})).unwrap();
    p.handle(&json!({"method":"item/completed","params":{"threadId":"thread-1","turnId":"turn-1","item":{"id":"m2","type":"agentMessage","text":"final answer"}}})).unwrap();
    let events = p.handle(&json!({"method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":"completed"}}})).unwrap();
    assert!(
        events
            .iter()
            .any(|e| matches!(e, ChatProtocolEvent::Complete))
    );
    assert_eq!(p.finish().unwrap(), "final answer");
    assert_eq!(p.reported_model().as_deref(), Some("reported-model"));
    for status in ["failed", "error"] {
        let mut p = ready(AiProvider::CodexCli);
        assert!(p.handle(&json!({"method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":status,"error":{"message":"bad"}}}})).is_err());
        assert!(p.finish().is_err());
    }
}

#[test]
fn chat_duplex_claude_initialize_requires_matching_success() {
    let mut p = protocol(AiProvider::ClaudeCode);
    let events = p.handle(&json!({"type":"control_response","response":{
        "subtype":"success","request_id":"unrelated","response":{}}}));
    assert!(events.is_err() || sent(&events.unwrap()).is_empty());
    assert!(p.finish().is_err());
    let mut p = protocol(AiProvider::ClaudeCode);
    assert!(
        p.handle(&json!({"type":"control_response","response":{
        "subtype":"error","request_id":"qa-scribe-init","error":"initialization denied"}}))
            .is_err()
    );
    assert!(p.finish().is_err());
}

#[test]
fn chat_duplex_copilot_updates_use_matching_session_and_tool_details() {
    let mut p = ready(AiProvider::CopilotCli);
    let events = p.handle(&json!({"method":"session/update","params":{"sessionId":"session-1",
        "update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"answer"}}}})).unwrap();
    assert!(events.iter().any(|e| matches!(e, ChatProtocolEvent::Update(StreamUpdate::PartialDelta(text)) if text == "answer")));
    let events = p.handle(&json!({"method":"session/update","params":{"sessionId":"session-1",
        "update":{"sessionUpdate":"tool_call","toolCallId":"t1","title":"Read local file","kind":"read","status":"pending"}}})).unwrap();
    assert!(events.iter().any(|e| matches!(e, ChatProtocolEvent::Update(StreamUpdate::Progress(text)) if text.contains("Read local file"))));
    assert!(
        !events
            .iter()
            .any(|e| matches!(e, ChatProtocolEvent::Permission(_)))
    );
    let mut p = ready(AiProvider::CopilotCli);
    assert!(p.handle(&json!({"method":"session/update","params":{"sessionId":"other-session",
        "update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"foreign text"}}}})).is_err());
    assert!(p.finish().is_err());
}

#[test]
fn chat_duplex_protocol_diagnostics_are_not_assistant_text() {
    for (provider, diagnostic) in [
        (
            AiProvider::ClaudeCode,
            json!({"type":"system","subtype":"init","model":"reported-model","tools":["Read"]}),
        ),
        (
            AiProvider::CodexCli,
            json!({"method":"item/started","params":{"threadId":"thread-1","turnId":"turn-1","item":{"id":"r1","type":"reasoning","summary":["internal instructions"]}}}),
        ),
        (
            AiProvider::CopilotCli,
            json!({"method":"session/update","params":{"sessionId":"session-1","update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"internal instructions"}}}}),
        ),
    ] {
        let mut p = ready(provider);
        let events = p.handle(&diagnostic).unwrap();
        assert!(!events.iter().any(|e| matches!(
            e,
            ChatProtocolEvent::Update(
                StreamUpdate::PartialDelta(_) | StreamUpdate::PartialSnapshot(_)
            ) | ChatProtocolEvent::Permission(_)
        )));
        assert!(p.finish().is_err());
    }
}
