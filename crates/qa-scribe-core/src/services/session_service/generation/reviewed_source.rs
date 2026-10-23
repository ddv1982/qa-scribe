use rusqlite::params;

use crate::{
    QaScribeError, Result,
    domain::{AiRun, AiRunCreate, Attachment, Entry, EntryType, GenerationContext, Session},
    error::validation,
    generation::{GenerateAiActionKind, GenerateAiActionRequest, managed_attachment_ids_from_html},
};

use super::super::{SessionService, new_id, now};

pub(crate) struct CapturedGenerationMaterial {
    pub session: Session,
    pub note: Option<Entry>,
    pub attachments: Vec<Attachment>,
    pub context: GenerationContext,
    pub run: AiRun,
}

impl SessionService {
    pub(crate) fn capture_action_material(
        &self,
        request: &GenerateAiActionRequest,
    ) -> Result<CapturedGenerationMaterial> {
        self.database.with_immediate_tx(|tx| {
            let session = self.get_session(&request.session_id)?
                .ok_or_else(|| QaScribeError::NotFound(request.session_id.clone()))?;
            let entries = self.list_entries(&session.id)?;
            let note = select_note(request, &entries)?;
            if !matches!(request.action, GenerateAiActionKind::Summary)
                && (request.expected_note_revision.is_none() || request.note_entry_id.is_none())
            {
                return Err(validation("Review the selected Note before generating."));
            }
            if let Some(expected) = request.expected_note_revision {
                let source = note.map(|entry| self.note_source(&session.id, &entry.id)).transpose()?.flatten()
                    .ok_or_else(|| validation("The reviewed Note no longer exists."))?;
                if source.revision != expected {
                    return Err(validation("The reviewed Note changed. Review the latest source and confirm again."));
                }
            }
            let attachments = self.list_attachments(&session.id)?;
            let context = GenerationContext { id: new_id(), session_id: session.id.clone(), created_at: now() };
            tx.execute("INSERT INTO generation_contexts (id, session_id, created_at) VALUES (?1, ?2, ?3)",
                params![context.id, context.session_id, context.created_at])?;
            if let Some(note) = note {
                tx.execute("INSERT INTO generation_context_entries (id, generation_context_id, entry_id, included) VALUES (?1, ?2, ?3, 1)",
                    params![new_id(), context.id, note.id])?;
                let ids = managed_attachment_ids_from_html(&note.body);
                for attachment in &attachments {
                    if ids.contains(&attachment.id) {
                        tx.execute("INSERT INTO generation_context_attachments (id, generation_context_id, attachment_id, included) VALUES (?1, ?2, ?3, 1)",
                            params![new_id(), context.id, attachment.id])?;
                    }
                }
            }
            let run = self.create_ai_run(AiRunCreate {
                session_id: session.id.clone(), generation_context_id: Some(context.id.clone()),
                provider: request.provider, model: request.model.clone(), reasoning_effort: request.reasoning_effort.clone(),
                prompt_version: request.action.prompt_version().into(),
            })?;
            Ok(CapturedGenerationMaterial { session, note: note.cloned(), attachments, context, run })
        })
    }
}

fn select_note<'a>(
    request: &GenerateAiActionRequest,
    entries: &'a [Entry],
) -> Result<Option<&'a Entry>> {
    if let Some(id) = request.note_entry_id.as_deref() {
        let note = entries
            .iter()
            .find(|entry| entry.id == id)
            .ok_or_else(|| validation("Selected note entry was not found in this Session."))?;
        if note.entry_type != EntryType::Note {
            return Err(validation("Selected entry must be a Note."));
        }
        return Ok(Some(note));
    }
    if matches!(request.action, GenerateAiActionKind::Summary) {
        return Err(validation(
            "Summarize notes requires an editable note entry.",
        ));
    }
    Ok(entries
        .iter()
        .find(|entry| entry.entry_type == EntryType::Note))
}
