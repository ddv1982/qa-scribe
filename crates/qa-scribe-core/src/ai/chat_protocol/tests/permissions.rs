use super::*;

fn queued_request(provider: AiProvider, id: Value, index: usize) -> Value {
    let input = json!({"path":format!("/tmp/queued-{index}"),"nested":{"index":index}});
    match provider {
        AiProvider::ClaudeCode => {
            let mut request = claude_request(id);
            request["request"]["input"] = input;
            request
        }
        AiProvider::CodexCli => {
            let mut request = codex_request(id);
            request["params"]["request"]["message"] = json!(format!("Allow write {index}?"));
            request["params"]["request"]["_meta"]["tool_params"] = input;
            request
        }
        AiProvider::CopilotCli => {
            let mut request = copilot_request(id);
            request["params"]["toolCall"] = json!({
                "toolCallId":format!("queued-call-{index}"),
                "title":format!("Write {index}"),"rawInput":input
            });
            request["params"]["options"] = json!([
                {"optionId":format!("allow-{index}"),"name":"Once","kind":"allow_once"},
                {"optionId":format!("deny-{index}"),"name":"No","kind":"reject_once"}
            ]);
            request
        }
    }
}

fn queued_reply(provider: AiProvider, request: &Value, approved: bool) -> Value {
    match provider {
        AiProvider::ClaudeCode => {
            let response = if approved {
                json!({"behavior":"allow","updatedInput":request["request"]["input"]})
            } else {
                json!({"behavior":"deny","message":"User denied permission"})
            };
            json!({"type":"control_response","response":{"subtype":"success",
                "request_id":request["request_id"],"response":response}})
        }
        AiProvider::CodexCli => json!({"id":request["id"],"result":{
            "action":if approved {"accept"} else {"decline"},"content":{}}}),
        AiProvider::CopilotCli => json!({"jsonrpc":"2.0","id":request["id"],
            "result":{"outcome":{"outcome":"selected",
                "optionId":request["params"]["options"][if approved {0} else {1}]["optionId"]}}}),
    }
}

#[test]
fn chat_duplex_two_sequential_approvals_then_overlapping_requests_reply_fifo() {
    for provider in [
        AiProvider::ClaudeCode,
        AiProvider::CodexCli,
        AiProvider::CopilotCli,
    ] {
        let mut p = ready(provider);
        for index in 0..2 {
            let request = queued_request(provider, json!(format!("sequential-{index}")), index);
            let events = p.handle(&request).unwrap();
            assert_eq!(events.len(), 1);
            assert!(permission(&events).can_approve);
            assert_eq!(
                p.permission_reply(true).unwrap(),
                queued_reply(provider, &request, true)
            );
            assert!(p.take_queued_permission().is_none());
        }

        // Numeric and string IDs with the same spelling must remain distinct.
        let requests = [json!(42), json!("42"), json!("opaque:last")]
            .into_iter()
            .enumerate()
            .map(|(index, id)| queued_request(provider, id, index + 2))
            .collect::<Vec<_>>();
        let expected_details = requests
            .iter()
            .map(|request| {
                let mut isolated = ready(provider);
                permission(&isolated.handle(request).unwrap()).clone()
            })
            .collect::<Vec<_>>();

        let events = p.handle(&requests[0]).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(permission(&events), &expected_details[0]);
        for request in &requests[1..] {
            assert!(p.handle(request).unwrap().is_empty());
        }
        for (index, approved) in [false, true, false].into_iter().enumerate() {
            assert_eq!(
                p.permission_reply(approved).unwrap(),
                queued_reply(provider, &requests[index], approved)
            );
            // Fetching the next detail must not consume its internal reply target.
            assert_eq!(
                p.take_queued_permission(),
                expected_details.get(index + 1).cloned()
            );
        }
        assert!(p.permission_reply(true).is_err());
        assert!(p.take_queued_permission().is_none());
    }
}

