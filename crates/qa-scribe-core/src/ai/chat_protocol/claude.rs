use super::*;

impl ChatProtocol {
    pub(super) fn claude_handle(
        &mut self,
        event: &Value,
    ) -> Result<Vec<ChatProtocolEvent>, String> {
        match required(event, "type")? {
            "control_response" => {
                let response = &event["response"];
                if self.stage != 0 || response["request_id"] != "qa-scribe-init" {
                    return Err(
                        "Unexpected Claude control response or permission resolution".into(),
                    );
                }
                if response["subtype"] != "success" {
                    return Err(format!("Claude initialization failed: {response}"));
                }
                self.stage = 1;
                Ok(vec![ChatProtocolEvent::Send(
                    json!({"type":"user","session_id":"",
                    "message":{"role":"user","content":self.prompt},"parent_tool_use_id":null}),
                )])
            }
            "control_cancel_request" => Err("Claude permission request cancelled".into()),
            "control_request" => {
                if self.stage != 1 {
                    return Err("Claude permission before initialization".into());
                }
                let request = &event["request"];
                if request["subtype"] != "can_use_tool" {
                    return Err(format!(
                        "Unsupported Claude permission/control request: {request}"
                    ));
                }
                let tool = required(request, "tool_name")?;
                if matches!(tool, "AskUserQuestion" | "ask_user_question") {
                    return Err("Unsupported Claude user-question permission request".into());
                }
                let input = request
                    .get("input")
                    .filter(|value| value.is_object())
                    .ok_or("Claude permission input must be an object")?;
                let id = &event["request_id"];
                let allow = json!({"type":"control_response","response":{"subtype":"success",
                    "request_id":id,"response":{"behavior":"allow","updatedInput":input}}});
                let deny = json!({"type":"control_response","response":{"subtype":"success",
                    "request_id":id,"response":{"behavior":"deny","message":"User denied permission"}}});
                self.permission(
                    id,
                    Some(allow),
                    Some(deny),
                    ChatProtocolPermission {
                        title: format!("Claude requests permission to use {tool}"),
                        tool_name: Some(tool.into()),
                        server_name: None,
                        input_json: Some(input.to_string()),
                    },
                )
            }
            "result" => {
                if self.stage != 1 {
                    return Err("Claude result before initialization".into());
                }
                if event["is_error"].as_bool() != Some(false)
                    || event["subtype"] != "success"
                    || event.get("error").is_some_and(|error| !error.is_null())
                    || event.get("errors").is_some_and(|errors| {
                        !errors.as_array().is_some_and(|errors| errors.is_empty())
                    })
                {
                    return Err(format!("Claude generation failed: {event}"));
                }
                self.text = required(event, "result")?.into();
                self.terminal()
            }
            "assistant" => {
                if self.stage != 1 {
                    return Err("Claude assistant message before initialization".into());
                }
                if let Some(model) = event["message"]["model"].as_str() {
                    self.reported = Some(model.into());
                }
                let content = event["message"]["content"]
                    .as_array()
                    .ok_or("Invalid Claude assistant content")?;
                let text: String = content
                    .iter()
                    .filter(|block| block["type"] == "text")
                    .filter_map(|block| block["text"].as_str())
                    .collect();
                if text.is_empty() {
                    Ok(vec![])
                } else {
                    Ok(self.snapshot(text))
                }
            }
            "stream_event" => {
                if self.stage != 1 {
                    return Err("Claude stream before initialization".into());
                }
                let wire = &event["event"];
                if wire["type"] == "message_start" {
                    if let Some(model) = wire["message"]["model"].as_str() {
                        self.reported = Some(model.into());
                    }
                    return Ok(self.snapshot(String::new()));
                }
                if wire["type"] == "content_block_delta" && wire["delta"]["type"] == "text_delta" {
                    return Ok(self.delta(
                        wire["delta"]["text"]
                            .as_str()
                            .ok_or("Invalid Claude text delta")?,
                    ));
                }
                Ok(vec![])
            }
            "system" => {
                if let Some(model) = event["model"].as_str() {
                    self.reported = Some(model.into());
                }
                Ok(vec![])
            }
            "error" => Err(format!("Claude protocol error: {event}")),
            "user" | "tool_progress" | "tool_use_summary" | "rate_limit_event" => Ok(vec![]),
            other => Err(format!("Unsupported Claude protocol event: {other}")),
        }
    }
}
