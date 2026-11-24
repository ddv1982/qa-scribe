use std::{collections::BTreeSet, fs::File, path::Path};

use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};
use uuid::Uuid;

use super::{SessionService, attachments, now, test_runs::update_case_on};
use crate::{
    QaScribeError, Result,
    attachments::{
        self as files,
        chat::{MAX_CHAT_IMAGE_BYTES, validate_chat_image},
        managed_import::PreparedManagedAttachment,
    },
    domain::{AttachmentDraft, TestCaseNoteImage, TestCaseNotes, TestRunCase},
    error::validation,
};

const MAX_DOCUMENT_BYTES: usize = 64 * 1024;
const MAX_IMAGES: usize = 8;

pub struct PreparedTestCaseNotes {
    session_id: String,
    case_id: String,
    body_json: String,
    references: BTreeSet<String>,
    files: Vec<(String, PreparedManagedAttachment)>,
    _import_lock: Option<File>,
}

impl PreparedTestCaseNotes {
    pub fn new(
        root: &Path,
        session_id: String,
        case_id: String,
        body_json: String,
        images: Vec<TestCaseNoteImage>,
    ) -> Result<Self> {
        let document = parse(&body_json)?;
        let mut references = BTreeSet::new();
        collect_images(&document["doc"], &mut references)?;
        if references.len() > MAX_IMAGES || images.len() > MAX_IMAGES {
            return Err(validation("Result notes can contain up to 8 images"));
        }
        let mut seen = BTreeSet::new();
        let mut files = Vec::new();
        for image in images {
            if !references.contains(image.id.as_str()) || !seen.insert(image.id.clone()) {
                return Err(validation("Result notes image does not match the document"));
            }
            let file = prepare_image(&session_id, &image)?;
            files.push((image.id, file));
        }
        let references = references.into_iter().map(str::to_owned).collect();
        let import_lock = if files.is_empty() {
            None
        } else {
            let lock = files::chat_imports::image_import_recovery_lock(root)?;
            lock.lock_shared()?;
            Some(lock)
        };
        Ok(Self {
            session_id,
            case_id,
            body_json,
            references,
            files,
            _import_lock: import_lock,
        })
    }

    pub fn reserve(&mut self, service: &SessionService) -> Result<()> {
        service.database.with_immediate_tx(|tx| {
            for (id, file) in std::mem::take(&mut self.files) {
                if let Some(existing) = attachments::attachment_on(tx, &id)? {
                    if existing.session_id != self.session_id || existing.sha256 != file.draft.sha256 {
                        return Err(validation("Result notes image conflicts with a saved image"));
                    }
                    continue;
                }
                tx.execute(
                    "INSERT INTO chat_image_imports (relative_path, temp_path, session_id) VALUES (?1, ?2, ?3)",
                    params![file.draft.relative_path, file.temp_relative, self.session_id],
                )?;
                self.files.push((id, file));
            }
            Ok(())
        })
    }

    pub fn write(&self, root: &Path) -> Result<()> {
        for (_, file) in &self.files {
            file.write(root)?;
        }
        Ok(())
    }

    pub fn commit(&self, service: &SessionService) -> Result<TestRunCase> {
        service.database.with_immediate_tx(|tx| {
            update_case_on(tx, &self.case_id, &now(), |tx, owner, now| {
                if owner != self.session_id {
                    return Err(validation(
                        "Result notes must belong to the test run's Session",
                    ));
                }
                for (id, file) in &self.files {
                    if tx.execute(
                        "DELETE FROM chat_image_imports WHERE relative_path = ?1",
                        [&file.draft.relative_path],
                    )? != 1
                    {
                        return Err(validation("Result notes image import was interrupted"));
                    }
                    attachments::create_attachment_on(tx, id.clone(), file.draft.clone())?;
                    tx.execute(
                        "INSERT INTO test_run_note_images (attachment_id, case_id) VALUES (?1, ?2)",
                        params![id, self.case_id],
                    )?;
                }
                for id in &self.references {
                    super::require_row_in_session(
                        tx,
                        "attachments",
                        id,
                        owner,
                        "Result notes images must belong to the test run's Session",
                    ).map_err(|error| match error {
                        QaScribeError::NotFound(_) => validation("A screenshot is missing. Remove it from the result notes or add it again."),
                        other => other,
                    })?;
                }
                tx.execute(
                    "UPDATE test_run_cases SET notes_json = ?1, updated_at = ?2 WHERE id = ?3",
                    params![self.body_json, now, self.case_id],
                )?;
                Ok(())
            })
        })
    }

    pub fn recover(&self, service: &SessionService, root: &Path) {
        for (_, file) in &self.files {
            let _ = files::chat_imports::recover_chat_image_import(
                service,
                root,
                &file.draft.relative_path,
            );
        }
    }
}

impl SessionService {
    pub fn test_case_session_id(&self, case_id: &str) -> Result<String> {
        self.database.connection().query_row(
            "SELECT r.session_id FROM test_run_cases c JOIN test_runs r ON r.id = c.run_id WHERE c.id = ?1",
            [case_id],
            |row| row.get(0),
        ).optional()?.ok_or_else(|| QaScribeError::NotFound(case_id.into()))
    }

