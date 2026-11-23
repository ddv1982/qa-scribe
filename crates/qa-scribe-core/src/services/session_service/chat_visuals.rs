use super::{
    SessionService, attachments, chat_refinements, chat_rows as rows, new_id, now, record_bases,
};
use crate::{
    Result,
    attachments::{
        self as files, chat::validate_chat_image, managed_import::PreparedManagedAttachment,
    },
    chat::visual,
    domain::*,
    error::validation,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use std::path::Path;

impl SessionService {
    pub fn review_visual_refinement(
        &self,
        root: &Path,
        reference: &ChatRef,
        id: &str,
    ) -> Result<VisualReviewSources> {
        let connection = self.database.connection();
        let (chat, proposal, _) = load(connection, reference, id)?;
        let visual = visual_patch(&proposal);
        let document = document(&proposal)?;
        let source = source_image(connection, &chat.session_id, &proposal, &document["doc"])?;
        let replaced = visual
            .action
            .replaces()
            .then(|| {
                checked_image(
                    connection,
                    &chat.session_id,
                    visual::image_id(visual::node(&document["doc"], &visual.target)?),
                )
            })
            .transpose()?;
        let preview = |image: Option<Attachment>| -> Result<Option<String>> {
            match image {
                None => Ok(None),
                Some(image) => files::attachment_preview_data_url(self, root, &image.id)?
                    .map(Some)
                    .ok_or_else(|| validation("The source image is unavailable")),
            }
        };
        if source
            .as_ref()
            .zip(replaced.as_ref())
            .is_some_and(|(a, b)| a.id == b.id)
        {
            let image = preview(source)?;
            return Ok(VisualReviewSources {
                source: image.clone(),
                replaced: image,
            });
        }
        Ok(VisualReviewSources {
            source: preview(source)?,
            replaced: preview(replaced)?,
        })
    }

    pub fn apply_visual_refinement(
        &self,
        root: &Path,
        request: ApplyVisualRefinementRequest,
    ) -> Result<AppliedRefinement> {
        let connection = self.database.connection();
        let (chat, proposal, draft) = load(connection, &request.reference, &request.proposal_id)?;
        if already_done(&proposal.state, request.undo) {
            return Ok(outcome(chat, draft));
        }
        let needs_png = !request.undo && visual_patch(&proposal).action.renders_png();
        if needs_png != request.image_data_url.is_some() {
            return Err(validation(
                "Review the rendered image before updating test cases",
            ));
        }
        let file = request
            .image_data_url
            .as_deref()
            .map(|url| prepare_png(&chat.session_id, url))
            .transpose()?;
        if let Some(file) = &file {
            connection.execute(
                "INSERT INTO chat_image_imports (relative_path,temp_path,session_id) VALUES (?1,?2,?3)",
                params![file.draft.relative_path, file.temp_relative, chat.session_id],
            )?;
        }
        let result = (|| {
            if let Some(file) = &file {
                file.write(root)?;
            }
            self.database
                .with_immediate_tx(|tx| commit(tx, &request, file.as_ref()))
        })();
        if let Some(file) = &file {
            let _ = files::chat_imports::recover_chat_image_import(
                self,
                root,
                &file.draft.relative_path,
            );
        }
        result
    }
}

fn prepare_png(session: &str, url: &str) -> Result<PreparedManagedAttachment> {
    if url.len() > files::chat::MAX_CHAT_IMAGE_BYTES.div_ceil(3) * 4 + 64 {
        return Err(validation("Suggested image must be at most 10 MiB"));
    }
    let (mime, bytes) = files::decode_image_data_url(url)?;
    if mime != "image/png" {
        return Err(validation("Suggested image must be a PNG"));
    }
    validate_chat_image(&mime, &bytes)?;
    PreparedManagedAttachment::new(
        AttachmentDraft {
            session_id: session.into(),
            entry_id: None,
            filename: "test-case-visual.png".into(),
            mime_type: Some(mime),
            size_bytes: 0,
            sha256: String::new(),
            relative_path: String::new(),
        },
        bytes,
    )
}

fn commit(
    tx: &Connection,
    request: &ApplyVisualRefinementRequest,
    file: Option<&PreparedManagedAttachment>,
) -> Result<AppliedRefinement> {
    let (chat, mut proposal, draft) = load(tx, &request.reference, &request.proposal_id)?;
    if already_done(&proposal.state, request.undo) {
        return Ok(outcome(chat, draft));
    }
    rows::editable(&chat)?;
    rows::idle(&chat)?;
    let base = record_bases::stored(tx, "drafts", &chat.session_id, &draft.id)?;
    match (&proposal.state, request.undo) {
        (RefinementState::VisualApplied { .. }, true) => {
            undo(tx, &proposal.id, &draft, &base)?;
            proposal.state = RefinementState::VisualUndone;
        }
        (RefinementState::Offered, false) => {
            if proposal
                .target
                .snapshot()
                .is_none_or(|snapshot| snapshot.stored_base_token != base)
            {
                return Err(validation(
                    "The saved record changed. Request a fresh visual suggestion.",
                ));
            }
            let mut document = document(&proposal)?;
            let source = source_image(tx, &chat.session_id, &proposal, &document["doc"])?;
            let generated = file
                .map(|file| {
                    let row = attachments::create_attachment_on(tx, new_id(), file.draft.clone())?;
                    tx.execute(
                        "DELETE FROM chat_image_imports WHERE relative_path=?1",
                        [&row.relative_path],
                    )?;
                    Ok::<_, crate::QaScribeError>(row)
                })
                .transpose()?;
            visual::edit(
                &mut document["doc"],
                visual_patch(&proposal),
                generated.as_ref().map(|image| image.id.as_str()),
                source.as_ref().map(|image| image.id.as_str()),
            )?;
            let nodes = document["doc"]["content"]
                .as_array()
                .ok_or_else(|| validation("Missing visual document content"))?;
            let body = validate_body_text(
                "Record body",
                &crate::chat::markdown::to_html(nodes),
                DRAFT_BODY_MAX_LENGTH,
            )?;
            let json = document.to_string();
            let body_json = validate_body_json(Some(json.clone()))?;
            let applied_at = now();
            let title =
                validate_required_text("Record title", &proposal.before.title, TITLE_MAX_LENGTH)?;
            let metadata = validate_metadata_json(proposal.before.metadata_json.clone())?;
            tx.execute("UPDATE drafts SET title=?1,body=?2,body_json=?3,body_format='tiptap_json',metadata_json=?4,updated_at=?5 WHERE id=?6",
                params![title, body, body_json, metadata, applied_at, draft.id])?;
            let applied_base = record_bases::stored(tx, "drafts", &chat.session_id, &draft.id)?;
            tx.execute("INSERT INTO chat_visual_undo (proposal_id,record_id,before_title,before_body,before_json,before_format,before_metadata,before_at,applied_base,applied_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                params![proposal.id, draft.id, draft.title, draft.body, draft.body_json, draft.body_format.as_deref().unwrap_or("html"),
                    draft.metadata_json, draft.updated_at, applied_base, applied_at])?;
            proposal.after.document_json = json;
            proposal.state = RefinementState::VisualApplied {
                attachment_id: generated
                    .or(source)
                    .ok_or_else(|| validation("Visual image is missing"))?
                    .id,
            };
        }
        _ => return Err(validation("This visual suggestion is no longer available")),
    }
    chat_refinements::write(tx, &proposal)?;
    rows::bump(tx, &chat.draft_id)?;
    rows::touch_activity(tx, &chat.draft_id)?;
    Ok(outcome(
        rows::read(tx, &chat.draft_id)?,
        read_draft(tx, &draft.id)?,
    ))
}

