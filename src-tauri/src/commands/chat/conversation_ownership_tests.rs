use super::*;
use qa_scribe_core::services::SessionService;

pub(super) fn fixture() -> (SessionService, ChatState, ChatState, StartChatJobRequest) {
    let service = SessionService::in_memory().unwrap();
    let session = service
        .create_session(SessionDraft {
            title: "Owned execution".into(),
            ..Default::default()
        })
        .unwrap();
    let finding = service
        .create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: "Source".into(),
            body: "Stored source".into(),
            body_json: None,
            body_format: None,
            kind: FindingKind::Bug,
            metadata_json: None,
        })
        .unwrap();
    let notes = service.load_chat(&session.id).unwrap();
    let notes = service
        .save_chat_composer(ChatComposerRequest {
            scope: lifecycle::scope(&notes),
            composer: "Notes stays here".into(),
            intent: ChatComposerIntent::DraftJira,
            mode: ChatMode::Chat,
            attachment_ids: vec![],
        })
        .unwrap();
    let record = service
        .begin_record_chat(BeginRecordChatRequest {
            session_id: session.id.clone(),
            draft_id: uuid::Uuid::new_v4().to_string(),
            record: ConversationRecord::Finding {
                record_id: finding.id.clone(),
            },
        })
        .unwrap();
    let record = service
        .save_chat_composer(ChatComposerRequest {
            scope: lifecycle::scope(&record),
            composer: "Only record A".into(),
            intent: ChatComposerIntent::Message,
            mode: ChatMode::Chat,
            attachment_ids: vec![],
        })
        .unwrap();
    let request = StartChatJobRequest {
        intent: crate::commands::chat::ChatSendIntent::Composer,
        scope: lifecycle::scope(&record),
        context: ChatTarget::Finding {
            snapshot: RecordContextSnapshot {
                session_id: session.id,
                record_id: finding.id,
                title: "Local source".into(),
                document_json: r#"{"schemaVersion":1,"doc":{"type":"doc","content":[]}}"#.into(),
                metadata_json: None,
                record_kind: "bug".into(),
                origin: RecordSnapshotOrigin::UnsavedEditor,
                local_fingerprint: String::new(),
                stored_base_token: String::new(),
            },
        },
        provider: AiProvider::CodexCli,
        model: "fixture".into(),
        reasoning_effort: None,
    };
    (service, notes, record, request)
}

#[test]
fn conversation_ownership_exact_preflight_and_finish_ignore_notes() {
    let (service, notes, record, request) = fixture();
    let prepared =
        lifecycle::prepare_with_images(&service, &request, &std::env::temp_dir()).unwrap();
    assert_eq!(prepared.started.chat.draft_id, record.draft_id);
    assert_eq!(prepared.started.chat.messages[0].text, "Only record A");
    assert_eq!(prepared.started.chat.composer, "");
    assert_eq!(
        prepared.started.chat.composer_intent,
        ChatComposerIntent::Message
    );
    let failed = lifecycle::fail(
        &service,
        &prepared,
        ChatFailureKind::Failed,
        "Owned failure",
    )
    .unwrap();
    assert_eq!(
        failed.messages[0].error_message.as_deref(),
        Some("Owned failure")
    );
    assert_eq!(failed.messages[0].status, ChatTurnStatus::Failed);
    assert_eq!(service.load_chat(&notes.session_id).unwrap(), notes);
}

#[test]
fn conversation_ownership_rejects_detached_record_context() {
    let (service, notes, record, mut request) = fixture();
    request.context = ChatTarget::Session;
    assert!(lifecycle::prepare_with_images(&service, &request, &std::env::temp_dir()).is_err());
    assert_eq!(
        service
            .read_chat(&ChatRef {
                session_id: record.session_id,
                draft_id: record.draft_id
            })
            .unwrap()
            .composer,
        "Only record A"
    );
    assert_eq!(service.load_chat(&notes.session_id).unwrap(), notes);
}

