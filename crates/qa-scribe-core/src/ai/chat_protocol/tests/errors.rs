use super::*;

#[test]
fn chat_duplex_error_categories_preserve_readable_details_and_sticky_failure() {
    for (provider, frame, expected) in [
        (
            AiProvider::ClaudeCode,
            json!({}),
            "Protocol missing or invalid type",
        ),
        (
            AiProvider::CodexCli,
            json!({}),
            "Invalid Codex protocol message",
        ),
        (
            AiProvider::CopilotCli,
            json!({}),
            "Invalid Copilot protocol message",
        ),
    ] {
        let mut p = ready(provider);
        let error = p.handle(&frame).unwrap_err();
        assert_eq!(error.kind(), ProtocolErrorKind::InvalidFrame);
        assert_eq!(error.to_string(), expected);
        assert_eq!(p.finish().unwrap_err(), error);
        assert_eq!(p.permission_reply(false).unwrap_err(), error);
        assert_eq!(p.handle(&json!({})).unwrap_err(), error);
    }
}

#[test]
fn chat_duplex_unsupported_request_categories_are_selected_by_adapters() {
    for (provider, frame, expected) in [
        (
            AiProvider::ClaudeCode,
            json!({"type":"control_request","request_id":"opaque","request":{"subtype":"unknown"}}),
            "Unsupported Claude permission/control request: {\"subtype\":\"unknown\"}",
        ),
        (
            AiProvider::CodexCli,
            json!({"id":"opaque","method":"item/commandExecution/requestApproval","params":{}}),
            "Unsupported Codex permission/server request: item/commandExecution/requestApproval",
        ),
        (
            AiProvider::CopilotCli,
            json!({"id":"opaque","method":"unknown/request","params":{}}),
            "Unsupported Copilot permission/server request: unknown/request",
        ),
    ] {
        let mut p = ready(provider);
        let error = p.handle(&frame).unwrap_err();
        assert_eq!(error.kind(), ProtocolErrorKind::UnsupportedRequest);
        assert_eq!(error.to_string(), expected);
        assert_eq!(p.finish().unwrap_err(), error);
    }
}

#[test]
fn chat_duplex_provider_failure_categories_preserve_original_diagnostics() {
    for (provider, frame, expected) in [
        (
            AiProvider::ClaudeCode,
            json!({"type":"error","message":"synthetic failure"}),
            "Claude protocol error: {\"message\":\"synthetic failure\",\"type\":\"error\"}",
        ),
        (
            AiProvider::CodexCli,
            json!({"id":"qa-scribe-turn","error":{"message":"synthetic failure"}}),
            "Codex request failed: {\"message\":\"synthetic failure\"}",
        ),
        (
            AiProvider::CopilotCli,
            json!({"id":"qa-scribe-prompt","error":{"message":"synthetic failure"}}),
            "Copilot request failed: {\"message\":\"synthetic failure\"}",
        ),
    ] {
        let mut p = ready(provider);
        let error = p.handle(&frame).unwrap_err();
        assert_eq!(error.kind(), ProtocolErrorKind::ProviderFailure);
        assert_eq!(error.to_string(), expected);
        assert_eq!(p.finish().unwrap_err(), error);
    }
}

#[test]
fn chat_duplex_finish_categorizes_missing_terminal_and_empty_completion() {
    for provider in [
        AiProvider::ClaudeCode,
        AiProvider::CodexCli,
        AiProvider::CopilotCli,
    ] {
        let p = ready(provider);
        let error = p.finish().unwrap_err();
        assert_eq!(error.kind(), ProtocolErrorKind::IncompleteStream);
        assert_eq!(
            error.to_string(),
            "Chat protocol ended without successful completion"
        );
    }
    let mut p = ready(AiProvider::CopilotCli);
    p.handle(&json!({"id":"qa-scribe-prompt","result":{"stopReason":"end_turn"}}))
        .unwrap();
    let error = p.finish().unwrap_err();
    assert_eq!(error.kind(), ProtocolErrorKind::IncompleteStream);
    assert_eq!(error.to_string(), "Provider returned no assistant text");
}

#[test]
fn chat_duplex_invalid_local_approval_keeps_denial_authority_and_completion() {
    let mut p = ready(AiProvider::CopilotCli);
    let mut request = copilot_request(json!("opaque-reject-only"));
    request["params"]["options"] =
        json!([{"optionId":"opaque-reject","name":"No","kind":"reject_once"}]);
    p.handle(&request).unwrap();
    let error = p.permission_reply(true).unwrap_err();
    assert_eq!(error.kind(), ProtocolErrorKind::InvalidFrame);
    assert_eq!(
        error.to_string(),
        "Permission decision has no offered once-only option"
    );
    assert_eq!(
        p.permission_reply(false).unwrap(),
        json!({"jsonrpc":"2.0","id":"opaque-reject-only","result":{"outcome":{"outcome":"selected","optionId":"opaque-reject"}}})
    );
    p.handle(&json!({"method":"session/update","params":{"sessionId":"session-1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Permission denied."}}}})).unwrap();
    p.handle(&json!({"id":"qa-scribe-prompt","result":{"stopReason":"end_turn"}}))
        .unwrap();
    assert_eq!(p.finish().unwrap(), "Permission denied.");
}
