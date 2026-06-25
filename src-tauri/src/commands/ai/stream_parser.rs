use qa_scribe_core::ai::GenerationOutputFormat;
use serde_json::Value;

pub(super) enum StreamUpdate {
    Progress(String),
    Partial(String),
}

pub(super) struct ProviderStreamParser {
    output_format: GenerationOutputFormat,
    assistant_text: String,
}

impl ProviderStreamParser {
    pub(super) fn new(output_format: GenerationOutputFormat) -> Self {
        Self {
            output_format,
            assistant_text: String::new(),
        }
    }

    pub(super) fn push_bytes(&mut self, bytes: &[u8]) -> Vec<StreamUpdate> {
        match self.output_format {
            GenerationOutputFormat::PlainText => self.push_plain(bytes),
            GenerationOutputFormat::CodexJsonl | GenerationOutputFormat::ClaudeStreamJson => {
                self.push_json_line(bytes)
            }
        }
    }

    pub(super) fn finish(self) -> Option<String> {
        let text = self.assistant_text.trim().to_string();
        if text.is_empty() { None } else { Some(text) }
    }

    fn push_plain(&mut self, bytes: &[u8]) -> Vec<StreamUpdate> {
        let text = String::from_utf8_lossy(bytes);
        self.assistant_text.push_str(&text);
        vec![StreamUpdate::Partial(self.assistant_text.clone())]
    }

    fn push_json_line(&mut self, bytes: &[u8]) -> Vec<StreamUpdate> {
        let line = String::from_utf8_lossy(bytes);
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            return vec![StreamUpdate::Progress(
                "Provider emitted output".to_string(),
            )];
        };

        let event_name = stream_event_name(&value);
        if let Some(final_text) = final_text_from_event(&value) {
            self.assistant_text = final_text;
            return vec![StreamUpdate::Partial(self.assistant_text.clone())];
        }

        if let Some(delta) = delta_text_from_event(&value, &event_name) {
            self.assistant_text.push_str(&delta);
            return vec![StreamUpdate::Partial(self.assistant_text.clone())];
        }

        if let Some(snapshot) = snapshot_text_from_event(&value, &event_name)
            && snapshot.len() >= self.assistant_text.len()
        {
            self.assistant_text = snapshot;
            return vec![StreamUpdate::Partial(self.assistant_text.clone())];
        }

        event_name
            .map(|name| StreamUpdate::Progress(provider_event_label(&name)))
            .into_iter()
            .collect()
    }
}

fn stream_event_name(value: &Value) -> Option<String> {
    value
        .get("event")
        .and_then(stream_event_name)
        .or_else(|| value.get("message").and_then(stream_event_name))
        .or_else(|| value.get("msg").and_then(stream_event_name))
        .or_else(|| {
            ["type", "method"]
                .iter()
                .find_map(|key| value.get(*key).and_then(Value::as_str))
                .map(ToString::to_string)
        })
}

fn final_text_from_event(value: &Value) -> Option<String> {
    for key in ["result", "final", "finalMessage", "lastMessage", "output"] {
        if let Some(text) = value.get(key).and_then(Value::as_str)
            && !text.trim().is_empty()
        {
            return Some(text.to_string());
        }
    }

    let event_name = stream_event_name(value).unwrap_or_default();
    if !(event_name.contains("completed")
        || event_name.contains("complete")
        || event_name.contains("result"))
    {
        return None;
    }

    snapshot_text_from_event(value, &Some(event_name))
}

fn delta_text_from_event(value: &Value, event_name: &Option<String>) -> Option<String> {
    let event_name = event_name.as_deref().unwrap_or_default();
    if !(event_name.contains("delta") || event_name.contains("partial")) {
        return None;
    }

    let mut parts = Vec::new();
    collect_delta_strings(value, &mut parts);
    let text = parts.join("");
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

fn snapshot_text_from_event(value: &Value, event_name: &Option<String>) -> Option<String> {
    let event_name = event_name.as_deref().unwrap_or_default();
    if !(event_name.contains("assistant")
        || event_name.contains("message")
        || event_name.contains("completed")
        || event_name.contains("result"))
    {
        return None;
    }

    let candidate = value
        .get("message")
        .or_else(|| value.get("item"))
        .or_else(|| value.get("content"))
        .unwrap_or(value);
    let mut parts = Vec::new();
    collect_text_strings(candidate, &mut parts);
    let text = parts.join("");
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

fn collect_delta_strings(value: &Value, parts: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            if let Some(delta) = map.get("delta") {
                collect_text_strings(delta, parts);
            }
            if let Some(text) = map.get("text").and_then(Value::as_str)
                && map
                    .get("type")
                    .and_then(Value::as_str)
                    .is_some_and(|kind| kind.contains("delta"))
            {
                parts.push(text.to_string());
            }
            for (key, nested) in map {
                if key == "delta" {
                    continue;
                }
                collect_delta_strings(nested, parts);
            }
        }
        Value::Array(values) => {
            for nested in values {
                collect_delta_strings(nested, parts);
            }
        }
        _ => {}
    }
}

fn collect_text_strings(value: &Value, parts: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(Value::as_str) {
                parts.push(text.to_string());
            }
            if let Some(content) = map.get("content") {
                collect_text_strings(content, parts);
            }
            if let Some(delta) = map.get("delta") {
                collect_text_strings(delta, parts);
            }
        }
        Value::Array(values) => {
            for nested in values {
                collect_text_strings(nested, parts);
            }
        }
        Value::String(text) => parts.push(text.clone()),
        _ => {}
    }
}

fn provider_event_label(event_name: &str) -> String {
    match event_name {
        name if name.contains("turn.started") || name.contains("start") => {
            "Provider started".to_string()
        }
        name if name.contains("reason") => "Provider is reasoning".to_string(),
        name if name.contains("tool") || name.contains("command") => {
            "Provider is using local tools".to_string()
        }
        name if name.contains("complete") => "Provider completed response".to_string(),
        _ => "Provider is working".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use qa_scribe_core::ai::GenerationOutputFormat;

    use super::{ProviderStreamParser, StreamUpdate};

    #[test]
    fn stream_parser_accumulates_codex_style_deltas() {
        let mut parser = ProviderStreamParser::new(GenerationOutputFormat::CodexJsonl);

        parser.push_bytes(br#"{"type":"item/agentMessage/delta","delta":"Hello "}"#);
        let updates = parser.push_bytes(br#"{"type":"item/agentMessage/delta","delta":"world"}"#);

        assert!(matches!(
            updates.last(),
            Some(StreamUpdate::Partial(body)) if body == "Hello world"
        ));
        assert_eq!(parser.finish().as_deref(), Some("Hello world"));
    }

    #[test]
    fn stream_parser_prefers_final_result_text() {
        let mut parser = ProviderStreamParser::new(GenerationOutputFormat::ClaudeStreamJson);

        parser.push_bytes(br#"{"type":"content_block_delta","delta":{"text":"draft"}}"#);
        parser.push_bytes(br##"{"type":"result","result":"# Final draft"}"##);

        assert_eq!(parser.finish().as_deref(), Some("# Final draft"));
    }

    #[test]
    fn stream_parser_handles_verbose_claude_text_events() {
        let mut parser = ProviderStreamParser::new(GenerationOutputFormat::ClaudeStreamJson);

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
    fn stream_parser_keeps_plain_text_output() {
        let mut parser = ProviderStreamParser::new(GenerationOutputFormat::PlainText);

        parser.push_bytes(b"line one\n");
        parser.push_bytes(b"line two\n");

        assert_eq!(parser.finish().as_deref(), Some("line one\nline two"));
    }
}
