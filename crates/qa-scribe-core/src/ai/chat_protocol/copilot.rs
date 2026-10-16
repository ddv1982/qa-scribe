use super::*;
use std::collections::BTreeMap;

const MAX_TOOL_CALL_METADATA: usize = 64;

/// Display-only metadata, never a permission grant or executable tool payload.
#[derive(Clone, Default)]
struct ToolCallMetadata {
    title: Option<String>,
    raw_input: Option<Value>,
}

pub(super) struct CopilotProtocol {
    phase: Phase,
    prompt: String,
    cwd: String,
}

enum Phase {
    Initializing,
    CreatingSession,
    Prompting {
        session: String,
        calls: BTreeMap<String, ToolCallMetadata>,
    },
}

impl CopilotProtocol {
    pub(super) fn new(prompt: &str, cwd: &str) -> Self {
        Self {
            phase: Phase::Initializing,
            prompt: prompt.into(),
            cwd: cwd.into(),
        }
    }
    pub(super) fn initial_message(&self) -> Value {
        rpc(
            "qa-scribe-init",
            "initialize",
            json!({"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"qa-scribe","version":env!("CARGO_PKG_VERSION")}}),
        )
    }
    pub(super) fn clear_metadata(&mut self) {
        if let Phase::Prompting { calls, .. } = &mut self.phase {
            calls.clear();
        }
    }

    pub(super) fn handle(
        &mut self,
        output: &mut TurnData,
        event: &Value,
    ) -> Result<Vec<ChatProtocolEvent>, ProtocolError> {
        if let Some(method) = event["method"].as_str() {
            let params = &event["params"];
            // ACP can publish command metadata while session/new is pending.
            // Ignore only this benign notification, without binding a session
            // or accepting early assistant/tool/permission authority.
            if matches!(self.phase, Phase::CreatingSession)
                && method == "session/update"
                && event.get("id").is_none()
                && params["update"]["sessionUpdate"] == "available_commands_update"
            {
                required(params, "sessionId")?;
                if !params["update"]["availableCommands"].is_array() {
                    return Err(ProtocolError::InvalidFrame(
                        "Malformed Copilot available commands metadata".into(),
                    ));
                }
                return Ok(vec![]);
            }
            if method.starts_with("session/")
                && (self.session() != params["sessionId"].as_str() || self.session().is_none())
            {
                return Err(ProtocolError::InvalidFrame(
                    "Protocol sessionId does not match active session/thread".into(),
                ));
            }
            match method {
                "session/request_permission" => {
                    let Phase::Prompting { calls, .. } = &mut self.phase else {
                        return Err(ProtocolError::InvalidFrame(
                            "Copilot permission outside active prompt".into(),
                        ));
                    };
                    let call = &params["toolCall"];
                    let metadata = tool_metadata(calls, call)?;
                    let title = metadata.title.ok_or_else(|| {
                        ProtocolError::InvalidFrame(
                            "Copilot permission has no established tool title".into(),
                        )
                    })?;
                    let options = params["options"].as_array().ok_or_else(|| {
                        ProtocolError::InvalidFrame("Malformed Copilot permission options".into())
                    })?;
                    let mut allow = None;
                    let mut deny = None;
                    let mut ids = Vec::new();
                    for option in options {
                        let id = required(option, "optionId")?;
                        required(option, "name")?;
                        if ids.contains(&id) {
                            return Err(ProtocolError::InvalidFrame(
                                "Duplicate Copilot permission option ID".into(),
                            ));
                        }
                        ids.push(id);
                        let reply = json!({"jsonrpc":"2.0","id":event["id"],"result":{
                            "outcome":{"outcome":"selected","optionId":id}}});
                        match required(option, "kind")? {
                            "allow_once" if allow.is_none() => allow = Some(reply),
                            "reject_once" if deny.is_none() => deny = Some(reply),
                            "allow_always" | "reject_always" => {}
                            _ => {
                                return Err(ProtocolError::UnsupportedRequest(
                                    "Unsupported or ambiguous Copilot permission option kind"
                                        .into(),
                                ));
                            }
                        }
                    }
                    if allow.is_none() && deny.is_none() {
                        return Err(ProtocolError::UnsupportedRequest(
                            "Copilot permission offers no once-only decision".into(),
                        ));
                    }
                    let can_approve = allow.is_some();
                    let deny = Some(deny.unwrap_or_else(|| {
                        json!({"jsonrpc":"2.0","id":event["id"],
                            "result":{"outcome":{"outcome":"cancelled"}}})
                    }));
                    output.permission(
                        &event["id"],
                        allow,
                        deny,
                        ChatProtocolPermission {
                            can_approve,
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
                | "notifications/cancelled" => Err(ProtocolError::ProviderFailure(
                    "Copilot prompt/permission cancelled".into(),
                )),
                "session/update" => {
                    if event.get("id").is_some() {
                        return Err(ProtocolError::InvalidFrame(
                            "Unexpected Copilot server request: session/update".into(),
                        ));
                    }
                    let Phase::Prompting { calls, .. } = &mut self.phase else {
                        return Err(ProtocolError::InvalidFrame(
                            "Copilot update outside active prompt".into(),
                        ));
                    };
                    let update = &params["update"];
                    match required(update, "sessionUpdate")? {
                        "agent_message_chunk" => {
                            if update["content"]["type"] == "text" {
                                Ok(output.delta(update["content"]["text"].as_str().ok_or(
                                    ProtocolError::InvalidFrame(
                                        "Invalid Copilot text delta".into(),
                                    ),
                                )?))
                            } else {
                                Ok(vec![])
                            }
                        }
                        "tool_call" | "tool_call_update" => {
                            let metadata = tool_metadata(calls, update)?;
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
                _ if event.get("id").is_some() => Err(ProtocolError::UnsupportedRequest(format!(
                    "Unsupported Copilot permission/server request: {method}"
                ))),
                _ => Ok(vec![]),
            }
        } else if event.get("id").is_some() {
            if event.get("error").is_some() {
                return Err(ProtocolError::ProviderFailure(format!(
                    "Copilot request failed: {}",
                    event["error"]
                )));
            }
            let result = event.get("result").ok_or_else(|| {
                ProtocolError::InvalidFrame("Copilot response missing result".into())
            })?;
            match (&self.phase, event["id"].as_str()) {
                (Phase::Initializing, Some("qa-scribe-init")) => {
                    if result["protocolVersion"] != 1 {
                        return Err(ProtocolError::UnsupportedRequest(
                            "Unsupported Copilot ACP protocol version".into(),
                        ));
                    }
                    self.phase = Phase::CreatingSession;
                    Ok(vec![ChatProtocolEvent::Send(rpc(
                        "qa-scribe-session",
                        "session/new",
                        json!({"cwd":self.cwd,"mcpServers":[]}),
                    ))])
                }
                (Phase::CreatingSession, Some("qa-scribe-session")) => {
                    let session = required(result, "sessionId")?;
                    self.phase = Phase::Prompting {
                        session: session.into(),
                        calls: BTreeMap::new(),
                    };
                    Ok(vec![ChatProtocolEvent::Send(rpc(
                        "qa-scribe-prompt",
                        "session/prompt",
                        json!({"sessionId":session,"prompt":[{"type":"text","text":self.prompt}]}),
                    ))])
                }
                (Phase::Prompting { .. }, Some("qa-scribe-prompt")) => {
                    if result["stopReason"] != "end_turn"
                        || result.get("error").is_some_and(|error| !error.is_null())
                        || matches!(
                            result["status"].as_str(),
                            Some("failed" | "error" | "cancelled")
                        )
                    {
                        return Err(ProtocolError::ProviderFailure(format!(
                            "Copilot prompt failed/stopped: {result}"
                        )));
                    }
                    output.terminal()
                }
                _ => Err(ProtocolError::InvalidFrame(
                    "Unexpected Copilot response or pending permission resolution".into(),
                )),
            }
        } else {
            Err(ProtocolError::InvalidFrame(
                "Invalid Copilot protocol message".into(),
            ))
        }
    }

    fn session(&self) -> Option<&str> {
        match &self.phase {
            Phase::Prompting { session, .. } => Some(session),
            _ => None,
        }
    }
}

// Absent fields preserve prior metadata; explicitly present fields replace
// it. In particular, null rawInput is not treated as an absent field.
fn tool_metadata(
    calls: &mut BTreeMap<String, ToolCallMetadata>,
    call: &Value,
) -> Result<ToolCallMetadata, ProtocolError> {
    let id = required(call, "toolCallId")?;
    let title = if call.get("title").is_some() {
        Some(required(call, "title")?.to_owned())
    } else {
        None
    };
    if !calls.contains_key(id) && calls.len() >= MAX_TOOL_CALL_METADATA {
        return Err(ProtocolError::InvalidFrame(
            "Copilot tool-call metadata limit exceeded (64 distinct calls)".into(),
        ));
    }
    let metadata = calls.entry(id.to_owned()).or_default();
    if let Some(title) = title {
        metadata.title = Some(title);
    }
    if let Some(input) = call.get("rawInput") {
        metadata.raw_input = Some(input.clone());
    }
    Ok(metadata.clone())
}