    /// Run before opening editors, whose undo history may still use removed images.
    pub fn reclaim_test_run_note_images(&self) -> Result<()> {
        self.database.with_immediate_tx(|tx| {
            let ids = tx
                .prepare(
                    "SELECT n.attachment_id FROM test_run_note_images n
                 LEFT JOIN test_run_cases c ON c.id = n.case_id
                 WHERE instr(COALESCE(c.notes_json, ''), n.attachment_id) = 0",
                )?
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for id in ids {
                if attachments::attachment_is_referenced_on(tx, &id)? {
                    continue;
                }
                let Some(attachment) = attachments::attachment_on(tx, &id)? else {
                    continue;
                };
                if !files::is_exact_attachment_path(
                    &attachment.relative_path,
                    &attachment.session_id,
                ) {
                    continue;
                }
                tx.execute(
                    "INSERT INTO chat_image_cleanup (relative_path, session_id) VALUES (?1, ?2)
                     ON CONFLICT(relative_path) DO NOTHING",
                    params![attachment.relative_path, attachment.session_id],
                )?;
                tx.execute("DELETE FROM attachments WHERE id = ?1", [&id])?;
            }
            Ok(())
        })
    }
}

fn prepare_image(session: &str, image: &TestCaseNoteImage) -> Result<PreparedManagedAttachment> {
    if image.data_url.len() > MAX_CHAT_IMAGE_BYTES.div_ceil(3) * 4 + 64 {
        return Err(validation(
            "Result notes images must be at most 10 MiB each",
        ));
    }
    let (mime, bytes) = files::decode_image_data_url(&image.data_url)?;
    validate_chat_image(&mime, &bytes)?;
    PreparedManagedAttachment::new(
        AttachmentDraft {
            session_id: session.into(),
            entry_id: None,
            filename: image.filename.clone(),
            mime_type: Some(mime),
            size_bytes: 0,
            sha256: String::new(),
            relative_path: String::new(),
        },
        bytes,
    )
}

fn parse(body: &str) -> Result<Value> {
    if body.len() > MAX_DOCUMENT_BYTES {
        return Err(validation("Result notes are too long"));
    }
    let document: Value =
        serde_json::from_str(body).map_err(|_| validation("Result notes contain invalid JSON"))?;
    if document["schemaVersion"].as_u64() != Some(1)
        || document["doc"]["type"].as_str() != Some("doc")
    {
        return Err(validation("Result notes require an editor document"));
    }
    Ok(document)
}

pub(super) fn append_suggested_notes(case: &TestRunCase, addition: &str) -> Result<String> {
    let mut document = match &case.notes {
        Some(notes) => parse(&notes.body_json)?,
        None => {
            let content = case
                .remark
                .as_deref()
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(crate::chat::markdown::literal)
                .unwrap_or_default();
            json!({"schemaVersion": 1, "doc": {"type": "doc", "content": content}})
        }
    };
    let doc = document["doc"]
        .as_object_mut()
        .expect("decoded editor document");
    let content = doc
        .entry("content")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .ok_or_else(|| validation("Result notes contain invalid content"))?;
    let mut addition = parse(addition)?;
    let blocks = addition["doc"]["content"]
        .as_array_mut()
        .expect("validated suggestion blocks");
    content.append(blocks);
    let body_json = document.to_string();
    if body_json.len() > MAX_DOCUMENT_BYTES {
        return Err(validation(
            "Result notes are too long to append this suggestion",
        ));
    }
    Ok(body_json)
}

fn collect_images<'a>(node: &'a Value, ids: &mut BTreeSet<&'a str>) -> Result<()> {
    if node["type"].as_str() == Some("image") {
        let src = node["attrs"]["src"].as_str().unwrap_or_default();
        let id = src
            .strip_prefix("qa-scribe-attachment://")
            .filter(|id| {
                Uuid::try_parse(id).is_ok()
                    && node["attrs"]["attachmentId"]
                        .as_str()
                        .is_none_or(|attr| attr == *id)
            })
            .ok_or_else(|| validation("Result notes require managed images"))?;
        ids.insert(id);
    }
    if let Some(children) = node["content"].as_array() {
        for child in children {
            collect_images(child, ids)?;
        }
    }
    Ok(())
}

pub(crate) fn summarize(body_json: String) -> TestCaseNotes {
    let mut text = String::new();
    let mut image_count = 0;
    if let Ok(document) = parse(&body_json) {
        project(&document["doc"], &mut text, &mut image_count);
    }
    TestCaseNotes {
        body_json,
        text: text.trim().into(),
        image_count,
    }
}

pub(super) fn project_body(body: &str) -> Result<String> {
    let value: Value =
        serde_json::from_str(body).map_err(|_| validation("Invalid test case document"))?;
    let mut text = String::new();
    let mut images = 0;
    project(value.get("doc").unwrap_or(&value), &mut text, &mut images);
    Ok(text.trim().into())
}

fn project(node: &Value, text: &mut String, image_count: &mut usize) {
    if node["type"] == "tableRow" {
        // One line per row, its cells separated by ` | `, as in `testware/testRunNotes.ts`.
        let cells: Vec<String> = node["content"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|cell| {
                let mut cell_text = String::new();
                project(cell, &mut cell_text, image_count);
                cell_text.split_whitespace().collect::<Vec<_>>().join(" ")
            })
            .collect();
        text.push_str(cells.join(" | ").trim_end());
        text.push('\n');
        return;
    }
    match node["type"].as_str() {
        Some("image") => *image_count += 1,
        Some("text") => text.push_str(node["text"].as_str().unwrap_or_default()),
        Some("horizontalRule") => text.push_str("---\n"),
        // A panel names its kind on a line of its own, as Generate's plain text does.
        Some("panel") => {
            let kind = node["attrs"]["kind"].as_str().unwrap_or_default();
            text.push_str(crate::generation::panel::label(kind));
            text.push_str(":\n");
        }
        _ => {}
    }
    if let Some(children) = node["content"].as_array() {
        for child in children {
            project(child, text, image_count);
        }
    }
    if matches!(
        node["type"].as_str(),
        Some("heading" | "paragraph" | "codeBlock" | "hardBreak")
    ) {
        text.push('\n');
    }
}
