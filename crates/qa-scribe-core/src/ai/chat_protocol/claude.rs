use super::*;

pub(super) struct ClaudeProtocol {
    phase: Phase,
    input: ChatInput,
}
#[derive(PartialEq)]
enum Phase {
    Initializing,
    Active,
}

impl ClaudeProtocol {
    pub(super) fn new(input: &ChatInput) -> Self {
        Self {
            phase: Phase::Initializing,
            input: input.clone(),
        }
    }
    pub(super) fn initial_message(&self) -> Value {
        json!({"type":"control_request","request_id":"qa-scribe-init","request":{"subtype":"initialize"}})
    }

    pub(super) fn handle(
        &mut self,
        output: &mut TurnData,
        event: &Value,
    ) -> Result<Vec<ChatProtocolEvent>, ProtocolError> {
        match required(event, "type")? {
            "control_response" => {
                let response = &event["response"];
                if self.phase != Phase::Initializing || response["request_id"] != "qa-scribe-init" {
                    return Err(ProtocolError::InvalidFrame(
                        "Unexpected Claude control response or permission resolution".into(),
                    ));
                }
                if response["subtype"] != "success" {
                    return Err(ProtocolError::ProviderFailure(format!(
                        "Claude initialization failed: {response}"
                    )));
                }
                self.phase = Phase::Active;
                Ok(vec![ChatProtocolEvent::Send(
                    json!({"type":"user","session_id":"",
                    "message":{"role":"user","content":if self.input.has_images() { json!(self.input.content_blocks(AiProvider::ClaudeCode)) } else { json!(self.input.text()) }},"parent_tool_use_id":null}),
                )])
            }
            "control_cancel_request" => Err(ProtocolError::ProviderFailure(
                "Claude permission request cancelled".into(),
            )),
            "control_request" => {
                if self.phase != Phase::Active {
                    return Err(ProtocolError::InvalidFrame(
                        "Claude permission before initialization".into(),
                    ));
                }
                let request = &event["request"];
                if request["subtype"] != "can_use_tool" {
                    return Err(ProtocolError::UnsupportedRequest(format!(
                        "Unsupported Claude permission/control request: {request}"
                    )));
                }
                let tool = required(request, "tool_name")?;
                if matches!(tool, "AskUserQuestion" | "ask_user_question") {
                    return Err(ProtocolError::UnsupportedRequest(
                        "Unsupported Claude user-question permission request".into(),
                    ));
                }
                let input = request
                    .get("input")
                    .filter(|value| value.is_object())
                    .ok_or_else(|| {
                        ProtocolError::InvalidFrame(
                            "Claude permission input must be an object".into(),
                        )
                    })?;
                let id = &event["request_id"];
                let allow = json!({"type":"control_response","response":{"subtype":"success",
                    "request_id":id,"response":{"behavior":"allow","updatedInput":input}}});
                let deny = json!({"type":"control_response","response":{"subtype":"success",
                    "request_id":id,"response":{"behavior":"deny","message":"User denied permission"}}});
                output.permission(
                    id,
                    Some(allow),
                    Some(deny),
                    ChatProtocolPermission {
                        can_approve: true,
                        title: format!("Claude requests permission to use {tool}"),
                        tool_name: Some(tool.into()),
                        server_name: None,
                        input_json: Some(input.to_string()),
                    },
                )
            }
            "result" => {
                if self.phase != Phase::Active {
                    return Err(ProtocolError::InvalidFrame(
                        "Claude result before initialization".into(),
                    ));
                }
                if event["is_error"].as_bool() != Some(false)
                    || event["subtype"] != "success"
                    || event.get("error").is_some_and(|error| !error.is_null())
                    || event.get("errors").is_some_and(|errors| {
                        !errors.as_array().is_some_and(|errors| errors.is_empty())
                    })
                {
                    return Err(ProtocolError::ProviderFailure(format!(
                        "Claude generation failed: {event}"
                    )));
                }
                output.text = required(event, "result")?.into();
                output.terminal()
            }
            "assistant" => {
                if self.phase != Phase::Active {
                    return Err(ProtocolError::InvalidFrame(
                        "Claude assistant message before initialization".into(),
                    ));
                }
                let content = event["message"]["content"].as_array().ok_or_else(|| {
                    ProtocolError::InvalidFrame("Invalid Claude assistant content".into())
                })?;
                if let Some(report) = crate::ai::model_report::claude_model_report(event) {
                    report.retain_in(&mut output.reported);
                }
                let text: String = content
                    .iter()
                    .filter(|block| block["type"] == "text")
                    .filter_map(|block| block["text"].as_str())
                    .collect();
                if text.is_empty() {
                    Ok(vec![])
                } else {
                    Ok(output.snapshot(text))
                }
            }
            "stream_event" => {
                if self.phase != Phase::Active {
                    return Err(ProtocolError::InvalidFrame(
                        "Claude stream before initialization".into(),
                    ));
                }
                let wire = &event["event"];
                if wire["type"] == "message_start" {
                    if let Some(report) = crate::ai::model_report::claude_model_report(event) {
                        report.retain_in(&mut output.reported);
                    }
                    return Ok(output.snapshot(String::new()));
                }
                if wire["type"] == "content_block_delta" && wire["delta"]["type"] == "text_delta" {
                    return Ok(output.delta(wire["delta"]["text"].as_str().ok_or(
                        ProtocolError::InvalidFrame("Invalid Claude text delta".into()),
                    )?));
                }
                Ok(vec![])
            }
            "system" => {
                if let Some(report) = crate::ai::model_report::claude_model_report(event) {
                    report.retain_in(&mut output.reported);
                }
                Ok(vec![])
            }
            "error" => Err(ProtocolError::ProviderFailure(format!(
                "Claude protocol error: {event}"
            ))),
            "user" | "tool_progress" | "tool_use_summary" | "rate_limit_event" => Ok(vec![]),
            other => Err(ProtocolError::UnsupportedRequest(format!(
                "Unsupported Claude protocol event: {other}"
            ))),
        }
    }
}
