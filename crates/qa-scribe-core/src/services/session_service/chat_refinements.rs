use super::{SessionService, chat_rows as rows, new_id};
use crate::{Result, domain::*, error::validation};
use rusqlite::{Connection, params};

impl SessionService {
    pub fn resolve_refinement(&self, request: RefinementRequest) -> Result<ChatState> {
        self.database.with_immediate_tx(|tx| {
            let chat = rows::checked(tx, &request.scope)?;
            rows::editable(&chat)?;
            let mut proposal = read(tx, &chat.draft_id)?.into_iter().find(|p| p.id == request.proposal_id)
                .ok_or_else(|| validation("Proposal is not in this conversation"))?;
            let previous_state = proposal.state.clone();
            match request.action {
                RefinementAction::Stage => {
                    super::chat_context::validate_owner(tx, &chat.session_id, &proposal.target)?;
                    let snapshot = proposal.target.snapshot().ok_or_else(|| validation("Record context is missing"))?;
                    let current = super::record_bases::stored(tx, table(&proposal.target)?, &chat.session_id, &snapshot.record_id)?;
                    if current != snapshot.stored_base_token { return Err(validation("Stored record changed. Discard local changes and review the latest record before requesting another refinement.")); }
                    match proposal.state {
                        RefinementState::Offered => {
                            let record = match &proposal.target {
                                ChatTarget::Finding { snapshot } => ConversationRecord::Finding { record_id: snapshot.record_id.clone() },
                                ChatTarget::TestCasesDraft { snapshot } => ConversationRecord::TestCasesDraft { record_id: snapshot.record_id.clone() },
                                ChatTarget::Session => return Err(validation("Stage target is missing")),
                            };
                            if let Some(origin) = staged_origins(tx, &chat.session_id)?.into_iter().find(|origin| origin.record == record) {
                                return Err(validation(format!("Resolve the prepared change in conversation {} (proposal {}) before applying another suggestion.", origin.reference.draft_id, origin.proposal_id)));
                            }
                            let stage = EditorStage { id: new_id(), before: proposal.before.clone(), after: proposal.after.clone(), stored_base_token: snapshot.stored_base_token.clone() };
                            tx.execute("INSERT INTO chat_editor_stages (id, proposal_id, stage_json) VALUES (?1, ?2, ?3)", params![stage.id, proposal.id, encode(&stage)?])?;
                            proposal.state = RefinementState::Staged { stage };
                        }
                        RefinementState::Staged { .. } => return Ok(chat),
                        _ => return Err(validation("This proposal can no longer be applied")),
                    }
                }
                RefinementAction::Dismiss => {
                    if !matches!(proposal.state, RefinementState::Offered) { return Err(validation("Use Undo, Save, or Discard for an applied proposal")); }
                    proposal.state = RefinementState::Dismissed;
                }
                RefinementAction::Abandon => {
                    let stage = match proposal.state { RefinementState::Staged { stage } | RefinementState::Abandoned { stage } => stage, _ => return Err(validation("This proposal has no prepared change to abandon")) };
                    proposal.state = RefinementState::Abandoned { stage };
                }
                RefinementAction::Undo | RefinementAction::Discard => {
                    let stage = match proposal.state { RefinementState::Staged { stage } | RefinementState::Undone { stage } => stage, _ => return Err(validation("This proposal has no unsaved stage")) };
                    proposal.state = RefinementState::Undone { stage };
                }
            }
            write(tx, &proposal)?;
            rows::bump(tx, &chat.draft_id)?;
            if proposal.state != previous_state { rows::touch_activity(tx, &chat.draft_id)?; }
            rows::read(tx, &chat.draft_id)
        })
    }
}

pub(super) fn table(target: &ChatTarget) -> Result<&'static str> {
    match target {
        ChatTarget::Finding { .. } => Ok("findings"),
        ChatTarget::TestCasesDraft { .. } => Ok("drafts"),
        _ => Err(validation("Refinement needs a record")),
    }
}

