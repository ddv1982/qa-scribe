use crate::domain::{Attachment, Entry, EntryType};

pub fn test_entry(id: &str, entry_type: EntryType, title: Option<&str>, body: &str) -> Entry {
    Entry {
        id: id.to_string(),
        session_id: "session-1".to_string(),
        entry_type,
        title: title.map(ToOwned::to_owned),
        body: body.to_string(),
        body_json: None,
        body_format: Some("html".to_string()),
        metadata_json: None,
        excluded_from_generation: false,
        created_at: "2026-06-23T00:00:00Z".to_string(),
        updated_at: "2026-06-23T00:00:00Z".to_string(),
    }
}

pub fn test_attachment(id: &str, entry_id: Option<&str>, filename: &str) -> Attachment {
    Attachment {
        id: id.to_string(),
        session_id: "session-1".to_string(),
        entry_id: entry_id.map(ToOwned::to_owned),
        filename: filename.to_string(),
        mime_type: Some("image/png".to_string()),
        size_bytes: 123,
        sha256: "a".repeat(64),
        relative_path: format!("attachments/session/{id}_{filename}"),
        created_at: "2026-06-23T00:00:00Z".to_string(),
    }
}
