use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};

use super::{ChatPromptMessage, ChatPromptRole, chat_instructions, validate_chat_messages};
use crate::{
    attachments::chat::{ChatInputImage, MAX_CHAT_REPLAY_IMAGE_BYTES, MAX_CHAT_REPLAY_IMAGES},
    domain::AiProvider,
};

pub const MAX_CHAT_INPUT_FRAME_BYTES: usize = 60 * 1024 * 1024;
pub const CHAT_INPUT_ENVELOPE_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug)]
pub struct ChatInputMessage {
    pub id: String,
    pub role: ChatPromptRole,
    pub text: String,
    pub images: Vec<ChatInputImage>,
}

#[derive(Clone, Debug)]
pub struct ChatInput {
    instructions: String,
    messages: Vec<ChatInputMessage>,
}

impl From<&str> for ChatInput {
    fn from(text: &str) -> Self {
        Self {
            instructions: text.into(),
            messages: vec![],
        }
    }
}

impl From<&ChatInput> for ChatInput {
    fn from(input: &ChatInput) -> Self {
        input.clone()
    }
}

impl ChatInput {
    pub fn has_images(&self) -> bool {
        self.messages
            .iter()
            .any(|message| !message.images.is_empty())
    }

    pub fn provider_error_message(&self, message: &str) -> String {
        if self.has_images() {
            "The provider could not complete this image response. Check its configuration and image support, then retry.".into()
        } else {
            message.to_owned()
        }
    }

    pub fn text(&self) -> String {
        let mut text = self.instructions.clone();
        for message in &self.messages {
            text.push_str(&format!(
                "\nMESSAGE {} {:?}\n{}",
                message.id, message.role, message.text
            ));
        }
        text
    }

    pub fn content_blocks(&self, provider: AiProvider) -> Vec<Value> {
        if !self.has_images() {
            return vec![json!({"type":"text", "text":self.text()})];
        }
        let text_block = |text: String| json!({"type":"text", "text":text});
        let mut blocks = vec![text_block(self.instructions.clone())];
        for message in &self.messages {
            blocks.push(text_block(format!(
                "MESSAGE {} {:?}\n{}",
                message.id, message.role, message.text
            )));
            for (ordinal, image) in message.images.iter().enumerate() {
                blocks.push(text_block(format!(
                    "Image {} for message {}",
                    ordinal + 1,
                    message.id
                )));
                blocks.push(match provider {
                    AiProvider::ClaudeCode => json!({"type":"image","source":{"type":"base64","media_type":image.mime_type,"data":STANDARD.encode(&image.bytes)}}),
                    AiProvider::CodexCli => json!({"type":"localImage","path":image.path}),
                    AiProvider::CopilotCli => json!({"type":"image","mimeType":image.mime_type,"data":STANDARD.encode(&image.bytes)}),
                });
            }
        }
        blocks
    }

    pub fn preflight_wire(&self, provider: AiProvider) -> Result<(), String> {
        if provider == AiProvider::ClaudeCode {
            // https://platform.claude.com/docs/en/build-with-claude/vision
            // Use the smaller partner limit because CLI routing can use Bedrock.
            for image in self.messages.iter().flat_map(|message| &message.images) {
                if image.bytes.len().div_ceil(3) * 4 > 5_000_000
                    || image.width > 8000
                    || image.height > 8000
                {
                    return Err("Claude image input exceeds 5 MB of base64 data or an 8000-pixel dimension. Use a smaller image; your content is retained.".into());
                }
            }
        }
        let content = self.content_blocks(provider);
        let size = serde_json::to_vec(&content)
            .map_err(|error| error.to_string())?
            .len();
        let limit = if provider == AiProvider::ClaudeCode {
            24 * 1024 * 1024
        } else {
            MAX_CHAT_INPUT_FRAME_BYTES
        };
        if size.saturating_add(CHAT_INPUT_ENVELOPE_BYTES) > limit {
            return Err("Chat image replay exceeds the provider input frame budget. Start a new conversation or use smaller images.".into());
        }
        Ok(())
    }
}

pub fn build_chat_input(
    session_context: &str,
    messages: Vec<ChatInputMessage>,
) -> Result<ChatInput, String> {
    let mut count = 0usize;
    let mut bytes = 0usize;
    for message in &messages {
        if message.role == ChatPromptRole::Assistant && !message.images.is_empty() {
            return Err("Assistant messages cannot contain images".into());
        }
        count = count.saturating_add(message.images.len());
        bytes = bytes.saturating_add(
            message
                .images
                .iter()
                .map(|image| image.bytes.len())
                .sum::<usize>(),
        );
    }
    if count > MAX_CHAT_REPLAY_IMAGES || bytes > MAX_CHAT_REPLAY_IMAGE_BYTES {
        return Err("Chat image history exceeds 16 images or 40 MiB. Start a new conversation; prior images will remain in history.".into());
    }
    let projection = messages
        .iter()
        .map(|message| ChatPromptMessage {
            role: message.role,
            text: if message.text.trim().is_empty() && !message.images.is_empty() {
                "[Image-only user message]".into()
            } else {
                message.text.clone()
            },
        })
        .collect::<Vec<_>>();
    validate_chat_messages(session_context, &projection)?;
    let instructions = chat_instructions()
        .trim_end_matches("\nTRANSCRIPT_JSON")
        .replace("TRANSCRIPT_JSON", "the labelled messages below");
    let context = serde_json::to_string(session_context).map_err(|error| error.to_string())?;
    Ok(ChatInput {
        instructions: format!("{instructions}\nSESSION_CONTEXT_JSON\n{context}"),
        messages,
    })
}
