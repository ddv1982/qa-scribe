use std::path::Path;

use qa_scribe_core::{
    QaScribeError, Result,
    attachments::chat::{
        ChatImageSource, ChatInputImage, MAX_CHAT_REPLAY_IMAGE_BYTES, MAX_CHAT_REPLAY_IMAGES,
        MAX_CHAT_TURN_IMAGE_BYTES, MAX_CHAT_TURN_IMAGES, chat_image_source,
        resolve_chat_image_source,
    },
    chat::{
        ChatInput, ChatInputMessage, ChatPromptMessage, ChatPromptRole, MAX_CHAT_MESSAGES,
        MAX_CHAT_TRANSCRIPT_BYTES, build_chat_input, build_chat_prompt,
    },
    domain::*,
    services::SessionService,
};

use super::{StartChatJobRequest, lifecycle::scope};

pub(super) struct ChatPreparationSnapshot {
    revision: ChatRevision,
    intent: ChatRequestIntent,
    composer_intent: ChatComposerIntent,
    context: String,
    messages: Vec<ChatInputMessage>,
    sources: Vec<Vec<ChatImageSource>>,
}

pub(super) struct VerifiedChatPreparation {
    snapshot: ChatPreparationSnapshot,
    messages: Vec<ChatInputMessage>,
}

fn changed() -> QaScribeError {
    QaScribeError::Validation("Chat changed. Reload the conversation before retrying.".into())
}

impl ChatPreparationSnapshot {
    pub fn capture(service: &SessionService, request: &StartChatJobRequest) -> Result<Self> {
        let mut chat = service.read_chat(&ChatRef {
            session_id: request.scope.session_id.clone(),
            draft_id: request.scope.draft_id.clone(),
        })?;
        let intent = request.intent.resolve(chat.composer_intent);
        let composer_intent = chat.composer_intent;
        if scope(&chat) != request.scope {
            return Err(changed());
        }
        let revision = scope(&chat);
        let context = service
            .get_session(&chat.session_id)?
            .ok_or_else(|| QaScribeError::NotFound(chat.session_id.clone()))?
            .session_context
            .unwrap_or_default();
        if !matches!(intent, ChatRequestIntent::Retry) {
            if chat.messages.len().saturating_add(2) > MAX_CHAT_MESSAGES {
                return Err(QaScribeError::Validation(
                    "Chat has reached its message limit. Start a new conversation.".into(),
                ));
            }
            if chat
                .messages
                .iter()
                .map(|m| qa_scribe_core::services::readable_chat_message(m).len())
                .sum::<usize>()
                .saturating_add(chat.composer.len())
                > MAX_CHAT_TRANSCRIPT_BYTES
            {
                return Err(QaScribeError::Validation(
                    "Chat has reached its text limit. Start a new conversation.".into(),
                ));
            }
            let resolved = service.prepare_chat_message(&chat, request.context.clone(), &intent)?;
            chat.messages.push(ChatMessage {
                response: None,
                answer: None,
                context: resolved.context,
                id: uuid::Uuid::nil().to_string(),
                turn_id: String::new(),
                role: ChatRole::User,
                text: resolved.text,
                images: resolved.images,
                status: ChatTurnStatus::Running,
                error_message: None,
                ai_run_id: None,
                created_at: String::new(),
            });
        }
        if matches!(intent, ChatRequestIntent::Retry) {
            let message = chat.messages.last().ok_or_else(changed)?;
            service.validate_chat_context_anchor(&chat, &message.context)?;
            service.validate_chat_retry_context_owner(&chat.session_id, &message.context)?;
        }
        let messages = chat
            .messages
            .iter()
            .enumerate()
            .filter(|(index, message)| {
                message.status == ChatTurnStatus::Completed
                    || (*index + 1 == chat.messages.len() && message.role == ChatRole::User)
            })
            .map(|(_, message)| message)
            .collect::<Vec<_>>();
        let count = messages.iter().map(|m| m.images.len()).sum::<usize>();
        let bytes = messages
            .iter()
            .flat_map(|m| &m.images)
            .try_fold(0u64, |total, image| {
                u64::try_from(image.size_bytes)
                    .ok()
                    .and_then(|bytes| total.checked_add(bytes))
            })
            .unwrap_or(u64::MAX);
        if count > MAX_CHAT_REPLAY_IMAGES || bytes > MAX_CHAT_REPLAY_IMAGE_BYTES as u64 {
            return Err(QaScribeError::Validation("Chat image history exceeds 16 images or 40 MiB. Start a new conversation; prior images will remain in history.".into()));
        }
        for message in &messages {
            if message.images.len() > MAX_CHAT_TURN_IMAGES
                || message
                    .images
                    .iter()
                    .map(|i| i.size_bytes as u64)
                    .sum::<u64>()
                    > MAX_CHAT_TURN_IMAGE_BYTES as u64
            {
                return Err(QaScribeError::Validation(
                    "Chat turn exceeds 4 images or 20 MiB".into(),
                ));
            }
            if message.role == ChatRole::Assistant && !message.images.is_empty() {
                return Err(QaScribeError::Validation(
                    "Assistant messages cannot contain images".into(),
                ));
            }
        }
        let projection = messages
            .iter()
            .map(|message| ChatPromptMessage {
                role: match message.role {
                    ChatRole::User => ChatPromptRole::User,
                    ChatRole::Assistant => ChatPromptRole::Assistant,
                },
                text: if message.text.trim().is_empty() && !message.images.is_empty() {
                    "[Image-only user message]".into()
                } else {
                    message.text.clone()
                },
            })
            .collect::<Vec<_>>();
        build_chat_prompt(&context, &projection).map_err(QaScribeError::Validation)?;
        let sources = messages
            .iter()
            .map(|message| {
                message
                    .images
                    .iter()
                    .map(|image| chat_image_source(service, &chat.session_id, &image.attachment_id))
                    .collect::<Result<Vec<_>>>()
            })
            .collect::<Result<Vec<_>>>()?;
        let messages = messages
            .into_iter()
            .map(|message| ChatInputMessage {
                context: message.context.clone(),
                id: message.id.clone(),
                role: match message.role {
                    ChatRole::User => ChatPromptRole::User,
                    ChatRole::Assistant => ChatPromptRole::Assistant,
                },
                text: qa_scribe_core::services::readable_chat_message(message),
                images: vec![],
            })
            .collect();
        Ok(Self {
            revision,
            intent,
            composer_intent,
            context,
            messages,
            sources,
        })
    }

