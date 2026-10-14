use super::*;

impl ChatProtocol {
    pub(super) fn codex_handle(&mut self, event: &Value) -> Result<Vec<ChatProtocolEvent>, String> {
        if let Some(method) = event["method"].as_str() {
            let params = &event["params"];
            if event.get("id").is_some() {
                if method != "mcpServer/elicitation/request" {
                    return Err(format!(
                        "Unsupported Codex permission/server request: {method}"
                    ));
                }
                self.codex_scope(params)?;
                if !matches!(self.stage, 2 | 3) || self.turn.is_none() {
                    return Err("Codex permission outside active turn".into());
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
                    return Err("Unsupported Codex permission elicitation form/schema; only native empty MCP tool approval is supported".into());
                }
                let title = required(request, "message")?.to_owned();
                let server = required(params, "serverName")?.to_owned();
                let input = request["_meta"].get("tool_params").map(Value::to_string);
                let id = &event["id"];
                self.permission(
                    id,
                    Some(json!({"id":id,"result":{"action":"accept","content":{}}})),
                    Some(json!({"id":id,"result":{"action":"decline","content":{}}})),
                    ChatProtocolPermission {
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
                    | "item/fileChange/requestApproval" => Err(format!(
                        "Unsupported or malformed Codex permission request: {method}"
                    )),
                    "item/agentMessage/delta" => {
                        self.codex_scope(params)?;
                        if !matches!(self.stage, 2 | 3) || self.turn.is_none() {
                            return Err("Codex assistant text outside turn".into());
                        }
                        Ok(self.delta(params["delta"].as_str().ok_or("Invalid Codex text delta")?))
                    }
                    "item/completed" => {
                        self.codex_scope(params)?;
                        if !matches!(self.stage, 2 | 3) || self.turn.is_none() {
                            return Err("Codex item outside active turn".into());
                        }
                        let item = &params["item"];
                        if item["type"] == "agentMessage" {
                            Ok(self.snapshot(required(item, "text")?.into()))
                        } else {
                            Ok(vec![])
                        }
                    }
                    "turn/completed" => {
                        self.codex_scope(params)?;
                        let turn = &params["turn"];
                        if !matches!(self.stage, 2 | 3)
                            || self.turn.as_deref() != turn["id"].as_str()
                            || self.turn.is_none()
                        {
                            return Err("Codex terminal turn ID mismatch".into());
                        }
                        if turn["status"] != "completed"
                            || turn.get("error").is_some_and(|e| !e.is_null())
                        {
                            return Err(format!("Codex turn failed/cancelled: {turn}"));
                        }
                        self.terminal()
                    }
                    "turn/started" => {
                        self.codex_scope(params)?;
                        if !matches!(self.stage, 2 | 3) || params["turn"]["status"] != "inProgress"
                        {
                            return Err(
                                "Codex turn/started outside handshake or invalid status".into()
                            );
                        }
                        let id = required(&params["turn"], "id")?;
                        if self.turn.as_deref().is_some_and(|active| active != id) {
                            return Err("Codex turn ID mismatch".into());
                        }
                        self.turn = Some(id.into());
                        Ok(vec![])
                    }
                    "thread/started" => {
                        let id = required(&params["thread"], "id")?;
                        if self.stage == 1 && self.scope.is_none() {
                            self.scope = Some(id.into());
                        } else if self.scope.as_deref() != Some(id) {
                            return Err("Codex thread/started mismatch".into());
                        }
                        Ok(vec![])
                    }
                    "error" => Err(format!("Codex protocol error: {params}")),
                    "serverRequest/resolved" => {
                        self.codex_scope(params)?;
                        let id = &params["requestId"];
                        if self
                            .pending
                            .as_ref()
                            .is_some_and(|pending| pending.id == *id)
                        {
                            return Err(
                                "Codex pending permission resolved/cancelled by provider".into()
                            );
                        }
                        if !self.seen.contains(id) {
                            return Err("Unknown Codex permission resolution ID".into());
                        }
                        Ok(vec![])
                    }
                    "mcpServer/elicitation/completed" | "mcpServer/elicitation/cancelled"
                        if self.pending.is_some() =>
                    {
                        Err("Codex pending permission resolved/cancelled by provider".into())
                    }
                    _ => Ok(vec![]),
                }
            }
        } else if event.get("id").is_some() {
            if event.get("error").is_some() {
                return Err(format!("Codex request failed: {}", event["error"]));
            }
            let result = event.get("result").ok_or("Codex response missing result")?;
            match (self.stage, event["id"].as_str()) {
                (0, Some("qa-scribe-init")) => {
                    self.stage = 1;
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
                (1, Some("qa-scribe-thread")) => {
                    let id = required(&result["thread"], "id")?;
                    if self.scope.as_deref().is_some_and(|active| active != id) {
                        return Err("Codex thread response ID mismatch".into());
                    }
                    self.scope = Some(id.into());
                    self.reported = result["model"].as_str().map(str::to_owned);
                    self.stage = 2;
                    let mut params =
                        json!({"threadId":self.scope,"input":[{"type":"text","text":self.prompt}]});
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
                (2, Some("qa-scribe-turn")) => {
                    let turn = &result["turn"];
                    if turn["status"] != "inProgress" {
                        return Err(format!("Codex turn/start failed: {turn}"));
                    }
                    let id = required(turn, "id")?;
                    if self.turn.as_deref().is_some_and(|active| active != id) {
                        return Err("Codex turn response ID mismatch".into());
                    }
                    self.turn = Some(id.into());
                    self.stage = 3;
                    Ok(vec![])
                }
                _ => Err("Unexpected Codex response or pending permission resolution".into()),
            }
        } else {
            Err("Invalid Codex protocol message".into())
        }
    }

    fn codex_scope(&self, params: &Value) -> Result<(), String> {
        self.match_scope(params, "threadId")?;
        // MCP elicitation turnId is nullable by protocol. Thread correlation
        // and an active local turn remain mandatory for permission requests.
        if let Some(id) = params.get("turnId").filter(|id| !id.is_null())
            && (self.turn.as_deref() != id.as_str() || self.turn.is_none())
        {
            return Err("Codex notification turnId mismatch".into());
        }
        Ok(())
    }
}
