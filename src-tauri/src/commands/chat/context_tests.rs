use super::*;
use qa_scribe_core::{
    chat::{ChatInputMessage, ChatPromptRole, build_chat_input},
    services::SessionService,
};
use serde_json::json;

fn fixture() -> (SessionService, Finding, StartChatJobRequest) {
    let service = SessionService::in_memory().unwrap();
    let session = service
        .create_session(SessionDraft {
            title: "Synthetic C1 Session".into(),
            ..Default::default()
        })
        .unwrap();
    let finding = service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Saved finding".into(),
            body: "<p>Saved evidence</p>".into(),
            body_json: None,
            body_format: None,
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .unwrap();
    let chat = service.load_chat(&session.id).unwrap();
    let chat = service
        .save_chat_composer(ChatComposerRequest {
            intent: qa_scribe_core::domain::ChatComposerIntent::Message,
            scope: lifecycle::scope(&chat),
            composer: "Review the selected evidence".into(),
            mode: ChatMode::Chat,
            attachment_ids: vec![],
        })
        .unwrap();
    let context = ChatTarget::Finding { snapshot: RecordContextSnapshot { session_id: session.id, record_id: finding.id.clone(), title: "Unsaved title".into(),
        document_json: json!({"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Unsaved selected evidence"}]}]}}).to_string(),
        metadata_json: None, record_kind: "bug".into(), origin: RecordSnapshotOrigin::UnsavedEditor, local_fingerprint: String::new(), stored_base_token: String::new() }};
    (
        service,
        finding,
        StartChatJobRequest {
            intent: crate::commands::chat::ChatSendIntent::Composer,
            context,
            scope: lifecycle::scope(&chat),

            provider: AiProvider::CodexCli,
            model: "default".into(),
            reasoning_effort: None,
        },
    )
}

#[test]
fn chat_context_preparation_and_retry_project_original_snapshot_not_new_selection() {
    let (service, finding, request) = fixture();
    let snapshot = preparation::ChatPreparationSnapshot::capture(&service, &request).unwrap();
    let verified = snapshot
        .verify_with(request.provider, || false, |_| unreachable!())
        .unwrap();
    let prepared = lifecycle::commit(&service, &request, verified).unwrap();
    let text = prepared.input.text();
    assert!(text.contains("Unsaved selected evidence"));
    assert!(!text.contains("Saved evidence"));
    assert!(text.contains("unsaved_editor"));
    assert!(text.contains(&prepared.started.chat.messages[0].id));
    assert_eq!(
        service.list_findings(&finding.session_id).unwrap(),
        vec![finding]
    );
    let failed = service
        .fail_chat_turn_with_ai_run(
            ChatFailRequest {
                scope: lifecycle::scope(&prepared.started.chat),
                turn_id: prepared.started.turn_id,
                kind: ChatFailureKind::Failed,
                error_message: "Synthetic failure".into(),
            },
            &prepared.ai_run.id,
        )
        .unwrap();
    let retry = StartChatJobRequest {
        scope: lifecycle::scope(&failed),
        intent: crate::commands::chat::ChatSendIntent::Retry,
        context: ChatTarget::Session,
        ..request
    };
    let snapshot = preparation::ChatPreparationSnapshot::capture(&service, &retry).unwrap();
    let verified = snapshot
        .verify_with(retry.provider, || false, |_| unreachable!())
        .unwrap();
    let retried = lifecycle::commit(&service, &retry, verified).unwrap();
    assert_eq!(
        retried.started.chat.messages[0].context,
        failed.messages[0].context
    );
    assert_eq!(retried.input.text(), text);
}

#[test]
fn chat_context_recheck_rejects_changed_stored_base_before_consuming_composer() {
    let (service, finding, request) = fixture();
    let snapshot = preparation::ChatPreparationSnapshot::capture(&service, &request).unwrap();
    let verified = snapshot
        .verify_with(request.provider, || false, |_| unreachable!())
        .unwrap();
    service
        .update_finding(
            &finding.id,
            FindingPatch {
                title: Some("New saved title".into()),
                ..Default::default()
            },
            qa_scribe_core::domain::RecordWriteGuard::finding(&finding),
        )
        .unwrap()
        .into_saved()
        .unwrap();
    assert!(lifecycle::commit(&service, &request, verified).is_err());
    let chat = service.load_chat(&finding.session_id).unwrap();
    assert_eq!(chat.composer, "Review the selected evidence");
    assert!(chat.messages.is_empty());
}

#[test]
fn chat_context_prompt_counts_context_separately_without_increasing_message_or_image_limits() {
    let (_, _, request) = fixture();
    let mut messages = vec![ChatInputMessage {
        id: "stable-user".into(),
        role: ChatPromptRole::User,
        text: "Question".into(),
        images: vec![],
        context: request.context,
    }];
    let prompt = build_chat_input("Synthetic Session Context", messages.clone())
        .unwrap()
        .text();
    assert!(prompt.contains(
        "MESSAGE stable-user User\n\"Question\"\nMESSAGE_CONTEXT_JSON\n{\"kind\":\"finding\""
    ));
    messages[0].text = "x".repeat(16 * 1024 + 1);
    assert!(
        build_chat_input("", messages.clone())
            .unwrap_err()
            .contains("16384")
    );
    messages[0].text = "Question".into();
    if let ChatTarget::Finding { snapshot } = &mut messages[0].context {
        snapshot.document_json = "x".repeat(33 * 1024);
    }
    assert!(
        build_chat_input("", messages)
            .unwrap_err()
            .contains("32 KiB")
    );
}

#[path = "retry_context_tests.rs"]
mod retry_context_tests;
