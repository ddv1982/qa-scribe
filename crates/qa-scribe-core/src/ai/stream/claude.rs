//! Parser for Claude Code's `--output-format stream-json` events.
//!
//! One JSON object per line. The events this parser keys on:
//!
//! * `{"type":"system",...}` — lifecycle notices (init and friends).
//! * `{"type":"stream_event","event":{...}}` — wrapped Anthropic API stream
//!   events (emitted with `--include-partial-messages`); text arrives as
//!   `content_block_delta` events carrying `delta.text`. Older CLI builds
//!   emitted the inner event unwrapped, which is also accepted.
//! * `{"type":"assistant","message":{...}}` — a full assistant message
//!   snapshot; replaces the current assistant message's accumulated text.
//! * `{"type":"result","result":"..."}` — the final result. The final-text
//!   result is authoritative, even when shorter than a tool-call preamble.

use serde_json::Value;

use super::{StreamUpdate, joined_text, progress_for_event};

#[derive(Default)]
pub(super) struct ClaudeStreamJsonParser {
    assistant_text: String,
    pub(super) model_report: Option<crate::domain::ReportedModel>,
}

impl ClaudeStreamJsonParser {
    pub(super) fn push_event(&mut self, value: &Value) -> Vec<StreamUpdate> {
        if let Some(report) = crate::ai::model_report::claude_model_report(value) {
            report.retain_in(&mut self.model_report);
        }
        let event_type = value.get("type").and_then(Value::as_str);
        match event_type {
            Some("stream_event") => {
                let Some(event) = value.get("event") else {
                    return progress_for_event(event_type);
                };
                self.push_api_event(event)
            }
            Some("assistant") => {
                let snapshot = value.get("message").and_then(joined_text);
                self.replace_or_progress(snapshot, event_type)
            }
            Some("result") => {
                let final_text = value
                    .get("result")
                    .and_then(Value::as_str)
                    .filter(|text| !text.trim().is_empty())
                    .map(ToString::to_string);
                self.replace_or_progress(final_text, event_type)
            }
            // Bare Anthropic API events (older CLI builds emit them unwrapped).
            Some(name) if name.starts_with("content_block") || name.starts_with("message_") => {
                self.push_api_event(value)
            }
            _ => progress_for_event(event_type),
        }
    }

    /// Handle an Anthropic API stream event (`message_start`,
    /// `content_block_delta`, ...). Only text deltas carry assistant text;
    /// everything else is progress.
    fn push_api_event(&mut self, event: &Value) -> Vec<StreamUpdate> {
        let event_type = event.get("type").and_then(Value::as_str);
        if event_type == Some("message_start") {
            self.assistant_text.clear();
            return vec![StreamUpdate::PartialSnapshot(String::new())];
        }
        if event_type == Some("content_block_delta")
            && let Some(delta) = event.get("delta").and_then(joined_text)
        {
            self.assistant_text.push_str(&delta);
            return vec![StreamUpdate::PartialDelta(delta)];
        }
        progress_for_event(event_type)
    }

    fn replace_or_progress(
        &mut self,
        candidate: Option<String>,
        event_type: Option<&str>,
    ) -> Vec<StreamUpdate> {
        candidate
            .map(|text| {
                self.assistant_text = text.clone();
                vec![StreamUpdate::PartialSnapshot(text)]
            })
            .unwrap_or_else(|| progress_for_event(event_type))
    }

    pub(super) fn finish(self) -> Option<String> {
        let text = self.assistant_text.trim().to_string();
        if text.is_empty() { None } else { Some(text) }
    }
}

#[cfg(test)]
mod tests {
    use crate::ai::{
        GenerationOutputFormat,
        stream::{ProviderStreamParser, StreamUpdate},
    };

    fn parser() -> ProviderStreamParser {
        ProviderStreamParser::new(GenerationOutputFormat::ClaudeStreamJson)
    }

    #[test]
    fn stream_parser_prefers_final_result_text() {
        let mut parser = parser();

        parser.push_bytes(br#"{"type":"content_block_delta","delta":{"text":"draft"}}"#);
        parser.push_bytes(br##"{"type":"result","result":"# Final draft"}"##);

        assert_eq!(parser.finish().as_deref(), Some("# Final draft"));
    }

    #[test]
    fn stream_parser_handles_verbose_claude_text_events() {
        let mut parser = parser();

        parser.push_bytes(br#"{"type":"system","subtype":"init","model":"claude"}"#);
        parser.push_bytes(
            br#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"reasoning"}}}"#,
        );
        let updates = parser.push_bytes(
            br#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"<p>ok</p>"}}}"#,
        );

        assert!(matches!(
            updates.last(),
            Some(StreamUpdate::PartialDelta(body)) if body == "<p>ok</p>"
        ));
        assert_eq!(parser.finish().as_deref(), Some("<p>ok</p>"));
    }

    #[test]
    fn chat_tools_final_result_replaces_long_tool_preamble() {
        let mut parser = parser();

        let long_answer = "The full answer streamed across two turns with detail.";
        parser.push_bytes(
            format!(
                r#"{{"type":"stream_event","event":{{"type":"content_block_delta","delta":{{"type":"text_delta","text":"{long_answer}"}}}}}}"#
            )
            .as_bytes(),
        );
        parser.push_bytes(
            br#"{"type":"assistant","message":{"content":[{"type":"text","text":"short"}]}}"#,
        );

        parser.push_bytes(br#"{"type":"result","subtype":"success","result":"Done."}"#);
        assert_eq!(parser.finish().as_deref(), Some("Done."));
    }

    #[test]
    fn result_without_text_yields_progress_only() {
        let mut parser = parser();

        parser.push_bytes(br#"{"type":"stream_event","event":{"type":"message_start"}}"#);
        let updates = parser.push_bytes(br#"{"type":"result","subtype":"error_during_execution"}"#);

        assert!(matches!(updates.last(), Some(StreamUpdate::Progress(_))));
        assert_eq!(parser.finish(), None);
    }
}
