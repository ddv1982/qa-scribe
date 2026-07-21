//! Parser for Codex CLI's `exec --json` JSONL events.
//!
//! One JSON object per line. The events this parser keys on:
//!
//! * delta events (`item/agentMessage/delta`, legacy `agent_message_delta`
//!   inside a `msg` wrapper) — appended assistant text;
//! * completed `agent_message` items — the assistant response snapshot;
//! * every other lifecycle, reasoning, command, tool, or unknown event —
//!   progress only, regardless of any text-like fields it contains.

use serde_json::Value;

use super::{AssistantText, StreamUpdate, progress_for_event};

#[derive(Default)]
pub(super) struct CodexJsonlParser {
    assistant_text: AssistantText,
}

impl CodexJsonlParser {
    pub(super) fn push_event(&mut self, value: &Value) -> Vec<StreamUpdate> {
        let modern_event = value.get("type").and_then(Value::as_str);
        let legacy_message = value.get("msg");
        let legacy_event = legacy_message
            .and_then(|message| message.get("type"))
            .and_then(Value::as_str);

        if legacy_message.is_none() {
            match modern_event {
                Some("item/agentMessage/delta") => {
                    if let Some(delta) = value.get("delta").and_then(non_empty_string) {
                        return vec![self.assistant_text.append(delta)];
                    }
                }
                Some("item.completed") => {
                    if let Some(snapshot) = completed_agent_message_text(value)
                        && let Some(update) = self
                            .assistant_text
                            .replace_if_not_shorter(snapshot.to_string())
                    {
                        return vec![update];
                    }
                }
                _ => {}
            }
        } else if modern_event.is_none()
            && legacy_event == Some("agent_message_delta")
            && let Some(delta) = legacy_message
                .and_then(|message| message.get("delta"))
                .and_then(non_empty_string)
        {
            return vec![self.assistant_text.append(delta)];
        }

        progress_for_event(modern_event.or(legacy_event))
    }

    pub(super) fn finish(self) -> Option<String> {
        self.assistant_text.finish()
    }
}

fn non_empty_string(value: &Value) -> Option<&str> {
    value.as_str().filter(|text| !text.trim().is_empty())
}

fn completed_agent_message_text(value: &Value) -> Option<&str> {
    let item = value.get("item")?;
    if item.get("type").and_then(Value::as_str) != Some("agent_message") {
        return None;
    }
    item.get("text").and_then(non_empty_string)
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
    fn unknown_result_event_cannot_replace_streamed_assistant_text() {
        let mut parser = parser();

        parser.push_bytes(br#"{"type":"item/agentMessage/delta","delta":"partial"}"#);
        parser
            .push_bytes(br#"{"type":"result","result":"The complete but unknown response shape"}"#);

        assert_eq!(parser.finish().as_deref(), Some("partial"));
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

    #[test]
    fn unknown_text_like_fields_never_become_assistant_content() {
        let mut parser = parser();

        for event in [
            br#"{"type":"future.response","output":"unknown output"}"#.as_slice(),
            br#"{"type":"turn.completed","result":"unknown result"}"#.as_slice(),
            br#"{"method":"item/agentMessage/delta","delta":"json-rpc text"}"#.as_slice(),
            br#"{"type":"item/agentMessage/partial","delta":"unknown partial"}"#.as_slice(),
        ] {
            parser.push_bytes(event);
        }

        assert_eq!(parser.finish(), None);
    }

    #[test]
    fn reasoning_and_tool_deltas_never_become_assistant_content() {
        let mut parser = parser();

        for event in [
            br#"{"type":"item/reasoning/delta","delta":"private reasoning"}"#.as_slice(),
            br#"{"type":"item/tool/delta","delta":"tool output"}"#.as_slice(),
            br#"{"type":"item/command/delta","delta":"command output"}"#.as_slice(),
            br#"{"type":"item/agentMessage/delta","delta":{"text":"nested unknown delta"}}"#
                .as_slice(),
        ] {
            parser.push_bytes(event);
        }

        assert_eq!(parser.finish(), None);
    }

    #[test]
    fn non_agent_completed_items_never_become_assistant_content() {
        let mut parser = parser();

        for event in [
            br#"{"type":"item.completed","item":{"type":"reasoning","text":"reasoning"}}"#.as_slice(),
            br#"{"type":"item.completed","item":{"type":"tool_message","text":"tool"}}"#.as_slice(),
            br#"{"type":"item.completed","item":{"type":"user_message","text":"user"}}"#.as_slice(),
            br#"{"type":"item.completed","item":{"item_type":"agent_message","text":"legacy guess"}}"#.as_slice(),
        ] {
            parser.push_bytes(event);
        }

        assert_eq!(parser.finish(), None);
    }

    #[test]
    fn modern_and_legacy_envelopes_cannot_be_spliced() {
        let mut parser = parser();

        for event in [
            br#"{"type":"future.event","delta":"spliced top delta","msg":{"type":"item/agentMessage/delta"}}"#.as_slice(),
            br#"{"type":"item/agentMessage/delta","delta":"modern delta","msg":{"type":"progress"}}"#.as_slice(),
            br#"{"type":"future.event","msg":{"type":"agent_message_delta","delta":"legacy delta"}}"#.as_slice(),
            br#"{"type":"item.completed","item":{"type":"agent_message","text":"modern snapshot"},"msg":{"type":"progress"}}"#.as_slice(),
        ] {
            parser.push_bytes(event);
        }

        assert_eq!(parser.finish(), None);
    }
}
