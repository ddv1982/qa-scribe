use super::*;

pub(super) struct CodexProtocol {
    phase: Phase,
    input: ChatInput,
    model: Option<String>,
    effort: Option<String>,
    cwd: String,
}

enum Phase {
    Initializing,
    StartingThread {
        announced_thread: Option<String>,
    },
    StartingTurn {
        thread: String,
        announced_turn: Option<String>,
    },
    ActiveTurn {
        thread: String,
        turn: String,
    },
}

impl CodexProtocol {
    pub(super) fn new(input: &ChatInput, model: &str, effort: Option<String>, cwd: &str) -> Self {
        Self {
            phase: Phase::Initializing,
            input: input.clone(),
            model: super::super::selected_model_arg(model),
            effort,
            cwd: cwd.into(),
        }
    }
    pub(super) fn initial_message(&self) -> Value {
        json!({"id":"qa-scribe-init","method":"initialize","params":{"clientInfo":{"name":"qa-scribe","version":env!("CARGO_PKG_VERSION")},"capabilities":{"experimentalApi":true}}})
    }

    pub(super) fn handle(
        &mut self,
        output: &mut TurnData,
        event: &Value,
    ) -> Result<Vec<ChatProtocolEvent>, ProtocolError> {
        if let Some(method) = event["method"].as_str() {
            let params = &event["params"];
            if event.get("id").is_some() {
                if method != "mcpServer/elicitation/request" {
                    return Err(ProtocolError::UnsupportedRequest(format!(
                        "Unsupported Codex permission/server request: {method}"
                    )));
                }
                self.codex_scope(params)?;
                if self.turn().is_none() {
                    return Err(ProtocolError::InvalidFrame(
                        "Codex permission outside active turn".into(),
                    ));
                }
                // Installed 0.162.1 flattens the form into params. Preserve
                // the nested request seam with identical validation for both.
                let request = params.get("request").unwrap_or(params);
                let schema = &request["requestedSchema"];
                let properties_empty = schema
                    .get("properties")
                    .is_none_or(|p| p.as_object().is_some_and(|p| p.is_empty()));
                let required_empty = schema
                    .get("required")
                    .is_none_or(|r| r.as_array().is_some_and(|r| r.is_empty()));
                let allowed_keys = [
                    "type",
                    "properties",
                    "required",
                    "title",
                    "description",
                    "additionalProperties",
                    "$schema",
                ];
                let known_schema = schema
                    .as_object()
                    .is_some_and(|s| s.keys().all(|k| allowed_keys.contains(&k.as_str())));
                let additional_valid = schema
                    .get("additionalProperties")
                    .is_none_or(|v| v.is_boolean());
                let descriptions_valid = ["title", "description", "$schema"]
                    .iter()
                    .all(|key| schema.get(*key).is_none_or(Value::is_string));
                if request["mode"] != "form"
                    || request["_meta"]["codex_approval_kind"] != "mcp_tool_call"
                    || schema["type"] != "object"
                    || !properties_empty
                    || !required_empty
                    || !known_schema
                    || !additional_valid
                    || !descriptions_valid
                {
                    return Err(ProtocolError::UnsupportedRequest("Unsupported Codex permission elicitation form/schema; only native empty MCP tool approval is supported".into()));
                }
                let title = required(request, "message")?.to_owned();
                let server = required(params, "serverName")?.to_owned();
                let input = request["_meta"].get("tool_params").map(Value::to_string);
                let id = &event["id"];
                output.permission(
                    id,
                    Some(json!({"id":id,"result":{"action":"accept","content":{}}})),
                    Some(json!({"id":id,"result":{"action":"decline","content":{}}})),
                    ChatProtocolPermission {
                        can_approve: true,
                        title,
                        tool_name: None,
                        server_name: Some(server),
                        input_json: input,
                    },
                )
            } else {
                if params.get("threadId").is_some()
                    || method.starts_with("item/")
                    || method.starts_with("turn/")
                {
                    self.codex_scope(params)?;
                }
                match method {
                    "mcpServer/elicitation/request"
                    | "item/tool/requestUserInput"
                    | "item/commandExecution/requestApproval"
                    | "item/fileChange/requestApproval" => Err(ProtocolError::UnsupportedRequest(
                        format!("Unsupported or malformed Codex permission request: {method}"),
                    )),
                    "item/agentMessage/delta" => {
                        self.codex_scope(params)?;
                        if self.turn().is_none() {
                            return Err(ProtocolError::InvalidFrame(
                                "Codex assistant text outside turn".into(),
                            ));
                        }
                        Ok(output.delta(params["delta"].as_str().ok_or(
                            ProtocolError::InvalidFrame("Invalid Codex text delta".into()),
                        )?))
                    }
                    "item/completed" => {
                        self.codex_scope(params)?;
                        if self.turn().is_none() {
                            return Err(ProtocolError::InvalidFrame(
                                "Codex item outside active turn".into(),
                            ));
                        }
                        let item = &params["item"];
                        if item["type"] == "agentMessage" {
                            Ok(output.snapshot(required(item, "text")?.into()))
                        } else {
                            Ok(vec![])
                        }
                    }
                    "turn/completed" => {
                        self.codex_scope(params)?;
                        let turn = &params["turn"];
                        if self.turn() != turn["id"].as_str() || self.turn().is_none() {
                            return Err(ProtocolError::InvalidFrame(
                                "Codex terminal turn ID mismatch".into(),
                            ));
                        }
                        if turn["status"] != "completed"
                            || turn.get("error").is_some_and(|e| !e.is_null())
                        {
                            return Err(ProtocolError::ProviderFailure(format!(
                                "Codex turn failed/cancelled: {turn}"
                            )));
                        }
                        output.terminal()
                    }
                    "turn/started" => {
                        self.codex_scope(params)?;
                        if !matches!(
                            self.phase,
                            Phase::StartingTurn { .. } | Phase::ActiveTurn { .. }
                        ) || params["turn"]["status"] != "inProgress"
                        {
                            return Err(ProtocolError::InvalidFrame(
                                "Codex turn/started outside handshake or invalid status".into(),
                            ));
                        }
                        let id = required(&params["turn"], "id")?;
                        if self.turn().is_some_and(|active| active != id) {
                            return Err(ProtocolError::InvalidFrame(
                                "Codex turn ID mismatch".into(),
                            ));
                        }
                        if let Phase::StartingTurn { announced_turn, .. } = &mut self.phase {
                            *announced_turn = Some(id.into());
                        }
                        Ok(vec![])
                    }
                    "thread/started" => {
                        let id = required(&params["thread"], "id")?;
                        if let Phase::StartingThread { announced_thread } = &mut self.phase
                            && announced_thread.is_none()
                        {
                            *announced_thread = Some(id.into());
                        } else if self.thread() != Some(id) {
                            return Err(ProtocolError::InvalidFrame(
                                "Codex thread/started mismatch".into(),
                            ));
                        }
                        Ok(vec![])
                    }
                    "error" => Err(ProtocolError::ProviderFailure(format!(
                        "Codex protocol error: {params}"
                    ))),
                    "serverRequest/resolved" => {
                        self.codex_scope(params)?;
                        let id = &params["requestId"];
                        if output.pending.iter().any(|pending| pending.id == *id) {
                            return Err(ProtocolError::ProviderFailure(
                                "Codex pending permission resolved/cancelled by provider".into(),
                            ));
                        }
                        if !output.seen.contains(id) {
                            return Err(ProtocolError::InvalidFrame(
                                "Unknown Codex permission resolution ID".into(),
                            ));
                        }
                        Ok(vec![])
                    }
                    "mcpServer/elicitation/completed" | "mcpServer/elicitation/cancelled"
                        if !output.pending.is_empty() =>
                    {
                        Err(ProtocolError::ProviderFailure(
                            "Codex pending permission resolved/cancelled by provider".into(),
                        ))
                    }
                    _ => Ok(vec![]),
                }
            }
        } else if event.get("id").is_some() {
            if event.get("error").is_some() {
                return Err(ProtocolError::ProviderFailure(format!(
                    "Codex request failed: {}",
                    event["error"]
                )));
            }
            let result = event.get("result").ok_or_else(|| {
                ProtocolError::InvalidFrame("Codex response missing result".into())
            })?;
            match (&self.phase, event["id"].as_str()) {
                (Phase::Initializing, Some("qa-scribe-init")) => {
                    self.phase = Phase::StartingThread {
                        announced_thread: None,
                    };
                    let mut params = json!({"ephemeral":true,"cwd":self.cwd});
                    if let Some(model) = &self.model {
                        params["model"] = json!(model);
                    }
                    Ok(vec![
                        ChatProtocolEvent::Send(json!({"method":"initialized"})),
                        ChatProtocolEvent::Send(
                            json!({"id":"qa-scribe-thread","method":"thread/start","params":params}),
                        ),
                    ])
                }
                (Phase::StartingThread { .. }, Some("qa-scribe-thread")) => {
                    let id = required(&result["thread"], "id")?;
                    if self.thread().is_some_and(|active| active != id) {
                        return Err(ProtocolError::InvalidFrame(
                            "Codex thread response ID mismatch".into(),
                        ));
                    }
                    output.reported = crate::ai::model_report::report_id(&result["model"])
                        .map(|id| ReportedModel::CodexThreadConfiguration { id });
                    self.phase = Phase::StartingTurn {
                        thread: id.into(),
                        announced_turn: None,
                    };
                    let mut params = json!({"threadId":id,"input":self.input.content_blocks(AiProvider::CodexCli)});
                    if let Some(model) = &self.model {
                        params["model"] = json!(model);
                    }
                    if let Some(effort) = &self.effort {
                        params["effort"] = json!(effort);
                    }
                    Ok(vec![ChatProtocolEvent::Send(
                        json!({"id":"qa-scribe-turn","method":"turn/start","params":params}),
                    )])
                }
                (Phase::StartingTurn { thread, .. }, Some("qa-scribe-turn")) => {
                    let turn = &result["turn"];
                    if turn["status"] != "inProgress" {
                        return Err(ProtocolError::ProviderFailure(format!(
                            "Codex turn/start failed: {turn}"
                        )));
                    }
                    let id = required(turn, "id")?;
                    if self.turn().is_some_and(|active| active != id) {
                        return Err(ProtocolError::InvalidFrame(
                            "Codex turn response ID mismatch".into(),
                        ));
                    }
                    self.phase = Phase::ActiveTurn {
                        thread: thread.clone(),
                        turn: id.into(),
                    };
                    Ok(vec![])
                }
                _ => Err(ProtocolError::InvalidFrame(
                    "Unexpected Codex response or pending permission resolution".into(),
                )),
            }
        } else {
            Err(ProtocolError::InvalidFrame(
                "Invalid Codex protocol message".into(),
            ))
        }
    }

    fn thread(&self) -> Option<&str> {
        match &self.phase {
            Phase::Initializing => None,
            Phase::StartingThread { announced_thread } => announced_thread.as_deref(),
            Phase::StartingTurn { thread, .. } | Phase::ActiveTurn { thread, .. } => Some(thread),
        }
    }

    fn turn(&self) -> Option<&str> {
        match &self.phase {
            Phase::StartingTurn { announced_turn, .. } => announced_turn.as_deref(),
            Phase::ActiveTurn { turn, .. } => Some(turn),
            _ => None,
        }
    }

    fn codex_scope(&self, params: &Value) -> Result<(), ProtocolError> {
        if self.thread() != params["threadId"].as_str() || self.thread().is_none() {
            return Err(ProtocolError::InvalidFrame(
                "Protocol threadId does not match active session/thread".into(),
            ));
        }
        // MCP elicitation turnId is nullable by protocol. Thread correlation
        // and an active local turn remain mandatory for permission requests.
        if let Some(id) = params.get("turnId").filter(|id| !id.is_null())
            && (self.turn() != id.as_str() || self.turn().is_none())
        {
            return Err(ProtocolError::InvalidFrame(
                "Codex notification turnId mismatch".into(),
            ));
        }
        Ok(())
    }
}
