use super::*;

#[test]
fn chat_duplex_claude_opaque_ids_original_input_no_updated_permissions() {
    for id in [json!(42), json!("opaque:42")] {
        for approved in [false, true] {
            let mut p = ready(AiProvider::ClaudeCode);
            let request = claude_request(id.clone());
            let events = p.handle(&request).unwrap();
            assert_eq!(
                permission(&events).tool_name.as_deref(),
                Some("mcp__local__write")
            );
            let reply = p.permission_reply(approved).unwrap();
            assert_eq!(reply["response"]["request_id"], id);
            let response = &reply["response"]["response"];
            assert_eq!(
                response["behavior"],
                if approved { "allow" } else { "deny" }
            );
            if approved {
                assert_eq!(response["updatedInput"], request["request"]["input"]);
            }
            assert!(response.get("updatedPermissions").is_none());
            assert!(p.permission_reply(approved).is_err());
        }
    }
}

#[test]
fn chat_duplex_codex_mcp_opaque_ids_exact_form_reply_and_identity() {
    for id in [json!(71), json!("opaque:71")] {
        for approved in [false, true] {
            let mut p = ready(AiProvider::CodexCli);
            let events = p.handle(&codex_request(id.clone())).unwrap();
            let detail = permission(&events);
            assert_eq!(detail.title, "Allow local.write?");
            assert_eq!(detail.tool_name, None);
            assert_eq!(detail.server_name.as_deref(), Some("local"));
            assert_eq!(
                serde_json::from_str::<Value>(detail.input_json.as_ref().unwrap()).unwrap(),
                json!({"path":"/tmp/a"})
            );
            let reply = p.permission_reply(approved).unwrap();
            assert_eq!(reply["id"], id);
            assert_eq!(
                reply["result"],
                json!({"action":if approved {"accept"} else {"decline"},"content":{}})
            );
            assert!(p.permission_reply(approved).is_err());
        }
    }
}

#[test]
fn chat_duplex_copilot_opaque_ids_actual_option_ids() {
    for id in [json!(99), json!("opaque:99")] {
        for approved in [false, true] {
            let mut p = ready(AiProvider::CopilotCli);
            let events = p.handle(&copilot_request(id.clone())).unwrap();
            assert_eq!(permission(&events).title, "Write /tmp/a");
            let reply = p.permission_reply(approved).unwrap();
            assert_eq!(reply["id"], id);
            assert_eq!(
                reply["result"]["outcome"],
                json!({"outcome":"selected","optionId":if approved {"opaque-allow"} else {"opaque-reject"}})
            );
            assert!(p.permission_reply(approved).is_err());
        }
    }
}

#[test]
fn chat_duplex_codex_rejects_nonempty_or_unknown_elicitation_schema() {
    for schema in [
        json!({"type":"object","properties":{"password":{"type":"string"}}}),
        json!({}),
        json!({"type":"array"}),
        json!({"type":"object","properties":{},"required":["password"]}),
    ] {
        let mut p = ready(AiProvider::CodexCli);
        let mut request = codex_request(json!(1));
        request["params"]["request"]["requestedSchema"] = schema;
        assert!(p.handle(&request).is_err());
        assert!(p.permission_reply(true).is_err());
        assert!(p.finish().is_err());
    }
}

#[test]
fn chat_duplex_copilot_rejects_malformed_options_and_wrong_session() {
    for options in [
        json!([]),
        json!([{"kind":"allow_once"}]),
        json!([{"optionId":"a","kind":"allow_always"}]),
        json!([{"optionId":"a","kind":"unknown"}]),
    ] {
        let mut p = ready(AiProvider::CopilotCli);
        let mut request = copilot_request(json!(1));
        request["params"]["options"] = options;
        assert!(p.handle(&request).is_err());
        assert!(p.permission_reply(true).is_err());
    }
    let mut p = ready(AiProvider::CopilotCli);
    let mut request = copilot_request(json!(2));
    request["params"]["sessionId"] = json!("other-session");
    assert!(p.handle(&request).is_err());
    assert!(p.permission_reply(true).is_err());
}

#[test]
fn chat_duplex_copilot_only_selects_available_once_options() {
    for (kind, approved, option_id) in [
        ("allow_once", true, "custom-a"),
        ("reject_once", false, "custom-r"),
    ] {
        let mut p = ready(AiProvider::CopilotCli);
        let mut request = copilot_request(json!(10));
        request["params"]["options"] = json!([{"kind":kind,"optionId":option_id,"name":"Once"}]);
        permission(&p.handle(&request).unwrap());
        assert_eq!(
            p.permission_reply(approved).unwrap()["result"]["outcome"]["optionId"],
            option_id
        );
        let mut p = ready(AiProvider::CopilotCli);
        permission(&p.handle(&request).unwrap());
        assert!(p.permission_reply(!approved).is_err());
    }
}

#[test]
fn chat_duplex_copilot_partial_permission_uses_trusted_tool_call_metadata() {
    let mut p = ready(AiProvider::CopilotCli);
    p.handle(&json!({"jsonrpc":"2.0","method":"session/update","params":{
        "sessionId":"session-1","update":{"sessionUpdate":"tool_call",
            "toolCallId":"call1","title":"ReadMarker","rawInput":{}}}}))
        .unwrap();
    let events = p
        .handle(&json!({"jsonrpc":"2.0","id":"opaque-permission:call1",
        "method":"session/request_permission","params":{"sessionId":"session-1",
            "toolCall":{"toolCallId":"call1"},"options":[
                {"optionId":"opaque-once-allow","name":"Allow once","kind":"allow_once"},
                {"optionId":"opaque-once-reject","name":"Reject once","kind":"reject_once"}]}}))
        .unwrap();
    let detail = permission(&events);
    assert_eq!(detail.title, "ReadMarker");
    assert_eq!(detail.input_json.as_deref(), Some("{}"));
    assert_eq!(
        p.permission_reply(true).unwrap(),
        json!({"jsonrpc":"2.0",
        "id":"opaque-permission:call1","result":{"outcome":{
            "outcome":"selected","optionId":"opaque-once-allow"}}})
    );
    assert!(p.permission_reply(true).is_err());
}
