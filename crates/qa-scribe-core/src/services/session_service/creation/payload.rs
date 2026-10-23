use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::{
    Result,
    attachments::{decode_image_data_url, hex_sha256},
    domain::*,
    error::validation,
    generation::{attribute_value, find_html_tag_end, managed_attachment_protocol},
};

use super::CreationAttemptImage;

pub(crate) fn normalize_record(mut record: CreationRecordInput) -> Result<CreationRecordInput> {
    let (title, body, body_json, body_format, metadata_json, limit) = match &mut record {
        CreationRecordInput::Finding {
            title,
            body,
            body_json,
            body_format,
            metadata_json,
            ..
        } => (
            title,
            body,
            body_json,
            body_format,
            metadata_json,
            TEXT_BODY_MAX_LENGTH,
        ),
        CreationRecordInput::Testware {
            title,
            body,
            body_json,
            body_format,
            metadata_json,
        } => (
            title,
            body,
            body_json,
            body_format,
            metadata_json,
            DRAFT_BODY_MAX_LENGTH,
        ),
    };
    *title = validate_required_text("Creation title", title, TITLE_MAX_LENGTH)?;
    *body = validate_body_text("Creation body", body, limit)?;
    *body_json = canonical_json(validate_body_json(body_json.take())?);
    *metadata_json = canonical_json(validate_metadata_json(metadata_json.take())?);
    *body_format = Some(
        validate_optional_text(
            "Creation body format",
            body_format.take(),
            BODY_FORMAT_MAX_LENGTH,
        )?
        .unwrap_or_else(|| "html".into()),
    );
    Ok(record)
}

fn canonical_json(value: Option<String>) -> Option<String> {
    value.map(|value| {
        serde_json::to_string(
            &serde_json::from_str::<Value>(&value).expect("validated creation JSON"),
        )
        .expect("JSON values serialize")
    })
}

pub(crate) fn kind(record: &CreationRecordInput) -> CreationKind {
    match record {
        CreationRecordInput::Finding { .. } => CreationKind::Finding,
        CreationRecordInput::Testware { .. } => CreationKind::Testware,
    }
}

pub(crate) fn validate_references(
    record: &CreationRecordInput,
    owned: &[CreationAttemptImage],
    shared: &[String],
) -> Result<()> {
    let (body, body_json) = match record {
        CreationRecordInput::Finding {
            body, body_json, ..
        }
        | CreationRecordInput::Testware {
            body, body_json, ..
        } => (body, body_json),
    };
    let mut actual = BTreeSet::new();
    let mut cursor = 0;
    while let Some(start) = body[cursor..].find('<').map(|offset| cursor + offset + 1) {
        let Some(end) = find_html_tag_end(body, start) else {
            return Err(validation("Creation HTML tag is incomplete"));
        };
        let tag = &body[start..end];
        let name = tag
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_end_matches('/');
        if name.eq_ignore_ascii_case("img") {
            collect_image(
                attribute_value(tag, "data-attachment-id").as_deref(),
                attribute_value(tag, "src").as_deref(),
                &mut actual,
            )?;
        }
        cursor = end + 1;
    }
    if let Some(json) = body_json {
        let mut json_ids = BTreeSet::new();
        collect_json(
            &serde_json::from_str::<Value>(json).expect("validated creation JSON"),
            &mut json_ids,
        )?;
        if actual != json_ids {
            return Err(validation("Creation HTML and JSON image references differ"));
        }
    }
    let owned_ids: BTreeSet<_> = owned
        .iter()
        .map(|image| image.attachment_id.clone())
        .collect();
    if shared.iter().any(|id| owned_ids.contains(id)) {
        return Err(validation("Owned images cannot be borrowed shared images"));
    }
    let expected: BTreeSet<_> = owned_ids
        .into_iter()
        .chain(shared.iter().cloned())
        .collect();
    if actual != expected {
        return Err(validation(
            "Creation image references must exactly match owned and shared images",
        ));
    }
    Ok(())
}

fn collect_image(id: Option<&str>, source: Option<&str>, ids: &mut BTreeSet<String>) -> Result<()> {
    let source = source.unwrap_or("").trim();
    if source.to_ascii_lowercase().starts_with("data:")
        || source.to_ascii_lowercase().starts_with("blob:")
    {
        return Err(validation(
            "Creation images must be materialized before commit",
        ));
    }
    let protocol = managed_attachment_protocol();
    let source_id = source
        .strip_prefix(&protocol)
        .filter(|value| !value.is_empty());
    let id = id.filter(|value| !value.is_empty());
    if id.is_some() && source_id.is_some() && id != source_id {
        return Err(validation(
            "Creation image identity does not match its source",
        ));
    }
    if let Some(id) = id.or(source_id) {
        validate_required_text("Managed image ID", id, 160)?;
        ids.insert(id.into());
    }
    Ok(())
}

fn collect_json(value: &Value, ids: &mut BTreeSet<String>) -> Result<()> {
    match value {
        Value::Array(values) => {
            for value in values {
                collect_json(value, ids)?;
            }
        }
        Value::Object(object) => {
            if object.get("type").and_then(Value::as_str) == Some("image") {
                let attrs = object
                    .get("attrs")
                    .ok_or_else(|| validation("Creation image attributes are missing"))?;
                collect_image(
                    attrs.get("attachmentId").and_then(Value::as_str),
                    attrs.get("src").and_then(Value::as_str),
                    ids,
                )?;
            }
            for value in object.values() {
                collect_json(value, ids)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub(crate) fn image_bytes(
    images: Vec<CreationImageInput>,
    slots: &[CreationAttemptImage],
) -> Result<BTreeMap<String, Vec<u8>>> {
    let mut bytes = BTreeMap::new();
    for image in images {
        let slot = slots
            .iter()
            .find(|slot| slot.descriptor.local_id == image.local_id)
            .ok_or_else(|| validation("Image has no creation reservation"))?;
        let (mime, decoded) = decode_image_data_url(&image.data_url)?;
        if mime != slot.descriptor.mime_type
            || decoded.len() as u64 != u64::from(slot.descriptor.size_bytes)
            || hex_sha256(&decoded) != slot.descriptor.sha256
        {
            return Err(validation(
                "Creation image bytes do not match its reservation",
            ));
        }
        if bytes.insert(image.local_id, decoded).is_some() {
            return Err(validation("Duplicate creation image bytes"));
        }
    }
    if bytes.len() != slots.len() {
        return Err(validation("Creation image bytes are incomplete"));
    }
    Ok(bytes)
}

pub(crate) fn fingerprint(
    session: &str,
    record: &CreationRecordInput,
    images: &[CreationAttemptImage],
    shared: &[String],
) -> String {
    hex_sha256(
        &serde_json::to_vec(&(
            1,
            session,
            record,
            images
                .iter()
                .map(|image| &image.descriptor)
                .collect::<Vec<_>>(),
            shared,
        ))
        .expect("creation payload contains only JSON-compatible values"),
    )
}
