mod replay;
use super::*;
use crate::ai::{GenerationOutputFormat, chat::duplex_chat_command};
use serde_json::json;

mod compatibility;
mod handshake;
mod lifecycle;
mod permissions;

fn protocol(provider: AiProvider) -> ChatProtocol {
    ChatProtocol::new(
        provider,
        "private prompt",
        "chosen-model",
        Some("high"),
        "/work",
    )
}

fn sent(events: &[ChatProtocolEvent]) -> Vec<Value> {
    events
        .iter()
        .filter_map(|event| match event {
            ChatProtocolEvent::Send(value) => Some(value.clone()),
            _ => None,
        })
        .collect()
}

fn permission(events: &[ChatProtocolEvent]) -> &ChatProtocolPermission {
    events
        .iter()
        .find_map(|event| match event {
            ChatProtocolEvent::Permission(value) => Some(value),
            _ => None,
        })
        .expect("provider must request an explicit permission decision")
}

fn ready(provider: AiProvider) -> ChatProtocol {
    let mut p = protocol(provider);
    let initial = p.initial_message();
    assert!(!initial.is_null(), "initial message must be a wire request");
    match provider {
        AiProvider::ClaudeCode => {
            let events = p
                .handle(&json!({"type":"control_response","response":{
                "subtype":"success","request_id":initial["request_id"],"response":{}}}))
                .unwrap();
            let messages = sent(&events);
            assert_eq!(messages.len(), 1);
            assert_eq!(messages[0]["type"], "user");
            assert_eq!(messages[0]["message"]["content"], "private prompt");
        }
        AiProvider::CodexCli => {
            let events = p.handle(&json!({"id":initial["id"],"result":{}})).unwrap();
            let messages = sent(&events);
            assert_eq!(messages.len(), 2);
            assert_eq!(messages[0]["method"], "initialized");
            assert_eq!(messages[1]["method"], "thread/start");
            assert_eq!(messages[1]["params"]["ephemeral"], true);
            assert_eq!(messages[1]["params"]["cwd"], "/work");
            assert_eq!(messages[1]["params"]["model"], "chosen-model");
            for key in ["approvalPolicy", "sandbox", "sandboxPolicy"] {
                assert!(messages[1]["params"].get(key).is_none());
            }
            let events = p
                .handle(&json!({"id":messages[1]["id"],"result":{
                "thread":{"id":"thread-1"},"model":"reported-model"}}))
                .unwrap();
            let turn = sent(&events);
            assert_eq!(turn.len(), 1);
            assert_eq!(turn[0]["method"], "turn/start");
            assert_eq!(turn[0]["params"]["threadId"], "thread-1");
            assert_eq!(turn[0]["params"]["model"], "chosen-model");
            assert_eq!(turn[0]["params"]["effort"], "high");
            assert_eq!(turn[0]["params"]["input"][0]["text"], "private prompt");
            for key in ["approvalPolicy", "sandbox", "sandboxPolicy"] {
                assert!(turn[0]["params"].get(key).is_none());
            }
            p.handle(&json!({"id":turn[0]["id"],"result":{"turn":{"id":"turn-1","status":"inProgress"}}})).unwrap();
        }
        AiProvider::CopilotCli => {
            let events = p
                .handle(&json!({"jsonrpc":"2.0","id":initial["id"],"result":{"protocolVersion":1}}))
                .unwrap();
            let messages = sent(&events);
            assert_eq!(messages.len(), 1);
            assert_eq!(messages[0]["method"], "session/new");
            assert_eq!(
                messages[0]["params"],
                json!({"cwd":"/work","mcpServers":[]})
            );
            let events = p.handle(&json!({"jsonrpc":"2.0","id":messages[0]["id"],"result":{"sessionId":"session-1"}})).unwrap();
            let messages = sent(&events);
            assert_eq!(messages.len(), 1);
            assert_eq!(messages[0]["method"], "session/prompt");
            assert_eq!(messages[0]["params"]["sessionId"], "session-1");
            assert_eq!(
                messages[0]["params"]["prompt"][0],
                json!({"type":"text","text":"private prompt"})
            );
        }
    }
    p
}

fn claude_request(id: Value) -> Value {
    json!({"type":"control_request","request_id":id,"request":{
        "subtype":"can_use_tool","tool_name":"mcp__local__write",
        "input":{"path":"/tmp/a","nested":{"raw":true}}}})
}

fn codex_request(id: Value) -> Value {
    json!({"id":id,"method":"mcpServer/elicitation/request","params":{
        "threadId":"thread-1","turnId":"turn-1","serverName":"local",
        "request":{"mode":"form","message":"Allow local.write?",
            "requestedSchema":{"type":"object","properties":{}},
            "_meta":{"codex_approval_kind":"mcp_tool_call","tool_params":{"path":"/tmp/a"}}}}})
}

fn copilot_request(id: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"method":"session/request_permission","params":{
        "sessionId":"session-1","toolCall":{"toolCallId":"call-1","title":"Write /tmp/a","rawInput":{"path":"/tmp/a"}},
        "options":[{"optionId":"opaque-allow","name":"Once","kind":"allow_once"},
                   {"optionId":"opaque-reject","name":"No","kind":"reject_once"}]}})
}