#[test]
fn conversation_ownership_composer_normalizes_saved_intent() {
    for intent in [
        ChatComposerIntent::Message,
        ChatComposerIntent::RefineRecord,
        ChatComposerIntent::DraftJira,
    ] {
        let (service, notes, record, mut request) = fixture();
        let saved = service
            .save_chat_composer(ChatComposerRequest {
                scope: lifecycle::scope(&record),
                composer: "Only record A".into(),
                intent,
                mode: ChatMode::Chat,
                attachment_ids: vec![],
            })
            .unwrap();
        request.scope = lifecycle::scope(&saved);
        let prepared =
            lifecycle::prepare_with_images(&service, &request, &std::env::temp_dir()).unwrap();
        let contract = service
            .response_contract(&prepared.started.chat.messages[0].id)
            .unwrap()
            .unwrap();
        let expected = match intent {
            ChatComposerIntent::Message => ChatResponsePurpose::Conversation,
            ChatComposerIntent::RefineRecord => ChatResponsePurpose::Refinement {
                record_kind: RefinementRecordKind::Finding,
            },
            ChatComposerIntent::DraftJira => ChatResponsePurpose::JiraDrafting,
        };
        assert_eq!(contract.purpose(), expected);
        assert_eq!(
            prepared.started.chat.composer_intent,
            ChatComposerIntent::Message
        );
        assert_eq!(service.load_chat(&notes.session_id).unwrap(), notes);
    }
}

#[test]
fn conversation_ownership_intent_change_during_verify_consumes_nothing() {
    let (service, notes, record, request) = fixture();
    let snapshot = preparation::ChatPreparationSnapshot::capture(&service, &request).unwrap();
    let verified = snapshot
        .verify_with(request.provider, || false, |_| unreachable!())
        .unwrap();
    let saved = service
        .save_chat_composer(ChatComposerRequest {
            scope: lifecycle::scope(&record),
            composer: "New prepared input".into(),
            intent: ChatComposerIntent::DraftJira,
            mode: ChatMode::Chat,
            attachment_ids: vec![],
        })
        .unwrap();
    assert!(lifecycle::commit(&service, &request, verified).is_err());
    assert_eq!(
        service
            .read_chat(&ChatRef {
                session_id: saved.session_id.clone(),
                draft_id: saved.draft_id.clone()
            })
            .unwrap(),
        saved
    );
    assert_eq!(service.load_chat(&notes.session_id).unwrap(), notes);
    assert!(
        service
            .read_chat(&ChatRef {
                session_id: saved.session_id,
                draft_id: saved.draft_id
            })
            .unwrap()
            .ai_runs
            .is_empty()
    );
}

#[test]
fn chat_identity_exists_before_ai_run() {
    let (service, _, record, request) = fixture();
    let root = std::env::temp_dir().join(format!("qa-chat-admission-{}", uuid::Uuid::new_v4()));
    let state = AppState::new(service, root);
    let jobs = JobStore::default();
    let reference = ChatRef {
        session_id: record.session_id,
        draft_id: record.draft_id,
    };
    let _ = prepare_chat_job_with(&state, &jobs, &request, "owned-start", |_, _| {
        let status = jobs.status("owned-start").unwrap();
        assert_eq!(status.ai_run_id, None);
        assert_eq!(
            serde_json::to_value(status).unwrap()["chat"],
            serde_json::json!({"reference":reference})
        );
        Err(CommandError::validation("Stop before image verification"))
    });
}

#[test]
fn conversation_ownership_capacity_preserves_saved_input() {
    let (service, notes, record, request) = fixture();
    let state = AppState::new(service, std::env::temp_dir());
    let jobs = JobStore::default();
    for id in ["one", "two", "three"] {
        jobs.insert_generation_job(id.into(), notes.session_id.clone(), "testware".into())
            .unwrap();
    }
    let result = prepare_chat_job_with(&state, &jobs, &request, "fourth", |_, _| {
        panic!("capacity must precede verification")
    });
    assert!(result.is_err());
    state
        .with_service(|service| {
            assert_eq!(
                service.read_chat(&ChatRef {
                    session_id: record.session_id.clone(),
                    draft_id: record.draft_id.clone()
                })?,
                record
            );
            assert_eq!(service.load_chat(&notes.session_id)?, notes);
            let runs: i64 = service.database().connection().query_row(
                "SELECT COUNT(*) FROM ai_runs",
                [],
                |row| row.get(0),
            )?;
            assert_eq!(runs, 0);
            Ok(())
        })
        .unwrap();
}