pub(super) fn insert(
    connection: &Connection,
    draft_id: &str,
    turn_id: &str,
    mut proposal: RefinementProposal,
) -> Result<()> {
    proposal.assistant_message_id = connection.query_row(
        "SELECT id FROM chat_messages WHERE draft_id=?1 AND turn_id=?2 AND role='assistant'",
        params![draft_id, turn_id],
        |r| r.get(0),
    )?;
    connection.execute("INSERT INTO chat_refinements(id,draft_id,user_message_id,assistant_message_id,proposal_json) VALUES (?1,?2,?3,?4,?5)", params![proposal.id,draft_id,proposal.user_message_id,proposal.assistant_message_id,encode(&proposal)?])?;
    Ok(())
}

pub(super) fn read(connection: &Connection, draft_id: &str) -> Result<Vec<RefinementProposal>> {
    let mut statement = connection
        .prepare("SELECT proposal_json FROM chat_refinements WHERE draft_id=?1 ORDER BY rowid")?;
    statement
        .query_map([draft_id], |r| r.get::<_, String>(0))?
        .map(|raw| decode(&raw?))
        .collect()
}

fn write(connection: &Connection, proposal: &RefinementProposal) -> Result<()> {
    connection.execute(
        "UPDATE chat_refinements SET proposal_json=?1 WHERE id=?2",
        params![encode(proposal)?, proposal.id],
    )?;
    Ok(())
}

