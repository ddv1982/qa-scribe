use super::{SessionService, chat_rows as rows, now};
use crate::{Result, domain::*, error::validation};
use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};

impl SessionService {
    /// Appends the canonical conversation and receipt in one transaction. Does not invoke AI.
    pub fn submit_chat(&self, request: ChatSubmitRequest) -> Result<ChatSubmissionReceipt> {
        self.database.with_immediate_tx(|tx| {
            let owned = rows::owned(tx, &request.scope)?;
            if let Some(receipt) = owned.submission {
                if receipt.note_id != request.note_id {
                    return Err(validation("Chat was submitted to a different Note"));
                }
                return Ok(receipt);
            }
            let chat = rows::checked(tx, &request.scope)?;
            rows::idle(&chat)?;
            if chat.messages.is_empty() { return Err(validation("Chat has no messages to submit")); }
            if !chat.composer.is_empty() || chat.messages.iter().any(|message| message.status != ChatTurnStatus::Completed) {
                return Err(validation("Finish or retry all Chat turns and clear unsent text before submitting."));
            }
            let note = tx.query_row(
                "SELECT id, body, body_json, body_format FROM entries WHERE session_id = ?1 AND type = 'note' ORDER BY created_at ASC LIMIT 1",
                [&chat.session_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?, r.get::<_, String>(3)?)),
            ).optional()?.ok_or_else(|| validation("Session has no primary Note"))?;
            if note.0 != request.note_id { return Err(validation("Submission must target the Session's primary Note")); }
            if note.1 != request.expected_note_body || note.2 != request.expected_note_body_json
                || Some(&note.3) != request.expected_note_body_format.as_ref() {
                return Err(validation("Note changed. Review the latest Note before submitting Chat."));
            }
            let (body, body_json, body_format) = append_transcript(&note.1, note.2.as_deref(), &note.3, &chat.messages)?;
            rows::text("Note body", &body, true)?;
            if body_json.as_ref().is_some_and(|s| s.chars().count() > RICH_BODY_JSON_MAX_LENGTH) {
                return Err(validation("Note rich body JSON is too long"));
            }
            let submitted_at = now();
            tx.execute("UPDATE entries SET body = ?1, body_json = ?2, body_format = ?3, updated_at = ?4 WHERE id = ?5",
                params![body, body_json, body_format, submitted_at, note.0])?;
            tx.execute("UPDATE chat_drafts SET submitted_note_id = ?1, submitted_at = ?2, mode = 'write_note', revision = revision + 1 WHERE id = ?3",
                params![note.0, submitted_at, chat.draft_id])?;
            Ok(ChatSubmissionReceipt { draft_id: chat.draft_id, note_id: note.0, submitted_at })
        })
    }
}

fn append_transcript(
    body: &str,
    body_json: Option<&str>,
    format: &str,
    messages: &[ChatMessage],
) -> Result<(String, Option<String>, &'static str)> {
    let mut html = body.to_string();
    let mut added = Vec::new();
    for message in messages {
        let label = match message.role {
            ChatRole::User => "User:",
            ChatRole::Assistant => "Assistant:",
        };
        html.push_str("<p>");
        html.push_str(label);
        html.push_str("<br>");
        let mut content = vec![
            json!({"type":"text", "text":label}),
            json!({"type":"hardBreak"}),
        ];
        for (index, line) in message.text.split('\n').enumerate() {
            if index > 0 {
                html.push_str("<br>");
                content.push(json!({"type":"hardBreak"}));
            }
            html.push_str(&escape(line));
            if !line.is_empty() {
                content.push(json!({"type":"text", "text":line}));
            }
        }
        html.push_str("</p>");
        added.push(json!({"type":"paragraph", "content":content}));
    }
    let Some(raw) = body_json else {
        if format != "html" {
            return Err(validation(
                "Note format requires a rich document before Chat submission",
            ));
        }
        return Ok((html, None, "html"));
    };
    // Never synthesize JSON from only the appended transcript: the editor would hide the old HTML.
    let mut document: Value =
        serde_json::from_str(raw).map_err(|_| validation("Note rich document is invalid"))?;
    if document["schemaVersion"] != 1 || document["doc"]["type"] != "doc" {
        return Err(validation("Note rich document has an unsupported schema"));
    }
    let nodes = document["doc"]["content"]
        .as_array_mut()
        .ok_or_else(|| validation("Note rich document content is invalid"))?;
    nodes.extend(added);
    Ok((
        html,
        Some(
            serde_json::to_string(&document)
                .map_err(|_| validation("Cannot serialize Note rich document"))?,
        ),
        "tiptap_json",
    ))
}

fn escape(text: &str) -> String {
    let mut escaped = String::new();
    for character in text.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(character),
        }
    }
    escaped
}
