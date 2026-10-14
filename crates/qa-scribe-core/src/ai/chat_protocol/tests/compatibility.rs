use super::*;

#[test]
fn chat_duplex_codex_rejects_unsupported_elicitation_modes_and_kinds() {
    for (field, value) in [
        ("mode", json!("url")),
        ("mode", Value::Null),
        ("_meta", json!({"codex_approval_kind":"other"})),
    ] {
        let mut p = ready(AiProvider::CodexCli);
        let mut request = codex_request(json!(1));
        request["params"]["request"][field] = value;
        assert!(p.handle(&request).is_err());
        assert!(p.permission_reply(true).is_err());
        assert!(p.finish().is_err());
    }
}

#[test]
fn chat_duplex_codex_optional_empty_schema_nullable_turn_and_resolution() {
    let mut p = ready(AiProvider::CodexCli);
    let mut request = codex_request(json!("native"));
    request["params"]["request"]["requestedSchema"] = json!({"type":"object"});
    request["params"]["turnId"] = Value::Null;
    permission(&p.handle(&request).unwrap());
    assert!(
        p.handle(&json!({"method":"serverRequest/resolved","params":{
        "threadId":"thread-1","requestId":"native"}}))
            .is_err()
    );
    assert!(p.permission_reply(true).is_err());
    assert!(p.finish().is_err());
    let mut p = ready(AiProvider::CodexCli);
    permission(&p.handle(&request).unwrap());
    p.permission_reply(false).unwrap();
    assert!(
        p.handle(&json!({"method":"serverRequest/resolved","params":{
        "threadId":"thread-1","requestId":"native"}}))
            .unwrap()
            .is_empty()
    );
}

#[test]
fn chat_duplex_codex_foreign_threads_and_turns_fail_visibly() {
    for (key, value) in [("threadId", "foreign-thread"), ("turnId", "foreign-turn")] {
        let mut p = ready(AiProvider::CodexCli);
        let mut request = codex_request(json!(23));
        request["params"][key] = json!(value);
        assert!(p.handle(&request).is_err());
        assert!(p.permission_reply(true).is_err());
        assert!(p.finish().is_err());
    }
    let mut p = ready(AiProvider::CodexCli);
    assert!(
        p.handle(&json!({"method":"item/agentMessage/delta","params":{
        "threadId":"foreign-thread","turnId":"turn-1","delta":"foreign text"}}))
            .is_err()
    );
}

#[test]
fn chat_duplex_unknown_server_requests_and_user_questions_fail_visibly() {
    for (provider, request) in [
        (
            AiProvider::ClaudeCode,
            json!({"type":"control_request","request_id":33,"request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion","input":{"questions":[]}}}),
        ),
        (
            AiProvider::CodexCli,
            json!({"id":33,"method":"item/tool/requestUserInput","params":{"threadId":"thread-1","turnId":"turn-1","questions":[]}}),
        ),
        (
            AiProvider::CopilotCli,
            json!({"id":33,"method":"authenticate","params":{"methodId":"auth"}}),
        ),
    ] {
        let mut p = ready(provider);
        assert!(p.handle(&request).is_err());
        assert!(p.permission_reply(true).is_err());
        assert!(p.finish().is_err());
    }
}

#[test]
fn chat_duplex_copilot_terminal_snapshot_and_stop_failures() {
    let mut p = ready(AiProvider::CopilotCli);
    p.handle(&json!({"method":"session/update","params":{"sessionId":"session-1",
        "update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"final answer"}}}})).unwrap();
    let events = p
        .handle(&json!({"id":"qa-scribe-prompt","result":{"stopReason":"end_turn"}}))
        .unwrap();
    assert!(events.iter().any(|e| matches!(e, ChatProtocolEvent::Update(StreamUpdate::PartialSnapshot(text)) if text == "final answer")));
    assert!(
        events
            .iter()
            .any(|e| matches!(e, ChatProtocolEvent::Complete))
    );
    assert_eq!(p.finish().unwrap(), "final answer");
    for reason in ["cancelled", "refusal", "max_tokens", "unknown"] {
        let mut p = ready(AiProvider::CopilotCli);
        assert!(
            p.handle(&json!({"id":"qa-scribe-prompt","result":{"stopReason":reason}}))
                .is_err()
        );
        assert!(p.finish().is_err());
    }
}

#[test]
fn chat_duplex_codex_installed_0162_flattened_native_mcp_permission() {
    let mut p = ready(AiProvider::CodexCli);
    // Exact flattened params contract from manager's installed 0.162.1 F1 capture.
    let events = p
        .handle(
            &json!({"id":"live-native-id","method":"mcpServer/elicitation/request","params":{
        "threadId":"thread-1","turnId":"turn-1","serverName":"local","mode":"form",
        "_meta":{"codex_approval_kind":"mcp_tool_call","tool_params":{}},
        "message":"Allow local.write?","requestedSchema":{"type":"object","properties":{}}}}),
        )
        .unwrap();
    let detail = permission(&events);
    assert_eq!(detail.title, "Allow local.write?");
    assert_eq!(detail.tool_name, None);
    assert_eq!(detail.server_name.as_deref(), Some("local"));
    assert_eq!(detail.input_json.as_deref(), Some("{}"));
    assert_eq!(
        p.permission_reply(true).unwrap(),
        json!({"id":"live-native-id","result":{"action":"accept","content":{}}})
    );
}

#[test]
fn chat_duplex_copilot_available_commands_before_session_new_response() {
    let mut p = protocol(AiProvider::CopilotCli);
    let initial = p.initial_message();
    let requests = sent(
        &p.handle(&json!({"id":initial["id"],"result":{"protocolVersion":1}}))
            .unwrap(),
    );
    assert_eq!(requests[0]["method"], "session/new");
    let events = p.handle(&json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"session-1",
        "update":{"sessionUpdate":"available_commands_update","availableCommands":[{"name":"help","description":"Show help"}]}}})).unwrap();
    assert!(!events.iter().any(|e| matches!(
        e,
        ChatProtocolEvent::Permission(_)
            | ChatProtocolEvent::Complete
            | ChatProtocolEvent::Update(
                StreamUpdate::PartialDelta(_) | StreamUpdate::PartialSnapshot(_)
            )
    )));
    assert!(p.permission_reply(true).is_err());
    let requests = sent(
        &p.handle(&json!({"id":requests[0]["id"],"result":{"sessionId":"session-1"}}))
            .unwrap(),
    );
    assert_eq!(requests[0]["method"], "session/prompt");
    assert_eq!(requests[0]["params"]["sessionId"], "session-1");
}

#[test]
fn chat_duplex_claude_message_start_resets_previous_streamed_snapshot() {
    let mut p = ready(AiProvider::ClaudeCode);
    p.handle(&json!({"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"preamble"}}})).unwrap();
    p.handle(
        &json!({"type":"assistant","message":{"content":[{"type":"text","text":"preamble"}]}}),
    )
    .unwrap();
    let events = p.handle(&json!({"type":"stream_event","event":{"type":"message_start","message":{"model":"reported-model","content":[]}}})).unwrap();
    assert!(events.iter().any(|e| matches!(e, ChatProtocolEvent::Update(StreamUpdate::PartialSnapshot(text)) if text.is_empty())));
    let events = p.handle(&json!({"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"final answer"}}})).unwrap();
    assert!(events.iter().any(|e| matches!(e, ChatProtocolEvent::Update(StreamUpdate::PartialDelta(text)) if text == "final answer")));
    assert_eq!(
        p.text, "final answer",
        "new message must not append to the earlier preamble"
    );
}
