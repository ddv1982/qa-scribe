use super::*;

const MAX_TOOL_CALL_METADATA: usize = 64;

/// Display-only metadata, never a permission grant or executable tool payload.
#[derive(Clone, Default)]
pub(super) struct ToolCallMetadata {
    title: Option<String>,
    raw_input: Option<Value>,
}

impl ChatProtocol {
    pub(super) fn copilot_handle(
        &mut self,
        event: &Value,
    ) -> Result<Vec<ChatProtocolEvent>, String> {
        if let Some(method) = event["method"].as_str() {
            let params = &event["params"];
            // ACP can publish command metadata while session/new is pending.
            // Ignore only this benign notification, without binding a session
            // or accepting early assistant/tool/permission authority.
            if self.stage == 1
                && method == "session/update"
                && event.get("id").is_none()
                && params["update"]["sessionUpdate"] == "available_commands_update"
            {
                required(params, "sessionId")?;
                if !params["update"]["availableCommands"].is_array() {
                    return Err("Malformed Copilot available commands metadata".into());
                }
                return Ok(vec![]);
            }
            if method.starts_with("session/") {
                self.match_scope(params, "sessionId")?;
            }
            match method {
                "session/request_permission" => {
                    if self.stage != 2 {
                        return Err("Copilot permission outside active prompt".into());
                    }
                    let call = &params["toolCall"];
                    let metadata = self.copilot_metadata(call)?;
                    let title = metadata
                        .title
                        .ok_or("Copilot permission has no established tool title")?;
                    let options = params["options"]
                        .as_array()
                        .ok_or("Malformed Copilot permission options")?;
                    let mut allow = None;
                    let mut deny = None;
                    let mut ids = Vec::new();
                    for option in options {
                        let id = required(option, "optionId")?;
                        required(option, "name")?;
                        if ids.contains(&id) {
                            return Err("Duplicate Copilot permission option ID".into());
                        }
                        ids.push(id);
                        let reply = json!({"jsonrpc":"2.0","id":event["id"],"result":{
                            "outcome":{"outcome":"selected","optionId":id}}});
                        match required(option, "kind")? {
                            "allow_once" if allow.is_none() => allow = Some(reply),
                            "reject_once" if deny.is_none() => deny = Some(reply),
                            "allow_always" | "reject_always" => {}
                            _ => {
                                return Err(
                                    "Unsupported or ambiguous Copilot permission option kind"
                                        .into(),
                                );
                            }
                        }
                    }
                    if allow.is_none() && deny.is_none() {
                        return Err("Copilot permission offers no once-only decision".into());
                    }
                    self.permission(
                        &event["id"],
                        allow,
                        deny,
                        ChatProtocolPermission {
                            title,
                            tool_name: None,
                            server_name: None,
                            input_json: metadata.raw_input.as_ref().map(Value::to_string),
                        },
                    )
                }
                "session/cancel"
                | "$/cancel_request"
                | "$/cancelRequest"
                | "notifications/cancelled" => Err("Copilot prompt/permission cancelled".into()),
                "session/update" => {
                    if event.get("id").is_some() {
                        return Err("Unexpected Copilot server request: session/update".into());
                    }
                    if self.stage != 2 {
                        return Err("Copilot update outside active prompt".into());
                    }
                    let update = &params["update"];
                    match required(update, "sessionUpdate")? {
                        "agent_message_chunk" => {
                            if update["content"]["type"] == "text" {
                                Ok(self.delta(
                                    update["content"]["text"]
                                        .as_str()
                                        .ok_or("Invalid Copilot text delta")?,
                                ))
                            } else {
                                Ok(vec![])
                            }
                        }
                        "tool_call" | "tool_call_update" => {
                            let metadata = self.copilot_metadata(update)?;
                            if let Some(title) = metadata.title {
                                Ok(vec![ChatProtocolEvent::Update(StreamUpdate::Progress(
                                    title,
                                ))])
                            } else {
                                Ok(vec![])
                            }
                        }
                        _ => Ok(vec![]),
                    }
                }
                _ if event.get("id").is_some() => Err(format!(
                    "Unsupported Copilot permission/server request: {method}"
                )),
                _ => Ok(vec![]),
            }
        } else if event.get("id").is_some() {
            if event.get("error").is_some() {
                return Err(format!("Copilot request failed: {}", event["error"]));
            }
            let result = event
                .get("result")
                .ok_or("Copilot response missing result")?;
            match (self.stage, event["id"].as_str()) {
                (0, Some("qa-scribe-init")) => {
                    if result["protocolVersion"] != 1 {
                        return Err("Unsupported Copilot ACP protocol version".into());
                    }
                    self.copilot_calls.clear();
                    self.stage = 1;
                    Ok(vec![ChatProtocolEvent::Send(rpc(
                        "qa-scribe-session",
                        "session/new",
                        json!({"cwd":self.cwd,"mcpServers":[]}),
                    ))])
                }
                (1, Some("qa-scribe-session")) => {
                    self.copilot_calls.clear();
                    self.scope = Some(required(result, "sessionId")?.into());
                    self.stage = 2;
                    Ok(vec![ChatProtocolEvent::Send(rpc(
                        "qa-scribe-prompt",
                        "session/prompt",
                        json!({"sessionId":self.scope,"prompt":[{"type":"text","text":self.prompt}]}),
                    ))])
                }
                (2, Some("qa-scribe-prompt")) => {
                    if result["stopReason"] != "end_turn"
                        || result.get("error").is_some_and(|error| !error.is_null())
                        || matches!(
                            result["status"].as_str(),
                            Some("failed" | "error" | "cancelled")
                        )
                    {
                        return Err(format!("Copilot prompt failed/stopped: {result}"));
                    }
                    self.terminal()
                }
                _ => Err("Unexpected Copilot response or pending permission resolution".into()),
            }
        } else {
            Err("Invalid Copilot protocol message".into())
        }
    }

    // Called only after active-session correlation and stage validation.
    // Absent fields preserve prior metadata; explicitly present fields replace
    // it. In particular, null rawInput is not treated as an absent field.
    fn copilot_metadata(&mut self, call: &Value) -> Result<ToolCallMetadata, String> {
        let id = required(call, "toolCallId")?;
        let title = if call.get("title").is_some() {
            Some(required(call, "title")?.to_owned())
        } else {
            None
        };
        if !self.copilot_calls.contains_key(id)
            && self.copilot_calls.len() >= MAX_TOOL_CALL_METADATA
        {
            return Err("Copilot tool-call metadata limit exceeded (64 distinct calls)".into());
        }
        let metadata = self.copilot_calls.entry(id.to_owned()).or_default();
        if let Some(title) = title {
            metadata.title = Some(title);
        }
        if let Some(input) = call.get("rawInput") {
            metadata.raw_input = Some(input.clone());
        }
        Ok(metadata.clone())
    }
}
