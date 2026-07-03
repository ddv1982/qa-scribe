//! Plain-text stream parser: the fallback for providers without a structured
//! streaming format (currently GitHub Copilot CLI and non-streaming runs).

use super::{AssistantText, StreamUpdate};

#[derive(Default)]
pub(super) struct PlainTextParser {
    assistant_text: AssistantText,
}

impl PlainTextParser {
    pub(super) fn push_bytes(&mut self, bytes: &[u8]) -> Vec<StreamUpdate> {
        let text = String::from_utf8_lossy(bytes);
        vec![self.assistant_text.append(&text)]
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

    #[test]
    fn stream_parser_keeps_plain_text_output() {
        let mut parser = ProviderStreamParser::new(GenerationOutputFormat::PlainText);

        parser.push_bytes(b"line one\n");
        let updates = parser.push_bytes(b"line two\n");

        assert!(matches!(
            updates.last(),
            Some(StreamUpdate::Partial(body)) if body == "line one\nline two\n"
        ));
        assert_eq!(parser.finish().as_deref(), Some("line one\nline two"));
    }
}
