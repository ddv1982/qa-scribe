use crate::domain::{AiProvider, ReportedModel};
use serde_json::Value;

pub(super) fn claude_model_report(event: &Value) -> Option<ReportedModel> {
    if event
        .get("parent_tool_use_id")
        .is_some_and(|parent| !parent.is_null())
    {
        return None;
    }
    let report = match event["type"].as_str()? {
        "system" if event["subtype"] == "init" => ReportedModel::ClaudeInitialization {
            id: report_id(&event["model"])?,
        },
        "assistant" if event["message"]["content"].is_array() => {
            ReportedModel::ClaudeAssistantMessage {
                id: report_id(&event["message"]["model"])?,
            }
        }
        "stream_event"
            if event["event"]["type"] == "message_start"
                && event["event"]["message"]["type"] == "message"
                && event["event"]["message"]["role"] == "assistant" =>
        {
            ReportedModel::ClaudeAssistantMessage {
                id: report_id(&event["event"]["message"]["model"])?,
            }
        }
        _ => return None,
    };
    report.valid_for(AiProvider::ClaudeCode).then_some(report)
}

pub(super) fn report_id(value: &Value) -> Option<String> {
    let id = value.as_str()?;
    if id.chars().any(char::is_control) {
        return None;
    }
    let id = id.trim();
    (!id.is_empty() && id.chars().count() <= 240).then(|| id.to_string())
}
