use super::{SessionService, chat_rows as rows, chat_turns, new_id, require_session};
use crate::{Result, domain::*};
use rusqlite::{OptionalExtension, params};

impl SessionService {
    pub fn load_chat(&self, session_id: &str) -> Result<ChatState> {
        self.database.with_immediate_tx(|tx| {
            require_session(tx, session_id)?;
            let id: Option<String> = tx
                .query_row(
                    "SELECT id FROM chat_drafts WHERE session_id = ?1 AND archived = 0 AND owner_kind = 'notes'",
                    [session_id],
                    |r| r.get(0),
                )
                .optional()?;
            match id {
                Some(id) => rows::read(tx, &id),
                None => rows::create(tx, session_id),
            }
        })
    }

    pub fn save_chat_composer(&self, request: ChatComposerRequest) -> Result<ChatState> {
        self.save_chat_composer_releasing_images(request)
            .map(|(chat, _)| chat)
    }

    pub(crate) fn save_chat_composer_releasing_images(
        &self,
        request: ChatComposerRequest,
    ) -> Result<(ChatState, Vec<String>)> {
        rows::text("Chat composer", &request.composer, true)?;
        self.database.with_immediate_tx(|tx| {
            let chat = rows::checked(tx, &request.scope)?;
            rows::editable(&chat)?;
            if chat.composer == request.composer && chat.mode == request.mode && chat.composer_intent == request.intent
                && chat.composer_images.iter().map(|i| &i.attachment_id).eq(request.attachment_ids.iter()) {
                return Ok((chat, Vec::new()));
            }
            let released = super::chat_images::replace(tx, &chat, &request.attachment_ids)?;
            tx.execute("UPDATE chat_drafts SET composer = ?1, mode = ?2, composer_intent = ?4, revision = revision + 1 WHERE id = ?3",
                params![request.composer, request.mode.as_str(), chat.draft_id, request.intent.as_str()])?;
            rows::touch_activity(tx, &chat.draft_id)?;
            Ok((rows::read(tx, &chat.draft_id)?, released))
        })
    }

    /// The returned turn has already committed its user message. Execute the provider only afterward.
    pub fn start_chat_turn(&self, request: ChatStartRequest) -> Result<ChatTurnStarted> {
        self.start_chat_turn_with_context(request, ChatTarget::Session)
    }

    pub fn start_chat_turn_with_context(
        &self,
        request: ChatStartRequest,
        context: ChatTarget,
    ) -> Result<ChatTurnStarted> {
        self.start_chat_turn_with_response(request, context, ChatRequestIntent::Message)
    }

    pub fn start_chat_turn_with_response(
        &self,
        request: ChatStartRequest,
        context: ChatTarget,
        intent: ChatRequestIntent,
    ) -> Result<ChatTurnStarted> {
        self.database.with_immediate_tx(|tx| {
            let chat = rows::checked(tx, &request.scope)?;
            rows::editable(&chat)?;
            rows::idle(&chat)?;
            let resolved = super::chat_questions::resolve(tx, &chat, context.clone(), &intent)?;
            let turn_id = new_id();
            rows::append(
                tx,
                &chat.draft_id,
                &turn_id,
                ChatRole::User,
                &resolved.text,
                ChatTurnStatus::Running,
            )?;
            super::chat_context::store(tx, &chat.draft_id, &turn_id, &resolved.context)?;
            super::chat_responses::start(tx, &chat.draft_id, &turn_id, resolved.purpose, matches!(chat.owner, ConversationOwner::Record { .. }))?;
            if let Some(answer) = resolved.answer { super::chat_questions::store_answer(tx, &chat.draft_id, &turn_id, &answer)?; }
            tx.execute("INSERT INTO chat_message_images (message_id, attachment_id, ordinal)
                SELECT m.id, i.attachment_id, i.ordinal FROM chat_composer_images i
                JOIN chat_messages m ON m.draft_id = i.draft_id AND m.turn_id = ?1 AND m.role = 'user'
                WHERE i.draft_id = ?2", params![turn_id, chat.draft_id])?;
            tx.execute("DELETE FROM chat_composer_images WHERE draft_id = ?1", [&chat.draft_id])?;
            tx.execute(
                "UPDATE chat_drafts SET composer = '', composer_intent = 'message', revision = revision + 1 WHERE id = ?1",
                [&chat.draft_id],
            )?;
            rows::touch_activity(tx, &chat.draft_id)?;
            Ok(ChatTurnStarted {
                chat: rows::read(tx, &chat.draft_id)?,
                turn_id,
            })
        })
    }

    pub fn finish_chat_turn(&self, request: ChatFinishRequest) -> Result<ChatState> {
        self.database
            .with_immediate_tx(|tx| chat_turns::finish(tx, &request, None))
    }

    pub fn fail_chat_turn(&self, request: ChatFailRequest) -> Result<ChatState> {
        self.database
            .with_immediate_tx(|tx| chat_turns::fail(tx, &request, None))
    }

    pub fn restart_chat(&self, request: ChatRestartRequest) -> Result<ChatState> {
        self.database.with_immediate_tx(|tx| {
            let chat = rows::checked(tx, &request.scope)?;
            rows::notes(&chat)?;
            rows::idle(&chat)?;
            if chat.proposals.iter().any(|p| matches!(p.state, RefinementState::Staged { .. })) { return Err(crate::error::validation("Save, Undo, or Discard the local refinement before starting a new conversation")); }
            tx.execute(
                "UPDATE chat_drafts SET archived = 1 WHERE id = ?1",
                [&chat.draft_id],
            )?;
            rows::create(tx, &chat.session_id)
        })
    }

    /// Startup recovery only. Never called by load_chat or a mutation.
    pub(super) fn interrupt_orphaned_chat_turns(&self) -> Result<()> {
        self.database.with_immediate_tx(|tx| {
            tx.execute("UPDATE chat_drafts SET revision = revision + 1 WHERE id IN (SELECT draft_id FROM chat_messages WHERE status = 'running')", [])?;
            tx.execute("UPDATE chat_messages SET status = 'interrupted', error_message = 'App stopped before the response completed. Retry explicitly.' WHERE status = 'running'", [])?;
            Ok(())
        })
    }
}
