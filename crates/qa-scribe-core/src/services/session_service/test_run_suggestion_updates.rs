use rusqlite::{Connection, OptionalExtension, params};

use super::{
    SessionService, chat_rows, now,
    test_run_log_evidence::attached_log_evidence,
    test_run_notes::append_suggested_notes,
    test_run_suggestions::{SUGGESTION_COLUMNS, map_suggestion},
    test_runs::{test_run_case, update_case_on},
};
use crate::{QaScribeError, Result, domain::*, error::validation};

impl SessionService {
    pub fn apply_test_run_suggestion(
        &self,
        request: TestRunSuggestionRequest,
    ) -> Result<TestRunSuggestionOutcome> {
        self.database
            .with_immediate_tx(|tx| update(tx, &request, false))
    }

    pub fn apply_all_test_run_suggestions(
        &self,
        request: TestRunSuggestionsRequest,
    ) -> Result<Vec<TestRunSuggestionOutcome>> {
        let chat = chat_rows::owned_id(self.database.connection(), &request.reference)?;
        chat_rows::editable(&chat)?;
        if !matches!(chat.owner, ConversationOwner::TestRun { .. })
            || !chat.messages.iter().any(|message| {
                message.id == request.assistant_message_id && message.role == ChatRole::Assistant
            })
        {
            return Err(validation(
                "These suggested results belong to another conversation",
            ));
        }
        Ok(chat
            .test_run_suggestions
            .into_iter()
            .filter(|suggestion| {
                suggestion.assistant_message_id == request.assistant_message_id
                    && suggestion.applied_fingerprint.is_none()
            })
            .map(|suggestion| {
                self.apply_test_run_suggestion(TestRunSuggestionRequest {
                    reference: request.reference.clone(),
                    suggestion_id: suggestion.id,
                })
                .unwrap_or_else(|error| TestRunSuggestionOutcome::Failed {
                    case_id: suggestion.case_id,
                    message: match error {
                        QaScribeError::Validation(message) => message,
                        _ => "Could not update this test case. Try again.".into(),
                    },
                })
            })
            .collect())
    }

    pub fn undo_test_run_suggestion(
        &self,
        request: TestRunSuggestionRequest,
    ) -> Result<TestRunSuggestionOutcome> {
        self.database
            .with_immediate_tx(|tx| update(tx, &request, true))
    }
}

struct StoredResult {
    result: String,
    notes_json: Option<String>,
    remark: Option<String>,
}

impl StoredResult {
    fn from_case(case: &TestRunCase) -> Self {
        Self {
            result: case.result.as_str().into(),
            notes_json: case.notes.as_ref().map(|notes| notes.body_json.clone()),
            remark: case.remark.clone(),
        }
    }
}

