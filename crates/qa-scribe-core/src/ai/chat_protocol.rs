//! Stateful wire adapters. Opaque permission IDs and arguments stay in core.
mod claude;
mod codex;
mod copilot;
#[cfg(test)]
mod tests;

use super::stream::StreamUpdate;
use crate::domain::AiProvider;
use serde_json::{Value, json};
use std::collections::{BTreeMap, VecDeque};

#[derive(Clone, Debug)]
pub enum ChatProtocolEvent {
    Send(Value),
    Update(StreamUpdate),
    Permission(ChatProtocolPermission),
    Complete,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChatProtocolPermission {
    pub can_approve: bool,
    pub title: String,
    pub tool_name: Option<String>,
    pub server_name: Option<String>,
    pub input_json: Option<String>,
}

pub struct ChatProtocol {
    provider: AiProvider,
    prompt: String,
    model: Option<String>,
    effort: Option<String>,
    cwd: String,
    stage: u8,
    scope: Option<String>,
    turn: Option<String>,
    pending: VecDeque<Pending>,
    seen: Vec<Value>,
    copilot_calls: BTreeMap<String, copilot::ToolCallMetadata>,
    text: String,
    reported: Option<String>,
    complete: bool,
    failure: Option<String>,
}

struct Pending {
    id: Value,
    allow: Option<Value>,
    deny: Option<Value>,
    detail: Option<ChatProtocolPermission>,
}

impl ChatProtocol {
    pub fn new(
        provider: AiProvider,
        prompt: &str,
        model: &str,
        effort: Option<&str>,
        cwd: &str,
    ) -> Self {
        let effort = super::selected_reasoning_effort_arg(effort);
        let failure = effort.as_ref().err().cloned();
        Self {
            provider,
            prompt: prompt.into(),
            model: if provider == AiProvider::CopilotCli {
                super::selected_copilot_model_arg(model)
            } else {
                super::selected_model_arg(model)
            },
            effort: effort.ok().flatten(),
            cwd: cwd.into(),
            stage: 0,
            scope: None,
            turn: None,
            pending: VecDeque::new(),
            seen: Vec::new(),
            copilot_calls: BTreeMap::new(),
            text: String::new(),
            reported: None,
            complete: false,
            failure,
        }
    }

    pub fn initial_message(&self) -> Value {
        match self.provider {
            AiProvider::ClaudeCode => {
                json!({"type":"control_request","request_id":"qa-scribe-init",
                "request":{"subtype":"initialize"}})
            }
            AiProvider::CodexCli => json!({"id":"qa-scribe-init","method":"initialize","params":{
                "clientInfo":{"name":"qa-scribe","version":env!("CARGO_PKG_VERSION")},
                "capabilities":{"experimentalApi":true}}}),
            AiProvider::CopilotCli => rpc(
                "qa-scribe-init",
                "initialize",
                json!({
                "protocolVersion":1,"clientCapabilities":{},
                "clientInfo":{"name":"qa-scribe","version":env!("CARGO_PKG_VERSION")}}),
            ),
        }
    }

    pub fn handle(&mut self, event: &Value) -> Result<Vec<ChatProtocolEvent>, String> {
        if let Some(error) = &self.failure {
            return Err(error.clone());
        }
        if self.complete {
            return self.fail("Protocol event received after completion".into());
        }
        let result = match self.provider {
            AiProvider::ClaudeCode => self.claude_handle(event),
            AiProvider::CodexCli => self.codex_handle(event),
            AiProvider::CopilotCli => self.copilot_handle(event),
        };
        match result {
            Ok(events) => Ok(events),
            Err(error) => self.fail(error),
        }
    }

    pub fn permission_reply(&mut self, approved: bool) -> Result<Value, String> {
        if let Some(error) = &self.failure {
            return Err(error.clone());
        }
        // An unavailable approval is a rejected local choice, not a provider
        // protocol failure. Keep the request available for an explicit denial.
        if approved
            && self
                .pending
                .front()
                .is_some_and(|pending| pending.allow.is_none())
        {
            return Err("Permission decision has no offered once-only option".into());
        }
        let Some(pending) = self.pending.pop_front() else {
            return Err("No pending permission request".into());
        };
        self.seen.push(pending.id);
        let reply = if approved {
            pending.allow
        } else {
            pending.deny
        };
        match reply {
            Some(reply) => Ok(reply),
            None => self.fail("Permission decision has no offered once-only option".into()),
        }
    }

    pub fn finish(&self) -> Result<String, String> {
        if let Some(error) = &self.failure {
            return Err(error.clone());
        }
        if !self.complete || !self.pending.is_empty() {
            return Err("Chat protocol ended without successful completion".into());
        }
        if self.text.trim().is_empty() {
            return Err("Provider returned no assistant text".into());
        }
        Ok(self.text.clone())
    }

    pub fn reported_model(&self) -> Option<String> {
        self.reported.clone()
    }

    /// Publish the next queued prompt without consuming its correlated reply.
    pub fn take_queued_permission(&mut self) -> Option<ChatProtocolPermission> {
        self.pending.front_mut()?.detail.take()
    }

    fn fail<T>(&mut self, error: String) -> Result<T, String> {
        self.pending.clear();
        self.copilot_calls.clear();
        self.failure = Some(error.clone());
        Err(error)
    }

    fn permission(
        &mut self,
        id: &Value,
        allow: Option<Value>,
        deny: Option<Value>,
        detail: ChatProtocolPermission,
    ) -> Result<Vec<ChatProtocolEvent>, String> {
        if !(id.is_string() || id.is_number()) || id.as_str() == Some("") {
            return Err("Permission request has invalid opaque ID".into());
        }
        if self.pending.iter().any(|pending| pending.id == *id) || self.seen.contains(id) {
            return Err("Duplicate or stale permission request".into());
        }
        if self.pending.len() >= 32 {
            return Err("Too many pending permission requests (maximum 32)".into());
        }
        let publish = self.pending.is_empty();
        self.pending.push_back(Pending {
            id: id.clone(),
            allow,
            deny,
            detail: if publish { None } else { Some(detail.clone()) },
        });
        Ok(if publish {
            vec![ChatProtocolEvent::Permission(detail)]
        } else {
            vec![]
        })
    }

    fn terminal(&mut self) -> Result<Vec<ChatProtocolEvent>, String> {
        if !self.pending.is_empty() {
            return Err("Permission request cancelled by provider completion".into());
        }
        self.complete = true;
        self.copilot_calls.clear();
        Ok(vec![
            ChatProtocolEvent::Update(StreamUpdate::PartialSnapshot(self.text.clone())),
            ChatProtocolEvent::Complete,
        ])
    }

    fn delta(&mut self, text: &str) -> Vec<ChatProtocolEvent> {
        self.text.push_str(text);
        vec![ChatProtocolEvent::Update(StreamUpdate::PartialDelta(
            text.into(),
        ))]
    }

    fn snapshot(&mut self, text: String) -> Vec<ChatProtocolEvent> {
        self.text = text;
        vec![ChatProtocolEvent::Update(StreamUpdate::PartialSnapshot(
            self.text.clone(),
        ))]
    }

    fn match_scope(&self, value: &Value, key: &str) -> Result<(), String> {
        if self.scope.as_deref() != value[key].as_str() || self.scope.is_none() {
            return Err(format!(
                "Protocol {key} does not match active session/thread"
            ));
        }
        Ok(())
    }
}

fn required<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .filter(|text| !text.is_empty())
        .ok_or_else(|| format!("Protocol missing or invalid {key}"))
}

fn rpc(id: &str, method: &str, params: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
}
