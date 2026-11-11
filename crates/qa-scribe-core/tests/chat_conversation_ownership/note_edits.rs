use super::*;
use serde_json::json;

fn notes_turn(service: &SessionService, session_id: &str, outcome: serde_json::Value) -> ChatState {
    let chat = service.load_chat(session_id).unwrap();
    let chat = service
        .save_chat_composer(composer(
            &chat,
            "Make my note clearer",
            ChatComposerIntent::Message,
        ))
        .unwrap();
    let started = service
        .start_chat_turn_with_response(
            ChatStartRequest {
                scope: scope(&chat),
            },
            ChatTarget::Session,
            ChatRequestIntent::Message,
        )
        .unwrap();
    let user = &started.chat.messages[0];
    let contract = service.response_contract(&user.id).unwrap().unwrap();
    assert_eq!(contract.version(), 3);
    assert_eq!(
        contract.purpose(),
        ChatResponsePurpose::Refinement {
            record_kind: RefinementRecordKind::Note
        }
    );
    service
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            assistant_text: json!({"version":3,"requestId":user.id,"markdown":"Grouped the setup.","outcome":outcome}).to_string(),
        })
        .unwrap()
}

#[test]
fn notes_conversation_offers_a_whole_note_edit_that_update_marks_applied() {
    let service = SessionService::in_memory().unwrap();
    let session_id = session(&service);
    let chat = notes_turn(
        &service,
        &session_id,
        json!({"kind":"edit","patch":{"kind":"note","bodyMarkdown":"## Setup\n\n- Build 4.2.1 on staging"}}),
    );
    assert_eq!(chat.messages.last().unwrap().text, "Grouped the setup.");
    let proposal = &chat.proposals[0];
    assert_eq!(proposal.target, ChatTarget::Session);
    assert!(
        proposal
            .after
            .document_json
            .contains("Build 4.2.1 on staging")
    );
    assert_eq!(proposal.state, RefinementState::Offered);

    let request = |chat: &ChatState| RefinementRequest {
        scope: scope(chat),
        proposal_id: proposal.id.clone(),
        action: RefinementAction::Stage,
    };
    let applied = service.resolve_refinement(request(&chat)).unwrap();
    assert_eq!(applied.proposals[0].state, RefinementState::Applied);
    let again = service.resolve_refinement(request(&applied)).unwrap();
    assert_eq!(again.proposals[0].state, RefinementState::Applied);
}

#[test]
fn notes_conversation_answers_without_a_proposal_and_rejects_a_blank_note_edit() {
    let service = SessionService::in_memory().unwrap();
    let session_id = session(&service);
    let answered = notes_turn(&service, &session_id, json!({"kind":"answer"}));
    assert!(answered.proposals.is_empty());

    let other = session(&service);
    let blank = notes_turn(
        &service,
        &other,
        json!({"kind":"edit","patch":{"kind":"note","bodyMarkdown":"  "}}),
    );
    assert!(blank.proposals.is_empty());
    assert!(
        blank
            .messages
            .last()
            .unwrap()
            .response
            .as_ref()
            .unwrap()
            .warning
            .is_some()
    );
}

#[test]
fn a_note_too_long_for_the_context_gets_no_whole_note_edit_contract() {
    let service = SessionService::in_memory().unwrap();
    let session_id = session(&service);
    let note = service.get_or_create_note_entry(&session_id).unwrap();
    service
        .update_entry(
            &note.id,
            EntryPatch {
                body: Some(format!("<p>{}</p>", "observation ".repeat(2000))),
                ..Default::default()
            },
        )
        .unwrap();
    let chat = service.load_chat(&session_id).unwrap();
    let chat = service
        .save_chat_composer(composer(
            &chat,
            "Rewrite my note",
            ChatComposerIntent::Message,
        ))
        .unwrap();
    let started = service
        .start_chat_turn_with_response(
            ChatStartRequest {
                scope: scope(&chat),
            },
            ChatTarget::Session,
            ChatRequestIntent::Message,
        )
        .unwrap();
    let contract = service
        .response_contract(&started.chat.messages[0].id)
        .unwrap()
        .unwrap();
    assert_eq!(contract.purpose(), ChatResponsePurpose::Conversation);
    assert_eq!(contract.version(), 2);
}

#[test]
fn a_clarification_reply_loses_the_note_edit_contract_once_the_note_no_longer_fits() {
    let service = SessionService::in_memory().unwrap();
    let session_id = session(&service);
    let asked = notes_turn(
        &service,
        &session_id,
        json!({"kind":"clarification","question":{"prompt":"Which part?","choices":["Setup","Result"]}}),
    );
    let assistant = asked.messages.last().unwrap().id.clone();
    let note = service.get_or_create_note_entry(&session_id).unwrap();
    service
        .update_entry(
            &note.id,
            EntryPatch {
                body: Some(format!("<p>{}</p>", "observation ".repeat(2000))),
                ..Default::default()
            },
        )
        .unwrap();
    let chat = service.load_chat(&session_id).unwrap();
    let started = service
        .start_chat_turn_with_response(
            ChatStartRequest {
                scope: scope(&chat),
            },
            ChatTarget::Session,
            ChatRequestIntent::QuestionReply {
                assistant_message_id: assistant,
                text: "Setup".into(),
            },
        )
        .unwrap();
    let contract = service
        .response_contract(&started.chat.messages.last().unwrap().id)
        .unwrap()
        .unwrap();
    assert_eq!(contract.purpose(), ChatResponsePurpose::Conversation);
}