pub(super) fn guard_stage(
    connection: &Connection,
    table_name: &str,
    id: &str,
    guard: &RecordWriteGuard,
) -> Result<()> {
    let Some(stage_id) = guard.stage_id() else {
        return Ok(());
    };
    let (raw, session_id): (String, String) = connection.query_row("SELECT r.proposal_json,d.session_id FROM chat_refinements r JOIN chat_editor_stages s ON s.proposal_id=r.id JOIN chat_drafts d ON d.id=r.draft_id WHERE s.id=?1", [stage_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let proposal: RefinementProposal = decode(&raw)?;
    let snapshot = proposal
        .target
        .snapshot()
        .ok_or_else(|| validation("Stage target is missing"))?;
    if table(&proposal.target)? != table_name
        || snapshot.record_id != id
        || snapshot.session_id != guard.session_id
        || session_id != guard.session_id
    {
        return Err(validation("Stage belongs to another record"));
    }
    if let (RecordWriteOrigin::Proposal { .. }, RefinementState::Saved { stage }) =
        (&guard.origin, &proposal.state)
    {
        return if stage.id == stage_id {
            Ok(())
        } else {
            Err(validation("Proposal stage is no longer saveable"))
        };
    }
    ensure_stage_editable(connection, stage_id)?;
    match (&guard.origin, &proposal.state) {
        (RecordWriteOrigin::Proposal { .. }, RefinementState::Staged { stage })
            if stage.stored_base_token == guard.expected_stored_base =>
        {
            Ok(())
        }
        (
            RecordWriteOrigin::Compensation { .. },
            RefinementState::Saved { .. } | RefinementState::Reverted { .. },
        ) => Ok(()),
        _ => Err(validation("Proposal stage is no longer saveable")),
    }
}

pub(super) fn settle_stage(connection: &Connection, guard: &RecordWriteGuard) -> Result<()> {
    let Some(stage_id) = guard.stage_id() else {
        return Ok(());
    };
    let raw: String = connection.query_row("SELECT r.proposal_json FROM chat_refinements r JOIN chat_editor_stages s ON s.proposal_id=r.id WHERE s.id=?1", [stage_id], |r| r.get(0))?;
    let mut proposal: RefinementProposal = decode(&raw)?;
    if matches!((&guard.origin, &proposal.state), (RecordWriteOrigin::Proposal { .. }, RefinementState::Saved { stage }) if stage.id == stage_id)
    {
        return Ok(());
    }
    ensure_stage_editable(connection, stage_id)?;
    proposal.state = match (&guard.origin, proposal.state) {
        (RecordWriteOrigin::Proposal { .. }, RefinementState::Staged { stage }) => {
            RefinementState::Saved { stage }
        }
        (RecordWriteOrigin::Compensation { .. }, RefinementState::Saved { stage }) => {
            RefinementState::Reverted { stage }
        }
        (RecordWriteOrigin::Compensation { .. }, RefinementState::Reverted { .. }) => return Ok(()),
        _ => return Err(validation("Proposal stage changed before Save")),
    };
    let draft_id: String = connection.query_row(
        "SELECT draft_id FROM chat_refinements WHERE id=?1",
        [&proposal.id],
        |r| r.get(0),
    )?;
    write(connection, &proposal)?;
    rows::bump(connection, &draft_id)
}

pub(super) fn summary(proposal: &RefinementProposal) -> String {
    let status = match proposal.state {
        RefinementState::Offered => "Not applied",
        RefinementState::Staged { .. } => "Unsaved local stage",
        RefinementState::Saved { .. } => "Saved through the record editor",
        RefinementState::Dismissed => "Dismissed",
        RefinementState::Undone { .. } => "Undone or discarded",
        RefinementState::Reverted { .. } => "Superseded save restored",
        RefinementState::Abandoned { .. } => {
            "Prepared change abandoned without changing the editor"
        }
    };
    fn excerpt(value: &RefinementEditorValue) -> String {
        fn collect(node: &serde_json::Value, text: &mut String) {
            if let Some(value) = node["text"].as_str() {
                text.push_str(value);
                text.push(' ');
            }
            if let Some(children) = node["content"].as_array() {
                for child in children {
                    collect(child, text);
                }
            }
        }
        let mut text = String::new();
        if let Ok(document) = serde_json::from_str::<serde_json::Value>(&value.document_json) {
            collect(&document["doc"], &mut text);
        }
        text.chars().take(1000).collect()
    }
    format!(
        "\n\nLocal refinement suggestion\n\nBefore title: {}\n\nBefore body excerpt: {}\n\nProposed title: {}\n\nProposed body excerpt: {}\n\nOutcome: {}. Adding this conversation to the Note never applies a change.",
        proposal.before.title,
        excerpt(&proposal.before),
        proposal.after.title,
        excerpt(&proposal.after),
        status
    )
}

fn encode(value: &impl serde::Serialize) -> Result<String> {
    serde_json::to_string(value).map_err(|e| validation(e.to_string()))
}
fn decode<T: serde::de::DeserializeOwned>(raw: &str) -> Result<T> {
    serde_json::from_str(raw).map_err(|e| validation(e.to_string()))
}

fn ensure_stage_editable(connection: &Connection, stage_id: &str) -> Result<()> {
    let editable: bool = connection.query_row("SELECT d.archived=0 AND d.submitted_at IS NULL FROM chat_editor_stages s JOIN chat_refinements r ON r.id=s.proposal_id JOIN chat_drafts d ON d.id=r.draft_id WHERE s.id=?1", [stage_id], |r| r.get(0))?;
    if !editable {
        return Err(validation("Proposal conversation is read-only"));
    }
    Ok(())
}

pub(super) fn staged_origins(
    connection: &Connection,
    session_id: &str,
) -> Result<Vec<StageOrigin>> {
    let mut statement = connection.prepare("SELECT r.draft_id,r.proposal_json FROM chat_refinements r JOIN chat_drafts d ON d.id=r.draft_id WHERE d.session_id=?1 ORDER BY r.rowid")?;
    let mut origins = Vec::new();
    for row in statement.query_map([session_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })? {
        let (draft_id, raw) = row?;
        let proposal: RefinementProposal = decode(&raw)?;
        if let RefinementState::Staged { stage } = proposal.state {
            let record = match proposal.target {
                ChatTarget::Finding { snapshot } => ConversationRecord::Finding {
                    record_id: snapshot.record_id,
                },
                ChatTarget::TestCasesDraft { snapshot } => ConversationRecord::TestCasesDraft {
                    record_id: snapshot.record_id,
                },
                ChatTarget::Session => return Err(validation("Stage target is missing")),
            };
            origins.push(StageOrigin {
                reference: ChatRef {
                    session_id: session_id.into(),
                    draft_id,
                },
                proposal_id: proposal.id,
                stage_id: stage.id,
                record,
            });
        }
    }
    Ok(origins)
}
