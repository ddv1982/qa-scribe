//! Stateful wire adapters. Opaque permission IDs and arguments stay in core.
mod claude;
mod codex;
mod copilot;
mod error;
pub use error::{ProtocolError, ProtocolErrorKind};
#[cfg(test)]
mod tests;

use super::stream::StreamUpdate;
use crate::domain::{AiProvider, ReportedModel};
use serde_json::{Value, json};
use std::collections::VecDeque;

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
    provider: ProviderProtocol,
    output: TurnData,
}

enum ProviderProtocol {
    Claude(claude::ClaudeProtocol),
    Codex(codex::CodexProtocol),
    Copilot(copilot::CopilotProtocol),
}

struct TurnData {
    pending: VecDeque<Pending>,
    seen: Vec<Value>,
    text: String,
    reported: Option<ReportedModel>,
    complete: bool,
    failure: Option<ProtocolError>,
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
        let failure = effort
            .as_ref()
            .err()
            .cloned()
            .map(ProtocolError::InvalidFrame);
        let provider = match provider {
            AiProvider::ClaudeCode => ProviderProtocol::Claude(claude::ClaudeProtocol::new(prompt)),
            AiProvider::CodexCli => ProviderProtocol::Codex(codex::CodexProtocol::new(
                prompt,
                model,
                effort.ok().flatten(),
                cwd,
            )),
            AiProvider::CopilotCli => {
                ProviderProtocol::Copilot(copilot::CopilotProtocol::new(prompt, cwd))
            }
        };
        Self {
            provider,
            output: TurnData {
                pending: VecDeque::new(),
                seen: Vec::new(),
                text: String::new(),
                reported: None,
                complete: false,
                failure,
            },
        }
    }

    pub fn initial_message(&self) -> Value {
        match &self.provider {
            ProviderProtocol::Claude(provider) => provider.initial_message(),
            ProviderProtocol::Codex(provider) => provider.initial_message(),
            ProviderProtocol::Copilot(provider) => provider.initial_message(),
        }
    }

    pub fn handle(&mut self, event: &Value) -> Result<Vec<ChatProtocolEvent>, ProtocolError> {
        if let Some(error) = &self.output.failure {
            return Err(error.clone());
        }
        if self.output.complete {
            return self.output.fail(ProtocolError::InvalidFrame(
                "Protocol event received after completion".into(),
            ));
        }
        let result = match &mut self.provider {
            ProviderProtocol::Claude(provider) => provider.handle(&mut self.output, event),
            ProviderProtocol::Codex(provider) => provider.handle(&mut self.output, event),
            ProviderProtocol::Copilot(provider) => provider.handle(&mut self.output, event),
        };
        if (result.is_err() || self.output.complete)
            && let ProviderProtocol::Copilot(provider) = &mut self.provider
        {
            provider.clear_metadata();
        }
        result.or_else(|error| self.output.fail(error))
    }

    pub fn permission_reply(&mut self, approved: bool) -> Result<Value, ProtocolError> {
        self.output.permission_reply(approved)
    }

    pub fn finish(&self) -> Result<String, ProtocolError> {
        self.output.finish()
    }

    pub fn model_report(&self) -> Option<ReportedModel> {
        self.output.reported.clone()
    }

    /// Publish the next queued prompt without consuming its correlated reply.
    pub fn take_queued_permission(&mut self) -> Option<ChatProtocolPermission> {
        self.output.pending.front_mut()?.detail.take()
    }
}

impl TurnData {
    fn permission_reply(&mut self, approved: bool) -> Result<Value, ProtocolError> {
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
            return Err(ProtocolError::InvalidFrame(
                "Permission decision has no offered once-only option".into(),
            ));
        }
        let Some(pending) = self.pending.pop_front() else {
            return Err(ProtocolError::InvalidFrame(
                "No pending permission request".into(),
            ));
        };
        self.seen.push(pending.id);
        let reply = if approved {
            pending.allow
        } else {
            pending.deny
        };
        match reply {
            Some(reply) => Ok(reply),
            None => self.fail(ProtocolError::InvalidFrame(
                "Permission decision has no offered once-only option".into(),
            )),
        }
    }

    fn finish(&self) -> Result<String, ProtocolError> {
        if let Some(error) = &self.failure {
            return Err(error.clone());
        }
        if !self.complete || !self.pending.is_empty() {
            return Err(ProtocolError::IncompleteStream(
                "Chat protocol ended without successful completion".into(),
            ));
        }
        if self.text.trim().is_empty() {
            return Err(ProtocolError::IncompleteStream(
                "Provider returned no assistant text".into(),
            ));
        }
        Ok(self.text.clone())
    }

    fn fail<T>(&mut self, error: ProtocolError) -> Result<T, ProtocolError> {
        self.pending.clear();
        self.failure = Some(error.clone());
        Err(error)
    }

    fn permission(
        &mut self,
        id: &Value,
        allow: Option<Value>,
        deny: Option<Value>,
        detail: ChatProtocolPermission,
    ) -> Result<Vec<ChatProtocolEvent>, ProtocolError> {
        if !(id.is_string() || id.is_number()) || id.as_str() == Some("") {
            return Err(ProtocolError::InvalidFrame(
                "Permission request has invalid opaque ID".into(),
            ));
        }
        if self.pending.iter().any(|pending| pending.id == *id) || self.seen.contains(id) {
            return Err(ProtocolError::InvalidFrame(
                "Duplicate or stale permission request".into(),
            ));
        }
        if self.pending.len() >= 32 {
            return Err(ProtocolError::InvalidFrame(
                "Too many pending permission requests (maximum 32)".into(),
            ));
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

    fn terminal(&mut self) -> Result<Vec<ChatProtocolEvent>, ProtocolError> {
        if !self.pending.is_empty() {
            return Err(ProtocolError::ProviderFailure(
                "Permission request cancelled by provider completion".into(),
            ));
        }
        self.complete = true;
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
}

fn required<'a>(value: &'a Value, key: &str) -> Result<&'a str, ProtocolError> {
    value[key]
        .as_str()
        .filter(|text| !text.is_empty())
        .ok_or_else(|| ProtocolError::InvalidFrame(format!("Protocol missing or invalid {key}")))
}

fn rpc(id: &str, method: &str, params: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
}
