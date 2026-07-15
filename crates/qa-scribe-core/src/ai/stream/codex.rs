//! Parser for Codex CLI's `exec --json` JSONL events.
//!
//! One JSON object per line. The events this parser keys on:
//!
//! * explicit final-text keys (`result`, `final`, `finalMessage`,
//!   `lastMessage`, `output`) — the full answer, subject to the final-text
//!   guard (Codex does not guarantee such an event, so a genuine final may
//!   replace but never shrink the accumulated text);
//! * delta events (`item/agentMessage/delta`, legacy `agent_message_delta`
//!   inside a `msg` wrapper) — appended assistant text;
//! * `item.*` lifecycle events — only agent-message items carry assistant
//!   text; reasoning/command items must never clobber the answer and are
//!   reported as progress instead.

use serde_json::Value;

use super::{AssistantText, StreamUpdate, joined_text, progress_for_event};

const FINAL_TEXT_KEYS: [&str; 5] = ["result", "final", "finalMessage", "lastMessage", "output"];

#[derive(Default)]
pub(super) struct CodexJsonlParser {
    assistant_text: AssistantText,
}

impl CodexJsonlParser {
    pub(super) fn push_event(&mut self, value: &Value) -> Vec<StreamUpdate> {
        let event_name = event_name(value);
        let name = event_name.as_deref().unwrap_or_default();

        if let Some(final_text) = explicit_final_text(value)
            && let Some(update) = self.assistant_text.replace_if_not_shorter(final_text)
        {
            return vec![update];
        }

        if (name.contains("delta") || name.contains("partial"))
            && let Some(delta) = delta_text(value)
        {
            return vec![self.assistant_text.append(&delta)];
        }

        if let Some(item) = value.get("item")
            && item_kind(item).is_some_and(|kind| kind.contains("message"))
            && let Some(snapshot) = joined_text(item)
            && let Some(update) = self.assistant_text.replace_if_not_shorter(snapshot)
        {
            return vec![update];
        }

        progress_for_event(event_name.as_deref())
    }

    pub(super) fn finish(self) -> Option<String> {
        self.assistant_text.finish()
    }
}

/// Event name from the modern `type` key, the legacy `msg.type` wrapper, or a
/// JSON-RPC style `method` key.
fn event_name(value: &Value) -> Option<String> {
    value
        .get("msg")
        .and_then(|msg| msg.get("type"))
        .or_else(|| value.get("type"))
        .or_else(|| value.get("method"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn explicit_final_text(value: &Value) -> Option<String> {
    FINAL_TEXT_KEYS.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .filter(|text| !text.trim().is_empty())
            .map(ToString::to_string)
    })
}

fn delta_text(value: &Value) -> Option<String> {
    value
        .get("delta")
        .or_else(|| value.get("msg").and_then(|msg| msg.get("delta")))
        .and_then(joined_text)
}

fn item_kind(item: &Value) -> Option<&str> {
    item.get("type")
        .or_else(|| item.get("item_type"))
        .and_then(Value::as_str)
}

#[cfg(test)]
mod tests {
    use crate::ai::{
        GenerationOutputFormat,
        stream::{ProviderStreamParser, StreamUpdate},
    };

    fn parser() -> ProviderStreamParser {
        ProviderStreamParser::new(GenerationOutputFormat::CodexJsonl)
    }

    #[test]
    fn stream_parser_accumulates_codex_style_deltas() {
        let mut parser = parser();

        parser.push_bytes(br#"{"type":"item/agentMessage/delta","delta":"Hello "}"#);
        let updates = parser.push_bytes(br#"{"type":"item/agentMessage/delta","delta":"world"}"#);

        assert!(matches!(
            updates.last(),
            Some(StreamUpdate::PartialDelta(body)) if body == "world"
        ));
        assert_eq!(parser.finish().as_deref(), Some("Hello world"));
    }

    #[test]
    fn stream_parser_does_not_let_short_completed_item_clobber_long_answer() {
        let mut parser = parser();

        let long_answer = "This is the real, complete answer with plenty of detail.";
        parser.push_bytes(
            format!(r#"{{"type":"item/agentMessage/delta","delta":"{long_answer}"}}"#).as_bytes(),
        );

        // A reasoning/tool item completion event with a short nested `text`
        // field must not overwrite the accumulated long answer.
        let updates = parser
            .push_bytes(br#"{"type":"item.completed","item":{"type":"reasoning","text":"ok"}}"#);

        assert!(
            updates.is_empty()
                || matches!(
                    updates.last(),
                    Some(StreamUpdate::Progress(_))
                        | Some(StreamUpdate::PartialDelta(_))
                        | Some(StreamUpdate::PartialSnapshot(_))
                )
        );
        assert_eq!(parser.finish().as_deref(), Some(long_answer));
    }

    #[test]
    fn stream_parser_genuine_final_result_still_replaces_streamed_partials() {
        let mut parser = parser();

        parser.push_bytes(br#"{"type":"item/agentMessage/delta","delta":"partial"}"#);

        let full_answer = "The complete final answer, longer than the partial streamed text.";
        let updates = parser
            .push_bytes(format!(r#"{{"type":"result","result":"{full_answer}"}}"#).as_bytes());

        assert!(matches!(
            updates.last(),
            Some(StreamUpdate::PartialSnapshot(body)) if body == full_answer
        ));
        assert_eq!(parser.finish().as_deref(), Some(full_answer));
    }

    #[test]
    fn completed_agent_message_item_provides_the_answer() {
        let mut parser = parser();

        let updates = parser.push_bytes(
            br#"{"type":"item.completed","item":{"type":"agent_message","text":"<h2>Cases</h2>"}}"#,
        );

        assert!(matches!(
            updates.last(),
            Some(StreamUpdate::PartialSnapshot(body)) if body == "<h2>Cases</h2>"
        ));
        assert_eq!(parser.finish().as_deref(), Some("<h2>Cases</h2>"));
    }

    #[test]
    fn legacy_msg_wrapped_deltas_accumulate() {
        let mut parser = parser();

        parser.push_bytes(br#"{"id":"1","msg":{"type":"agent_message_delta","delta":"Hi "}}"#);
        let updates = parser
            .push_bytes(br#"{"id":"1","msg":{"type":"agent_message_delta","delta":"there"}}"#);

        assert!(matches!(
            updates.last(),
            Some(StreamUpdate::PartialDelta(body)) if body == "there"
        ));
        assert_eq!(parser.finish().as_deref(), Some("Hi there"));
    }
}
