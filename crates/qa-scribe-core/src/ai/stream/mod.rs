//! Per-format streaming parsers for provider CLI stdout.
//!
//! Each [`GenerationOutputFormat`] has its own parser keyed on that format's
//! event shapes; [`ProviderStreamParser`] dispatches to the right one. The
//! parsers turn raw stdout lines into [`StreamUpdate`]s and accumulate the
//! assistant's final text.

mod claude;
mod codex;
mod plain;

use serde_json::Value;

use super::GenerationOutputFormat;
use claude::ClaudeStreamJsonParser;
use codex::CodexJsonlParser;
use plain::PlainTextParser;

/// A user-visible update produced while streaming provider output.
#[derive(Clone, Debug)]
pub enum StreamUpdate {
    /// A short status message describing what the provider is doing.
    Progress(String),
    /// The accumulated assistant text so far.
    Partial(String),
}

/// Streaming parser for provider CLI stdout, dispatching per output format.
pub struct ProviderStreamParser(FormatParser);

enum FormatParser {
    Plain(PlainTextParser),
    Codex(CodexJsonlParser),
    Claude(ClaudeStreamJsonParser),
}

impl ProviderStreamParser {
    pub fn new(output_format: GenerationOutputFormat) -> Self {
        Self(match output_format {
            GenerationOutputFormat::PlainText => FormatParser::Plain(PlainTextParser::default()),
            GenerationOutputFormat::CodexJsonl => FormatParser::Codex(CodexJsonlParser::default()),
            GenerationOutputFormat::ClaudeStreamJson => {
                FormatParser::Claude(ClaudeStreamJsonParser::default())
            }
        })
    }

    /// Feed one stdout chunk (one line for the JSONL formats) to the parser.
    pub fn push_bytes(&mut self, bytes: &[u8]) -> Vec<StreamUpdate> {
        match &mut self.0 {
            FormatParser::Plain(parser) => parser.push_bytes(bytes),
            FormatParser::Codex(parser) => {
                push_json_line(parser, bytes, CodexJsonlParser::push_event)
            }
            FormatParser::Claude(parser) => {
                push_json_line(parser, bytes, ClaudeStreamJsonParser::push_event)
            }
        }
    }

    /// Consume the parser, returning the accumulated assistant text if any.
    pub fn finish(self) -> Option<String> {
        match self.0 {
            FormatParser::Plain(parser) => parser.finish(),
            FormatParser::Codex(parser) => parser.finish(),
            FormatParser::Claude(parser) => parser.finish(),
        }
    }
}

/// Shared JSONL line handling: skip blank lines, report unparseable ones, and
/// hand parsed events to the format-specific parser.
fn push_json_line<P>(
    parser: &mut P,
    bytes: &[u8],
    push_event: impl FnOnce(&mut P, &Value) -> Vec<StreamUpdate>,
) -> Vec<StreamUpdate> {
    let line = String::from_utf8_lossy(bytes);
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    match serde_json::from_str::<Value>(trimmed) {
        Ok(value) => push_event(parser, &value),
        Err(_) => vec![StreamUpdate::Progress(
            "Provider emitted output".to_string(),
        )],
    }
}

/// Accumulated assistant text with the final-text guard: replacement text may
/// never shrink already-accumulated output, so a short trailing event (e.g. a
/// completed reasoning item) cannot clobber the real answer.
#[derive(Default)]
struct AssistantText(String);

impl AssistantText {
    fn append(&mut self, delta: &str) -> StreamUpdate {
        self.0.push_str(delta);
        StreamUpdate::Partial(self.0.clone())
    }

    fn replace_if_not_shorter(&mut self, candidate: String) -> Option<StreamUpdate> {
        if self.0.is_empty() || candidate.len() >= self.0.len() {
            self.0 = candidate;
            Some(StreamUpdate::Partial(self.0.clone()))
        } else {
            None
        }
    }

    fn finish(self) -> Option<String> {
        let text = self.0.trim().to_string();
        if text.is_empty() { None } else { Some(text) }
    }
}

/// Map a provider event name to a short user-facing progress label.
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

fn progress_for_event(event_name: Option<&str>) -> Vec<StreamUpdate> {
    event_name
        .map(|name| StreamUpdate::Progress(provider_event_label(name)))
        .into_iter()
        .collect()
}

/// Collect assistant-visible text from a JSON payload: `text` fields plus
/// anything nested under `content`/`delta`, and bare strings.
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

fn joined_text(value: &Value) -> Option<String> {
    let mut parts = Vec::new();
    collect_text_strings(value, &mut parts);
    let text = parts.join("");
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}