#[test]
fn conversation_ownership_same_draft_preparations_commit_once() {
    let (service, notes, record, request) = fixture();
    let first = preparation::ChatPreparationSnapshot::capture(&service, &request)
        .unwrap()
        .verify_with(request.provider, || false, |_| unreachable!())
        .unwrap();
    let second = preparation::ChatPreparationSnapshot::capture(&service, &request)
        .unwrap()
        .verify_with(request.provider, || false, |_| unreachable!())
        .unwrap();
    let committed = lifecycle::commit(&service, &request, first).unwrap();
    assert!(lifecycle::commit(&service, &request, second).is_err());
    let saved = service
        .read_chat(&ChatRef {
            session_id: record.session_id,
            draft_id: record.draft_id,
        })
        .unwrap();
    assert_eq!(saved.messages.len(), 1);
    assert_eq!(saved.messages[0].text, "Only record A");
    assert_eq!(
        saved.messages[0].ai_run_id.as_deref(),
        Some(committed.ai_run.id.as_str())
    );
    assert_eq!(saved.ai_runs.len(), 1);
    assert_eq!(service.load_chat(&notes.session_id).unwrap(), notes);
}

#[test]
fn conversation_ownership_deleted_retry_preserves_snapshot() {
    let (service, notes, _, mut request) = fixture();
    let prepared =
        lifecycle::prepare_with_images(&service, &request, &std::env::temp_dir()).unwrap();
    let snapshot = prepared.started.chat.messages[0].context.clone();
    let failed = lifecycle::fail(
        &service,
        &prepared,
        ChatFailureKind::Failed,
        "Fixture failure",
    )
    .unwrap();
    let record_id = snapshot.snapshot().unwrap().record_id.clone();
    service.delete_finding(&record_id).unwrap();
    request.scope = lifecycle::scope(&failed);
    request.intent = ChatSendIntent::Retry;
    request.context = ChatTarget::Session;
    let retried =
        lifecycle::prepare_with_images(&service, &request, &std::env::temp_dir()).unwrap();
    assert_eq!(retried.started.chat.messages[0].context, snapshot);
    assert_eq!(retried.started.chat.messages[0].text, "Only record A");
    assert_eq!(retried.started.chat.messages[0].id, failed.messages[0].id);
    assert_eq!(retried.input.text(), prepared.input.text());
    assert_eq!(service.load_chat(&notes.session_id).unwrap(), notes);
}

#[test]
fn conversation_ownership_image_recheck_retains_both_composers() {
    use base64::{Engine, engine::general_purpose::STANDARD};
    let (service, notes, record, mut request) = fixture();
    let root = std::env::temp_dir().join(format!("qa-owned-images-{}", uuid::Uuid::new_v4()));
    let image = format!(
        "data:image/png;base64,{}",
        STANDARD.encode(include_bytes!(
            "../../../../e2e/fixtures/chat-image-pixels.png"
        ))
    );
    let record = qa_scribe_core::attachments::chat::import_chat_image_data_url(
        &service,
        &root,
        lifecycle::scope(&record),
        "A.png".into(),
        &image,
    )
    .unwrap();
    request.scope = lifecycle::scope(&record);
    let snapshot = preparation::ChatPreparationSnapshot::capture(&service, &request).unwrap();
    let verified = snapshot
        .verify_with(
            request.provider,
            || false,
            |source| qa_scribe_core::attachments::chat::resolve_chat_image_source(&root, source),
        )
        .unwrap();
    let saved = service
        .save_chat_composer(ChatComposerRequest {
            scope: lifecycle::scope(&record),
            composer: "Newer A text".into(),
            intent: ChatComposerIntent::DraftJira,
            attachment_ids: record
                .composer_images
                .iter()
                .map(|image| image.attachment_id.clone())
                .collect(),
            mode: ChatMode::Chat,
        })
        .unwrap();
    assert!(lifecycle::commit(&service, &request, verified).is_err());
    assert_eq!(saved.composer, "Newer A text");
    assert_eq!(saved.composer_intent, ChatComposerIntent::DraftJira);
    assert_eq!(saved.composer_images, record.composer_images);
    assert_eq!(
        service
            .read_chat(&ChatRef {
                session_id: saved.session_id.clone(),
                draft_id: saved.draft_id.clone()
            })
            .unwrap(),
        saved
    );
    assert_eq!(service.load_chat(&notes.session_id).unwrap(), notes);
    std::fs::remove_dir_all(root).unwrap();
}
