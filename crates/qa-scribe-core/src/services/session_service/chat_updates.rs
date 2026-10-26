use super::{SessionService, chat_refinements, chat_rows as rows, now};
use crate::{QaScribeError, Result, domain::*, error::validation};
use rusqlite::{Connection, params};

impl SessionService {
    pub fn apply_refinement(&self, request: ApplyRefinementRequest) -> Result<AppliedRefinement> {
        self.database.with_immediate_tx(|tx| {
            let chat = rows::owned_id(tx, &request.reference)?;
            let mut proposal = chat
                .proposals
                .iter()
                .find(|p| p.id == request.proposal_id)
                .cloned()
                .ok_or_else(|| validation("Proposal is not in this conversation"))?;
            let snapshot = proposal
                .target
                .snapshot()
                .ok_or_else(|| validation("Record context is missing"))?;
            if snapshot.session_id != chat.session_id {
                return Err(validation("Proposal belongs to another Session"));
            }
            if proposal.state != RefinementState::Applied {
                rows::editable(&chat)?;
                rows::idle(&chat)?;
                if chat.archived
                    || !matches!(
                        proposal.state,
                        RefinementState::Offered | RefinementState::Staged { .. }
                    )
                {
                    return Err(validation("This proposal can no longer update the record"));
                }
                super::chat_context::validate_owner(tx, &chat.session_id, &proposal.target)?;
                let table = chat_refinements::table(&proposal.target)?;
                let current =
                    super::record_bases::stored(tx, table, &chat.session_id, &snapshot.record_id)?;
                if snapshot.stored_base_token.is_empty() || current != snapshot.stored_base_token {
                    return Err(validation(
                        "The saved record changed. Review it and request a fresh suggestion.",
                    ));
                }
                apply(tx, table, &snapshot.record_id, &proposal)?;
                proposal.state = RefinementState::Applied;
                chat_refinements::write(tx, &proposal)?;
                rows::bump(tx, &chat.draft_id)?;
                rows::touch_activity(tx, &chat.draft_id)?;
            }
            let updated = match &proposal.target {
                ChatTarget::Finding { snapshot } => RefinedRecord::Finding {
                    record: super::findings::finding(tx, &snapshot.record_id)?
                        .ok_or_else(|| QaScribeError::NotFound(snapshot.record_id.clone()))?,
                },
                ChatTarget::TestCasesDraft { snapshot } => RefinedRecord::TestCasesDraft {
                    record: super::drafts::draft_by_id(tx, &snapshot.record_id)?
                        .ok_or_else(|| QaScribeError::NotFound(snapshot.record_id.clone()))?,
                },
                ChatTarget::Session => return Err(validation("Refinement needs a record")),
            };
            Ok(AppliedRefinement {
                chat: rows::read(tx, &chat.draft_id)?,
                updated,
            })
        })
    }
}

fn apply(
    connection: &Connection,
    table: &str,
    id: &str,
    proposal: &RefinementProposal,
) -> Result<()> {
    let value = &proposal.after;
    let title = validate_required_text("Record title", &value.title, TITLE_MAX_LENGTH)?;
    let metadata = validate_metadata_json(value.metadata_json.clone())?;
    if value.document_json == proposal.before.document_json
        && proposal
            .target
            .snapshot()
            .is_some_and(|snapshot| snapshot.origin == RecordSnapshotOrigin::Saved)
    {
        connection.execute(
            &format!("UPDATE {table} SET title=?1,metadata_json=?2,updated_at=?3 WHERE id=?4"),
            params![title, metadata, now(), id],
        )?;
    } else {
        let document: serde_json::Value = serde_json::from_str(&value.document_json)
            .map_err(|_| validation("Invalid proposal document"))?;
        let nodes = document["doc"]["content"]
            .as_array()
            .ok_or_else(|| validation("Missing proposal content"))?;
        let body = crate::chat::markdown::to_html(nodes);
        let limit = if table == "findings" {
            TEXT_BODY_MAX_LENGTH
        } else {
            DRAFT_BODY_MAX_LENGTH
        };
        let body = validate_body_text("Record body", &body, limit)?;
        let body_json = validate_body_json(Some(value.document_json.clone()))?;
        connection.execute(&format!("UPDATE {table} SET title=?1,body=?2,body_json=?3,body_format='tiptap_json',metadata_json=?4,updated_at=?5 WHERE id=?6"),
            params![title, body, body_json, metadata, now(), id])?;
    }
    Ok(())
}