#[test]
fn a_suggestion_is_rejected_once_the_note_changed_after_it_was_requested() {
    let service = SessionService::in_memory().unwrap();
    let session_id = session(&service);
    let chat = notes_turn(
        &service,
        &session_id,
        json!({"kind":"edit","patch":{"kind":"note","bodyMarkdown":"Rewritten"}}),
    );
    let note = service.get_or_create_note_entry(&session_id).unwrap();
    service
        .update_entry(
            &note.id,
            EntryPatch {
                body: Some("<p>Edited while the AI was writing</p>".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let error = service
        .resolve_refinement(RefinementRequest {
            scope: scope(&chat),
            proposal_id: chat.proposals[0].id.clone(),
            action: RefinementAction::Stage,
        })
        .unwrap_err();
    assert!(error.to_string().contains("The note changed"), "{error}");
}

fn set_note(service: &SessionService, session_id: &str, body: String) {
    let note = service.get_or_create_note_entry(session_id).unwrap();
    service
        .update_entry(
            &note.id,
            EntryPatch {
                body: Some(body),
                ..Default::default()
            },
        )
        .unwrap();
}

fn failed_notes_turn(service: &SessionService, session_id: &str) -> ChatState {
    let chat = service.load_chat(session_id).unwrap();
    let chat = service
        .save_chat_composer(composer(
            &chat,
            "Rewrite my note",
            ChatComposerIntent::Message,
        ))
        .unwrap();
    let started = service
        .start_chat_turn_with_response(
            ChatStartRequest {
                scope: scope(&chat),
            },
            ChatTarget::Session,
            ChatRequestIntent::Message,
        )
        .unwrap();
    service
        .fail_chat_turn(ChatFailRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id,
            kind: ChatFailureKind::Failed,
            error_message: "Synthetic failure".into(),
        })
        .unwrap()
}

#[test]
fn a_retry_after_the_note_changed_cannot_overwrite_it() {
    // Response contracts are immutable, so a retried turn keeps the fingerprint of the Note it was
    // first sent with; any rewrite from it is rejected once the Note has changed since.
    let service = SessionService::in_memory().unwrap();
    let session_id = session(&service);
    set_note(&service, &session_id, "<p>First draft</p>".into());
    let failed = failed_notes_turn(&service, &session_id);
    set_note(&service, &session_id, "<p>Edited before Retry</p>".into());
    let retried = service
        .retry_chat_turn(ChatStartRequest {
            scope: scope(&failed),
        })
        .unwrap();
    let user = retried.chat.messages.last().unwrap().id.clone();
    let done = service
        .finish_chat_turn(ChatFinishRequest {
            scope: scope(&retried.chat),
            turn_id: retried.turn_id,
            assistant_text: json!({"version":3,"requestId":user,"markdown":"Clearer.","outcome":{"kind":"edit","patch":{"kind":"note","bodyMarkdown":"Rewritten"}}}).to_string(),
        })
        .unwrap();
    let error = service
        .resolve_refinement(RefinementRequest {
            scope: scope(&done),
            proposal_id: done.proposals[0].id.clone(),
            action: RefinementAction::Stage,
        })
        .unwrap_err();
    assert!(error.to_string().contains("The note changed"), "{error}");
}

#[test]
fn undoing_a_note_update_offers_the_suggestion_again_and_rechecks_freshness() {
    let service = SessionService::in_memory().unwrap();
    let session_id = session(&service);
    let chat = notes_turn(
        &service,
        &session_id,
        json!({"kind":"edit","patch":{"kind":"note","bodyMarkdown":"Rewritten"}}),
    );
    let request = |chat: &ChatState, action| RefinementRequest {
        scope: scope(chat),
        proposal_id: chat.proposals[0].id.clone(),
        action,
    };
    let applied = service
        .resolve_refinement(request(&chat, RefinementAction::Stage))
        .unwrap();
    let undone = service
        .resolve_refinement(request(&applied, RefinementAction::Undo))
        .unwrap();
    assert_eq!(undone.proposals[0].state, RefinementState::Offered);
    let again = service
        .resolve_refinement(request(&undone, RefinementAction::Stage))
        .unwrap();
    assert_eq!(again.proposals[0].state, RefinementState::Applied);
    let undone = service
        .resolve_refinement(request(&again, RefinementAction::Undo))
        .unwrap();
    set_note(&service, &session_id, "<p>Edited after Undo</p>".into());
    assert!(
        service
            .resolve_refinement(request(&undone, RefinementAction::Stage))
            .is_err()
    );
}
