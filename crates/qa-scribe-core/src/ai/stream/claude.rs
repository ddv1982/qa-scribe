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
//!   snapshot; replaces the accumulated text when not shorter.
//! * `{"type":"result","result":"..."}` — the final result. The final-text
//!   guard still applies: multi-turn runs stream more text than the last
//!   turn's result, and the longer accumulation wins.

use serde_json::Value;

use super::{AssistantText, StreamUpdate, joined_text, progress_for_event};

#[derive(Default)]
pub(super) struct ClaudeStreamJsonParser {
    assistant_text: AssistantText,
}

impl ClaudeStreamJsonParser {
    pub(super) fn push_event(&mut self, value: &Value) -> Vec<StreamUpdate> {
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
        if event_type == Some("content_block_delta")
            && let Some(delta) = event.get("delta").and_then(joined_text)
        {
            return vec![self.assistant_text.append(&delta)];
        }
        progress_for_event(event_type)
    }

    fn replace_or_progress(
        &mut self,
        candidate: Option<String>,
        event_type: Option<&str>,
    ) -> Vec<StreamUpdate> {
        candidate
            .and_then(|text| self.assistant_text.replace_if_not_shorter(text))
            .map(|update| vec![update])
            .unwrap_or_else(|| progress_for_event(event_type))
    }

    pub(super) fn finish(self) -> Option<String> {
        self.assistant_text.finish()
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
            Some(StreamUpdate::Partial(body)) if body == "<p>ok</p>"
        ));
        assert_eq!(parser.finish().as_deref(), Some("<p>ok</p>"));
    }

    #[test]
    fn assistant_message_snapshot_cannot_shrink_accumulated_text() {
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

        assert_eq!(parser.finish().as_deref(), Some(long_answer));
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
