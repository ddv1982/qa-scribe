use super::outcomes::{begin, finish};
use super::*;

fn update_request(chat: &ChatState) -> ApplyRefinementRequest {
    ApplyRefinementRequest {
        reference: ChatRef {
            session_id: chat.session_id.clone(),
            draft_id: chat.draft_id.clone(),
        },
        proposal_id: chat.proposals[0].id.clone(),
    }
}

fn stored_record(
    service: &SessionService,
    finding: &Finding,
    test_cases: bool,
) -> serde_json::Value {
    if test_cases {
        serde_json::to_value(&service.list_drafts(&finding.session_id).unwrap()[0]).unwrap()
    } else {
        serde_json::to_value(&service.list_findings(&finding.session_id).unwrap()[0]).unwrap()
    }
}

#[test]
fn atomic_update_saves_both_kinds_and_retry_never_overwrites_a_later_edit() {
    for test_cases in [false, true] {
        let (service, finding, _, start) = begin(test_cases, "Improve this record", false);
        let kind = if test_cases {
            "test_cases_draft"
        } else {
            "finding"
        };
        let chat = finish(
            &service,
            start,
            json!({"kind":"edit","patch":{"kind":kind,"title":"After","bodyMarkdown":"**Expected:** Keep the error visible."}}),
        );
        let request = update_request(&chat);
        let result = service.apply_refinement(request.clone()).unwrap();
        assert_eq!(result.chat.proposals[0].state, RefinementState::Applied);
        let saved = stored_record(&service, &finding, test_cases);
        assert_eq!(saved["title"], "After");
        assert!(
            saved["body"]
                .as_str()
                .unwrap()
                .contains("<strong>Expected:</strong>")
        );
        assert!(
            saved["bodyJson"]
                .as_str()
                .unwrap()
                .contains("qa-scribe-attachment://original")
        );
        assert_eq!(
            saved["metadataJson"],
            chat.proposals[0]
                .before
                .metadata_json
                .clone()
                .map(serde_json::Value::String)
                .unwrap_or_default()
        );
        let stages: i64 = service
            .database()
            .connection()
            .query_row("SELECT COUNT(*) FROM chat_editor_stages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stages, 0);
        let table = if test_cases { "drafts" } else { "findings" };
        service
            .database()
            .connection()
            .execute(&format!("UPDATE {table} SET title='Later manual edit'"), [])
            .unwrap();
        let retry = service.apply_refinement(request).unwrap();
        assert_eq!(retry.chat.revision, result.chat.revision);
        assert_eq!(
            stored_record(&service, &finding, test_cases)["title"],
            "Later manual edit"
        );
    }
}

#[test]
fn atomic_update_rejects_stale_records_and_unrelated_conversations() {
    for test_cases in [false, true] {
        let (service, finding, _, start) = begin(test_cases, "Improve this record", false);
        let kind = if test_cases {
            "test_cases_draft"
        } else {
            "finding"
        };
        let chat = finish(
            &service,
            start,
            json!({"kind":"edit","patch":{"kind":kind,"title":"After"}}),
        );
        let mut request = update_request(&chat);
        let other = service.load_chat(&finding.session_id).unwrap();
        request.reference.draft_id = other.draft_id;
        assert!(service.apply_refinement(request).is_err());
        let table = if test_cases { "drafts" } else { "findings" };
        service
            .database()
            .connection()
            .execute(
                &format!("UPDATE {table} SET title='Newer saved record'"),
                [],
            )
            .unwrap();
        let before = stored_record(&service, &finding, test_cases);
        assert!(service.apply_refinement(update_request(&chat)).is_err());
        assert_eq!(stored_record(&service, &finding, test_cases), before);
        assert_eq!(
            service
                .read_chat(&update_request(&chat).reference)
                .unwrap()
                .proposals[0]
                .state,
            RefinementState::Offered
        );
    }
}

#[test]
fn atomic_update_rolls_back_record_when_proposal_completion_cannot_be_saved() {
    for test_cases in [false, true] {
        let (service, finding, _, start) = begin(test_cases, "Improve this record", false);
        let kind = if test_cases {
            "test_cases_draft"
        } else {
            "finding"
        };
        let chat = finish(
            &service,
            start,
            json!({"kind":"edit","patch":{"kind":kind,"title":"After"}}),
        );
        let before = stored_record(&service, &finding, test_cases);
        service.database().connection().execute_batch("CREATE TRIGGER fail_update BEFORE UPDATE ON chat_refinements BEGIN SELECT RAISE(ABORT, 'disk full'); END;").unwrap();
        assert!(service.apply_refinement(update_request(&chat)).is_err());
        assert_eq!(stored_record(&service, &finding, test_cases), before);
        assert_eq!(
            service.read_chat(&update_request(&chat).reference).unwrap(),
            chat
        );
    }
}

#[test]
fn title_only_update_preserves_the_stored_rich_body_exactly() {
    for test_cases in [false, true] {
        let (service, finding, _, start) = begin(test_cases, "Improve the title", false);
        let kind = if test_cases {
            "test_cases_draft"
        } else {
            "finding"
        };
        let chat = finish(
            &service,
            start,
            json!({"kind":"edit","patch":{"kind":kind,"title":"After"}}),
        );
        let before = stored_record(&service, &finding, test_cases);
        service.apply_refinement(update_request(&chat)).unwrap();
        let after = stored_record(&service, &finding, test_cases);
        for field in ["body", "bodyJson", "bodyFormat", "metadataJson"] {
            assert_eq!(after[field], before[field]);
        }
    }
}

#[test]
fn title_only_update_includes_unsaved_editor_content_in_the_saved_record() {
    for test_cases in [false, true] {
        let (service, finding, _, start) = begin(test_cases, "Improve the title", true);
        let kind = if test_cases {
            "test_cases_draft"
        } else {
            "finding"
        };
        let chat = finish(
            &service,
            start,
            json!({"kind":"edit","patch":{"kind":kind,"title":"After"}}),
        );
        service.apply_refinement(update_request(&chat)).unwrap();
        let saved = stored_record(&service, &finding, test_cases);
        assert_eq!(saved["bodyJson"], chat.proposals[0].after.document_json);
        assert!(saved["body"].as_str().unwrap().contains("Before body"));
        assert!(
            saved["body"]
                .as_str()
                .unwrap()
                .contains("qa-scribe-attachment://original")
        );
    }
}
