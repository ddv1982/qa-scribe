use super::*;

fn request(chat: &ChatState, index: usize) -> TestRunSuggestionRequest {
    TestRunSuggestionRequest {
        reference: ChatRef {
            session_id: chat.session_id.clone(),
            draft_id: chat.draft_id.clone(),
        },
        suggestion_id: chat.test_run_suggestions[index].id.clone(),
    }
}

fn apply(f: &Fixture, chat: &ChatState) -> TestRunSuggestionOutcome {
    f.service
        .apply_test_run_suggestion(request(chat, 0))
        .unwrap()
}

fn saved(outcome: TestRunSuggestionOutcome) -> Box<TestRunCase> {
    match outcome {
        TestRunSuggestionOutcome::Saved { test_case, .. } => test_case,
        other => panic!("expected saved case, got {other:?}"),
    }
}

#[test]
fn an_edit_during_the_turn_makes_the_suggestion_stale() {
    let f = fixture();
    let id = &f.run.cases[0].id;
    let started = start(
        &f,
        &write(&f, &begin(&f), "Record the failure"),
        ChatRequestIntent::Message,
    )
    .unwrap();
    let manual = f
        .service
        .set_test_case_result(id, TestCaseResult::Passed, None)
        .unwrap();
    let chat = finish(&f, started, json!([suggested(id)]));
    assert!(
        matches!(apply(&f, &chat), TestRunSuggestionOutcome::OutOfDate { test_case, .. } if *test_case == manual)
    );
    assert_eq!(f.service.get_test_run(&f.run.id).unwrap().cases[0], manual);
}

#[test]
fn retrying_an_apply_writes_once_and_keeps_the_original_undo() {
    let f = fixture();
    let id = &f.run.cases[0].id;
    let chat = offer(&f, json!([suggested(id)]));
    let first = saved(apply(&f, &chat));
    let retried = saved(apply(&f, &chat));
    assert_eq!(retried, first);
    assert_eq!(first.notes.unwrap().text, "HTTP 500");
    let restored = saved(
        f.service
            .undo_test_run_suggestion(request(&chat, 0))
            .unwrap(),
    );
    assert_eq!(
        (restored.result, restored.notes, restored.remark),
        (TestCaseResult::NotRun, None, None)
    );
}

#[test]
fn apply_seeds_a_legacy_remark_and_undo_restores_it_without_notes() {
    let f = fixture();
    let id = &f.run.cases[0].id;
    let old = f
        .service
        .set_test_case_result(id, TestCaseResult::Blocked, Some("Original remark".into()))
        .unwrap();
    let chat = offer(&f, json!([suggested(id)]));
    let current = saved(apply(&f, &chat));
    let notes = current.notes.unwrap();
    assert_eq!(notes.text, "Original remark\nHTTP 500");
    assert!(
        notes.body_json.contains("\"type\":\"bold\""),
        "Markdown was parsed"
    );
    let restored = saved(
        f.service
            .undo_test_run_suggestion(request(&chat, 0))
            .unwrap(),
    );
    assert_eq!(
        (restored.result, restored.notes, restored.remark),
        (old.result, old.notes, old.remark)
    );
}

#[test]
fn oversized_appended_notes_leave_the_case_and_suggestion_untouched() {
    let f = fixture();
    let id = &f.run.cases[0].id;
    let notes = json!({"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text": "x".repeat(65400)}]}]}}).to_string();
    f.service
        .database()
        .connection()
        .execute(
            "UPDATE test_run_cases SET notes_json=?1 WHERE id=?2",
            [&notes, id],
        )
        .unwrap();
    let before = f.service.get_test_run(&f.run.id).unwrap();
    let mut draft = suggested(id);
    draft["notesMarkdown"] = json!("new words".repeat(20));
    let chat = offer(&f, json!([draft]));
    let error = validation_message(f.service.apply_test_run_suggestion(request(&chat, 0)));
    assert!(error.contains("Result notes are too long"), "{error}");
    assert_eq!(f.service.get_test_run(&f.run.id).unwrap(), before);
    assert_eq!(
        f.service
            .read_chat(&request(&chat, 0).reference)
            .unwrap()
            .test_run_suggestions,
        chat.test_run_suggestions
    );
}

#[test]
fn apply_all_updates_eligible_cases_and_reports_a_stale_case() {
    let f = fixture();
    let first = &f.run.cases[0].id;
    let second = &f.run.cases[1].id;
    let chat = offer(&f, json!([suggested(first), suggested(second)]));
    f.service
        .set_test_case_result(first, TestCaseResult::Passed, None)
        .unwrap();
    let outcomes = f
        .service
        .apply_all_test_run_suggestions(TestRunSuggestionsRequest {
            reference: request(&chat, 0).reference,
            assistant_message_id: chat.messages.last().unwrap().id.clone(),
        })
        .unwrap();
    assert!(
        matches!(&outcomes[0], TestRunSuggestionOutcome::OutOfDate { test_case, .. } if &test_case.id == first)
    );
    assert!(
        matches!(&outcomes[1], TestRunSuggestionOutcome::Saved { test_case, .. } if &test_case.id == second)
    );
    let run = f.service.get_test_run(&f.run.id).unwrap();
    assert_eq!(
        (run.cases[0].result, run.cases[1].result),
        (TestCaseResult::Passed, TestCaseResult::Failed)
    );
}

#[test]
fn undo_after_a_later_edit_does_not_restore_old_values() {
    let f = fixture();
    let case_id = &f.run.cases[0].id;
    let chat = offer(&f, json!([suggested(case_id)]));
    saved(apply(&f, &chat));
    let manual = f
        .service
        .set_test_case_result(
            case_id,
            TestCaseResult::Blocked,
            Some("Edited manually".into()),
        )
        .unwrap();
    let result = f
        .service
        .undo_test_run_suggestion(request(&chat, 0))
        .unwrap();
    assert!(
        matches!(result, TestRunSuggestionOutcome::OutOfDate { test_case, .. } if *test_case == manual)
    );
    assert_eq!(f.service.get_test_run(&f.run.id).unwrap().cases[0], manual);
}
