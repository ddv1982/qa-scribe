use super::{SessionService, chat_refinements, chat_responses, chat_rows as rows, entries, now};
use crate::{Result, domain::*, error::validation};
use rusqlite::{OptionalExtension, params};
use serde_json::Value;
use sha2::{Digest, Sha256};

impl SessionService {
    pub fn apply_note_refinement(
        &self,
        request: ApplyNoteRefinementRequest,
    ) -> Result<AppliedNoteRefinement> {
        self.database.with_immediate_tx(|tx| {
            let chat = rows::owned_id(tx, &request.reference)?;
            rows::notes(&chat)?;
            rows::editable(&chat)?;
            rows::idle(&chat)?;
            let mut proposal = chat.proposals.iter()
                .find(|item| item.id == request.proposal_id && matches!(item.patch, RefinementPatch::Note { .. }))
                .cloned()
                .ok_or_else(|| validation("Note suggestion is unavailable"))?;
            let note = entries::note_entry(tx, &chat.session_id)?
                .ok_or_else(|| validation("Open the Session Note before updating it"))?;
            match (request.undo, &proposal.state) {
                (true, RefinementState::Offered) | (false, RefinementState::NoteApplied) => {
                    return Ok(AppliedNoteRefinement { chat, note });
                }
                (true, RefinementState::NoteApplied) => {
                    let (body, json, format, before, applied): (String, Option<String>, Option<String>, String, String) =
                        tx.query_row("SELECT before_body,before_json,before_format,before_fingerprint,applied_fingerprint FROM chat_note_undo WHERE proposal_id=?1",
                            [&proposal.id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)))
                        .optional()?.ok_or_else(|| validation("No undo is available for this suggestion"))?;
                    if applied != revision_fingerprint(&note) {
                        return Err(validation("The Note changed after this update. Your edits were kept."));
                    }
                    tx.execute("UPDATE entries SET body=?1,body_json=?2,body_format=?3,updated_at=?4 WHERE id=?5",
                        params![body, json, format, now(), note.id])?;
                    tx.execute("DELETE FROM chat_note_undo WHERE proposal_id=?1", [&proposal.id])?;
                    let restored = entries::note_entry(tx, &chat.session_id)?.expect("restored Note");
                    tx.execute(
                        "UPDATE chat_note_undo SET applied_fingerprint=?1 WHERE applied_fingerprint=?2
                         AND proposal_id IN (SELECT r.id FROM chat_refinements r JOIN chat_drafts d ON r.draft_id=d.id WHERE d.session_id=?3)",
                        params![revision_fingerprint(&restored), before, chat.session_id],
                    )?;
                    proposal.state = RefinementState::Offered;
                }
                (false, RefinementState::Offered) => {
                    let source = chat_responses::contract(tx, &proposal.user_message_id)?
                        .and_then(|ChatResponseContract::Current(contract)| contract.note_source);
                    if source.as_deref() != Some(content_fingerprint(Some(&note)).as_str()) {
                        return Err(validation("The Note changed after the suggestion was made. Request a fresh suggestion."));
                    }
                    let mut document: Value = serde_json::from_str(&proposal.after.document_json)
                        .map_err(|_| validation("Invalid suggested Note"))?;
                    let nodes = document["doc"]["content"].as_array_mut()
                        .ok_or_else(|| validation("Missing suggested Note content"))?;
                    if let Some(json) = note.body_json.as_deref() {
                        let current: Value = serde_json::from_str(json)
                            .map_err(|_| validation("Invalid saved Note document"))?;
                        crate::chat::response::preserve_images(&current["doc"], nodes, 0)?;
                    } else if note.body.to_ascii_lowercase().contains("<img") {
                        return Err(validation("Save the Note in the editor before rewriting its images."));
                    }
                    let body = validate_body_text("Note body", &crate::chat::markdown::to_html(nodes), TEXT_BODY_MAX_LENGTH)?;
                    let json = validate_body_json(Some(document.to_string()))?;
                    tx.execute("UPDATE entries SET body=?1,body_json=?2,body_format='tiptap_json',updated_at=?3 WHERE id=?4",
                        params![body, json, now(), note.id])?;
                    let saved = entries::note_entry(tx, &chat.session_id)?.expect("updated Note");
                    tx.execute("INSERT INTO chat_note_undo (proposal_id,before_body,before_json,before_format,before_fingerprint,applied_fingerprint) VALUES (?1,?2,?3,?4,?5,?6)",
                        params![proposal.id, note.body, note.body_json, note.body_format, revision_fingerprint(&note), revision_fingerprint(&saved)])?;
                    proposal.state = RefinementState::NoteApplied;
                }
                _ => return Err(validation("This suggestion is no longer available")),
            }
            chat_refinements::write(tx, &proposal)?;
            rows::bump(tx, &chat.draft_id)?;
            rows::touch_activity(tx, &chat.draft_id)?;
            Ok(AppliedNoteRefinement {
                chat: rows::read(tx, &chat.draft_id)?,
                note: entries::note_entry(tx, &chat.session_id)?.expect("updated Note"),
            })
        })
    }
}

pub(super) fn content_fingerprint(note: Option<&Entry>) -> String {
    let content = note.map(|note| (&note.id, &note.body, &note.body_json, &note.body_format));
    format!(
        "document:{:x}",
        Sha256::digest(serde_json::json!(content).to_string().as_bytes())
    )
}

fn revision_fingerprint(note: &Entry) -> String {
    let content = content_fingerprint(Some(note));
    format!(
        "{:x}",
        Sha256::digest(
            serde_json::json!([content, note.updated_at])
                .to_string()
                .as_bytes()
        )
    )
}
