use super::{Draft, Finding, RecordWriteGuard, RecordWriteOrigin};
use sha2::{Digest, Sha256};

impl RecordWriteGuard {
    pub fn finding(record: &Finding) -> Self {
        Self::from_fields(
            "findings",
            &record.session_id,
            &record.id,
            (
                &record.title,
                &record.body,
                &record.body_json,
                record.body_format.as_deref().unwrap_or("html"),
                record.kind.as_str(),
                &record.metadata_json,
            ),
        )
    }
    pub fn draft(record: &Draft) -> Self {
        Self::from_fields(
            "drafts",
            &record.session_id,
            &record.id,
            (
                &record.title,
                &record.body,
                &record.body_json,
                record.body_format.as_deref().unwrap_or("html"),
                record.kind.as_str(),
                &record.metadata_json,
            ),
        )
    }
    fn from_fields(
        table: &str,
        session_id: &str,
        id: &str,
        fields: (&str, &str, &Option<String>, &str, &str, &Option<String>),
    ) -> Self {
        let bytes =
            serde_json::to_vec(&(table, session_id, id, fields)).expect("serializable record base");
        Self {
            session_id: session_id.into(),
            expected_stored_base: format!("{:x}", Sha256::digest(bytes)),
            origin: RecordWriteOrigin::Editor,
        }
    }
}