    pub fn has_images(&self) -> bool {
        self.sources.iter().any(|sources| !sources.is_empty())
    }

    pub fn verify(
        self,
        app_data_dir: &Path,
        provider: AiProvider,
        cancelled: impl Fn() -> bool,
    ) -> Result<VerifiedChatPreparation> {
        self.verify_with(provider, cancelled, |source| {
            resolve_chat_image_source(app_data_dir, source)
        })
    }

    pub fn verify_with(
        self,
        provider: AiProvider,
        cancelled: impl Fn() -> bool,
        mut load: impl FnMut(ChatImageSource) -> Result<ChatInputImage>,
    ) -> Result<VerifiedChatPreparation> {
        let mut messages = self.messages.clone();
        for (message, sources) in messages.iter_mut().zip(&self.sources) {
            for source in sources {
                check_cancelled(&cancelled)?;
                message.images.push(load(source.clone())?);
            }
        }
        check_cancelled(&cancelled)?;
        build_chat_input(&self.context, messages.clone())
            .map_err(QaScribeError::Validation)?
            .preflight_wire(provider)
            .map_err(QaScribeError::Validation)?;
        check_cancelled(&cancelled)?;
        Ok(VerifiedChatPreparation {
            snapshot: self,
            messages,
        })
    }
}

impl VerifiedChatPreparation {
    pub fn intent(&self) -> &ChatRequestIntent {
        &self.snapshot.intent
    }

    pub fn recheck(&self, service: &SessionService, request: &StartChatJobRequest) -> Result<()> {
        let current = ChatPreparationSnapshot::capture(service, request)?;
        if current.intent != self.snapshot.intent
            || current.composer_intent != self.snapshot.composer_intent
            || current.revision != self.snapshot.revision
            || current.context != self.snapshot.context
            || current.sources != self.snapshot.sources
            || current
                .messages
                .iter()
                .map(|m| (&m.id, &m.text, &m.context))
                .ne(self
                    .snapshot
                    .messages
                    .iter()
                    .map(|m| (&m.id, &m.text, &m.context)))
        {
            return Err(changed());
        }
        Ok(())
    }

    pub fn input(mut self, user_id: String) -> Result<ChatInput> {
        self.messages.last_mut().expect("verified user message").id = user_id;
        build_chat_input(&self.snapshot.context, self.messages).map_err(QaScribeError::Validation)
    }
}

fn check_cancelled(cancelled: &impl Fn() -> bool) -> Result<()> {
    if cancelled() {
        Err(QaScribeError::Validation("Generation cancelled.".into()))
    } else {
        Ok(())
    }
}
