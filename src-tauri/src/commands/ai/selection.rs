use qa_scribe_core::{
    QaScribeError,
    domain::{Entry, EntryType},
};

use super::types::{GenerateAiActionKind, GenerateAiActionRequest};

pub(super) fn selected_note_entry<'a>(
    request: &GenerateAiActionRequest,
    entries: &'a [Entry],
) -> qa_scribe_core::Result<Option<&'a Entry>> {
    if let Some(note_entry_id) = request.note_entry_id.as_deref() {
        let entry = entries
            .iter()
            .find(|entry| entry.id == note_entry_id)
            .ok_or_else(|| {
                QaScribeError::Validation(
                    "Selected note entry was not found in this Session.".to_string(),
                )
            })?;
        if entry.entry_type != EntryType::Note {
            return Err(QaScribeError::Validation(
                "Selected entry must be a Note.".to_string(),
            ));
        }
        return Ok(Some(entry));
    }

    if matches!(request.action, GenerateAiActionKind::Summary) {
        return Err(QaScribeError::Validation(
            "Summarize notes requires an editable note entry.".to_string(),
        ));
    }

    Ok(entries
        .iter()
        .find(|entry| entry.entry_type == EntryType::Note))
}