fn undo(tx: &Connection, id: &str, draft: &Draft, base: &str) -> Result<()> {
    let before_at: String = tx.query_row(
        "SELECT before_at FROM chat_visual_undo WHERE proposal_id=?1 AND record_id=?2 AND applied_base=?3 AND applied_at=?4",
        params![id, draft.id, base, draft.updated_at],
        |row| row.get(0),
    ).optional()?.ok_or_else(|| validation("Test cases changed after the visual update. Your edits were kept."))?;
    let restored_at = now();
    tx.execute(
        "UPDATE drafts SET (title,body,body_json,body_format,metadata_json) =
             (SELECT before_title,before_body,before_json,before_format,before_metadata FROM chat_visual_undo WHERE proposal_id=?1),
             updated_at=?2 WHERE id=?3",
        params![id, restored_at, draft.id],
    )?;
    let restored_base = record_bases::stored(tx, "drafts", &draft.session_id, &draft.id)?;
    tx.execute(
        "UPDATE chat_visual_undo SET applied_at=?1 WHERE record_id=?2 AND applied_base=?3 AND applied_at=?4",
        params![restored_at, draft.id, restored_base, before_at],
    )?;
    tx.execute("DELETE FROM chat_visual_undo WHERE proposal_id=?1", [id])?;
    Ok(())
}