#[test]
fn chat_duplex_permission_queue_allows_32_pending_but_33rd_revokes_every_reply() {
    for provider in [
        AiProvider::ClaudeCode,
        AiProvider::CodexCli,
        AiProvider::CopilotCli,
    ] {
        let mut p = ready(provider);
        for index in 0..32 {
            let request = queued_request(provider, json!(index), index);
            let events = p.handle(&request).unwrap();
            if index == 0 {
                assert_eq!(events.len(), 1);
                permission(&events);
            } else {
                assert!(events.is_empty());
            }
        }
        assert!(p.handle(&queued_request(provider, json!(32), 32)).is_err());
        assert!(p.take_queued_permission().is_none());
        assert!(p.permission_reply(true).is_err());
        assert!(p.permission_reply(false).is_err());
        assert!(p.finish().is_err());
        assert!(p.handle(&queued_request(provider, json!(33), 33)).is_err());
    }
}

#[test]
fn chat_duplex_claude_opaque_ids_original_input_no_updated_permissions() {
    for id in [json!(42), json!("opaque:42")] {
        for approved in [false, true] {
            let mut p = ready(AiProvider::ClaudeCode);
            let request = claude_request(id.clone());
            let events = p.handle(&request).unwrap();
            assert!(permission(&events).can_approve);
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
            assert!(detail.can_approve);
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
        json!([{"optionId":"a","kind":"allow_always","name":"Always allow"}]),
        json!([{"optionId":"r","kind":"reject_always","name":"Always reject"}]),
        json!([
            {"optionId":"a","kind":"allow_always","name":"Always allow"},
            {"optionId":"r","kind":"reject_always","name":"Always reject"}
        ]),
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
        if approved {
            assert_eq!(
                p.permission_reply(false).unwrap(),
                json!({"jsonrpc":"2.0","id":10,"result":{"outcome":{"outcome":"cancelled"}}})
            );
        } else {
            assert!(p.permission_reply(true).is_err());
        }
    }
}

#[test]
fn chat_duplex_copilot_allow_only_denial_is_correlated_cancelled_and_completes() {
    for id in [json!(99), json!("opaque:99")] {
        let mut p = ready(AiProvider::CopilotCli);
        let mut request = copilot_request(id.clone());
        request["params"]["options"] = json!([
            {"kind":"allow_once","optionId":"only-allow","name":"Once"},
            {"kind":"reject_always","optionId":"never-use-broad-deny","name":"Always"}
        ]);
        assert!(permission(&p.handle(&request).unwrap()).can_approve);
        assert_eq!(
            p.permission_reply(false).unwrap(),
            json!({"jsonrpc":"2.0","id":id,"result":{"outcome":{"outcome":"cancelled"}}})
        );
        p.handle(&json!({"method":"session/update","params":{"sessionId":"session-1",
            "update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Permission denied."}}}})).unwrap();
        p.handle(&json!({"id":"qa-scribe-prompt","result":{"stopReason":"end_turn"}}))
            .unwrap();
        assert_eq!(p.finish().unwrap(), "Permission denied.");
        assert!(p.permission_reply(false).is_err());
    }
}

#[test]
fn chat_duplex_copilot_reject_only_cannot_approve_but_can_still_deny() {
    for id in [json!(99), json!("opaque:99")] {
        let mut p = ready(AiProvider::CopilotCli);
        let mut request = copilot_request(id.clone());
        request["params"]["options"] = json!([
            {"kind":"reject_once","optionId":"only-reject","name":"No"},
            {"kind":"allow_always","optionId":"never-use-broad-allow","name":"Always"}
        ]);
        let events = p.handle(&request).unwrap();
        assert!(!permission(&events).can_approve);
        assert!(p.permission_reply(true).is_err());
        assert_eq!(
            p.permission_reply(false).unwrap(),
            json!({"jsonrpc":"2.0","id":id,"result":{"outcome":{"outcome":"selected","optionId":"only-reject"}}})
        );
        assert!(p.permission_reply(false).is_err());
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