fn update(
    tx: &Connection,
    request: &TestRunSuggestionRequest,
    undo: bool,
) -> Result<TestRunSuggestionOutcome> {
    let (mut suggestion, previous) = tx
        .query_row(
            &format!(
        "SELECT {SUGGESTION_COLUMNS}, s.previous_result, s.previous_notes_json, s.previous_remark
         FROM chat_test_run_suggestions s
         JOIN chat_messages a ON a.id = s.assistant_message_id AND a.role = 'assistant'
         JOIN chat_drafts d ON d.id = a.draft_id AND d.owner_kind = 'test_run'
         JOIN test_run_cases c ON c.id = s.case_id AND c.run_id = d.owner_record_id
         JOIN test_runs r ON r.id = c.run_id AND r.session_id = d.session_id
         WHERE s.id = ?1 AND d.id = ?2 AND d.session_id = ?3 AND d.archived = 0"
    ),
            params![
                request.suggestion_id,
                request.reference.draft_id,
                request.reference.session_id
            ],
            |row| {
                let previous = row
                    .get::<_, Option<String>>(9)?
                    .map(|result| {
                        Ok::<_, rusqlite::Error>(StoredResult {
                            result,
                            notes_json: row.get(10)?,
                            remark: row.get(11)?,
                        })
                    })
                    .transpose()?;
                Ok((map_suggestion(row)?, previous))
            },
        )
        .optional()?
        .ok_or_else(|| {
            validation("This suggested result is no longer available in this conversation")
        })?;
    let case = test_run_case(tx, &suggestion.case_id)?;
    let expected = suggestion
        .applied_fingerprint
        .as_ref()
        .unwrap_or(&suggestion.base_fingerprint);
    if &case.suggestion_fingerprint != expected {
        return Ok(TestRunSuggestionOutcome::OutOfDate {
            test_case: Box::new(case),
            suggestion,
        });
    }
    let applied = previous.is_some();
    if undo != applied {
        return saved_outcome(tx, case, suggestion);
    }
    let original = StoredResult::from_case(&case);
    let notes = suggestion.notes_json.as_deref();
    let next = if let Some(previous) = previous {
        previous
    } else {
        StoredResult {
            result: suggestion.result.unwrap_or(case.result).as_str().into(),
            notes_json: notes
                .map(|notes| append_suggested_notes(&case, notes))
                .transpose()?
                .or_else(|| original.notes_json.clone()),
            remark: original.remark.clone(),
        }
    };
    update_log_attachments(tx, request, &suggestion, &case, undo)?;
    let saved = update_case_on(tx, &case.id, &now(), |tx, _, changed_at| {
        tx.execute(
            "UPDATE test_run_cases SET result = ?1, notes_json = ?2, remark = ?3, updated_at = ?4 WHERE id = ?5",
            params![next.result, next.notes_json, next.remark, changed_at, case.id],
        )?;
        Ok(())
    })?;
    let original = (!undo).then_some(original);
    suggestion.applied_fingerprint = (!undo).then(|| saved.suggestion_fingerprint.clone());
    tx.execute(
        "UPDATE chat_test_run_suggestions SET applied_fingerprint = ?1, previous_result = ?2,
         previous_notes_json = ?3, previous_remark = ?4 WHERE id = ?5",
        params![
            suggestion.applied_fingerprint,
            original.as_ref().map(|v| &v.result),
            original.as_ref().and_then(|v| v.notes_json.as_deref()),
            original.as_ref().and_then(|v| v.remark.as_deref()),
            suggestion.id,
        ],
    )?;
    saved_outcome(tx, saved, suggestion)
}

fn saved_outcome(
    tx: &Connection,
    case: TestRunCase,
    suggestion: TestRunSuggestion,
) -> Result<TestRunSuggestionOutcome> {
    let log_evidence = (!suggestion.capture_ids.is_empty())
        .then(|| attached_log_evidence(tx, &case.run_id))
        .transpose()?;
    Ok(TestRunSuggestionOutcome::Saved {
        test_case: Box::new(case),
        suggestion,
        log_evidence,
    })
}

fn update_log_attachments(
    tx: &Connection,
    request: &TestRunSuggestionRequest,
    suggestion: &TestRunSuggestion,
    case: &TestRunCase,
    undo: bool,
) -> Result<()> {
    if suggestion.capture_ids.is_empty() {
        return Ok(());
    }
    if undo {
        tx.execute(
            "UPDATE test_run_log_captures SET case_id = NULL WHERE case_id = ?1 AND id IN
             (SELECT capture_id FROM chat_suggestion_log_captures WHERE suggestion_id = ?2 AND attached = 1)",
            params![case.id, suggestion.id],
        )?;
        return Ok(());
    }
    let count: u32 = tx.query_row(
        "SELECT COUNT(*) FROM test_run_log_captures WHERE case_id = ?1",
        [&case.id],
        |row| row.get(0),
    )?;
    if count as usize + suggestion.capture_ids.len() > 10 {
        return Err(validation(
            "At most 10 log captures can be attached to a test case.",
        ));
    }
    for capture_id in &suggestion.capture_ids {
        let count = tx.execute(
            "UPDATE test_run_log_captures SET case_id = ?1
             WHERE id = ?2 AND origin = 'ask_ai' AND conversation_id = ?3
               AND run_id = ?4 AND session_id = ?5 AND case_id IS NULL",
            params![
                case.id,
                capture_id,
                request.reference.draft_id,
                case.run_id,
                request.reference.session_id
            ],
        )?;
        if count != 1 {
            return Err(validation(
                "This log capture has already been attached or is no longer available.",
            ));
        }
        tx.execute(
            "UPDATE chat_suggestion_log_captures SET attached = 1 WHERE suggestion_id = ?1 AND capture_id = ?2",
            params![suggestion.id, capture_id],
        )?;
    }
    Ok(())
}