fn already_done(state: &RefinementState, undo: bool) -> bool {
    matches!(
        (state, undo),
        (RefinementState::VisualApplied { .. }, false) | (RefinementState::VisualUndone, true)
    )
}

fn load(
    connection: &Connection,
    reference: &ChatRef,
    id: &str,
) -> Result<(ChatState, RefinementProposal, Draft)> {
    let chat = rows::owned_id(connection, reference)?;
    let proposal = chat
        .proposals
        .iter()
        .find(|item| item.id == id && matches!(item.patch, RefinementPatch::TestCasesVisual { .. }))
        .cloned()
        .ok_or_else(|| validation("Visual suggestion is unavailable"))?;
    super::chat_context::validate_owner(connection, &chat.session_id, &proposal.target)?;
    let ChatTarget::TestCasesDraft { snapshot } = &proposal.target else {
        return Err(validation("A visual suggestion needs a Test Cases draft"));
    };
    let draft = read_draft(connection, &snapshot.record_id)?;
    Ok((chat, proposal, draft))
}

fn read_draft(connection: &Connection, id: &str) -> Result<Draft> {
    super::drafts::draft_by_id(connection, id)?
        .ok_or_else(|| validation("Test Cases draft is missing"))
}

fn visual_patch(proposal: &RefinementProposal) -> &TestCaseVisual {
    let RefinementPatch::TestCasesVisual { visual } = &proposal.patch else {
        unreachable!("Only visual proposals are loaded")
    };
    visual
}

fn document(proposal: &RefinementProposal) -> Result<Value> {
    serde_json::from_str(&proposal.before.document_json)
        .map_err(|_| validation("Invalid visual suggestion document"))
}

fn outcome(chat: ChatState, record: Draft) -> AppliedRefinement {
    AppliedRefinement {
        chat,
        updated: RefinedRecord::TestCasesDraft { record },
    }
}

fn source_image(
    connection: &Connection,
    session: &str,
    proposal: &RefinementProposal,
    document: &Value,
) -> Result<Option<Attachment>> {
    let visual = visual_patch(proposal);
    let id = match &visual.action {
        TestCaseVisualAction::Move { source } => visual::image_id(visual::node(document, source)?).map(str::to_owned),
        TestCaseVisualAction::Caption => visual::image_id(visual::node(document, &visual.target)?).map(str::to_owned),
        _ => match visual.action.source() {
            Some(VisualImageSource::Record { path }) => visual::image_id(visual::node(document, path)?).map(str::to_owned),
            Some(VisualImageSource::Chat { index }) => connection.query_row(
                "SELECT attachment_id FROM chat_message_images WHERE message_id=?1 ORDER BY ordinal LIMIT 1 OFFSET ?2",
                params![proposal.user_message_id, index],
                |row| row.get(0),
            ).optional()?,
            None => return Ok(None),
        },
    };
    checked_image(connection, session, id.as_deref()).map(Some)
}

fn checked_image(connection: &Connection, session: &str, id: Option<&str>) -> Result<Attachment> {
    let id = id.ok_or_else(|| validation("The requested source image is not available"))?;
    attachments::attachment_on(connection, id)?
        .filter(|image| {
            image.session_id == session
                && files::is_exact_attachment_path(&image.relative_path, session)
                && image
                    .mime_type
                    .as_deref()
                    .is_some_and(|mime| mime.starts_with("image/"))
        })
        .ok_or_else(|| validation("The source image must belong to this Session"))
}
