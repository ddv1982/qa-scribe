use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use qa_scribe_core::{
    attachments::{attachment_preview_data_url, chat::import_chat_image_data_url},
    storage::Database,
};
use serde_json::Value;

fn png() -> String {
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::RgbImage::from_pixel(3, 2, image::Rgb([20, 170, 90]))
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    format!(
        "data:image/png;base64,{}",
        STANDARD.encode(bytes.into_inner())
    )
}

struct TestDirectory(std::path::PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("qa-scribe-visual-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct Fixture {
    service: SessionService,
    root: TestDirectory,
    draft: Draft,
    context: ChatTarget,
    chat: ChatState,
}

impl Fixture {
    fn new() -> Self {
        let root = TestDirectory::new();
        let service =
            SessionService::new(Database::open(root.path().join("test.sqlite")).unwrap()).unwrap();
        let session = service
            .create_session(SessionDraft {
                title: "Queue tests".into(),
                ..Default::default()
            })
            .unwrap();
        let body = "<h3>TC01 Queue routing</h3><p>Send a message.</p><h3>TC02 Retry</h3><p>Retry once.</p>";
        let document_json = json!({"schemaVersion":1,"doc":{"type":"doc","content":[
            {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"TC01 Queue routing"}]},
            {"type":"paragraph","content":[{"type":"text","text":"Send a message."}]},
            {"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"TC02 Retry"}]},
            {"type":"paragraph","content":[{"type":"text","text":"Retry once."}]}
        ]}}).to_string();
        let draft = service
            .create_draft(DraftCreate {
                session_id: session.id.clone(),
                ai_run_id: None,
                kind: DraftKind::Testware,
                title: "Queue tests".into(),
                body: body.into(),
                body_json: Some(document_json.clone()),
                body_format: Some("tiptap_json".into()),
                metadata_json: None,
            })
            .unwrap();
        let context = ChatTarget::TestCasesDraft {
            snapshot: RecordContextSnapshot {
                session_id: session.id.clone(),
                record_id: draft.id.clone(),
                title: draft.title.clone(),
                document_json,
                metadata_json: None,
                record_kind: "testware".into(),
                origin: RecordSnapshotOrigin::Saved,
                local_fingerprint: String::new(),
                stored_base_token: String::new(),
            },
        };
        let chat = service
            .begin_record_chat(BeginRecordChatRequest {
                session_id: session.id,
                draft_id: uuid::Uuid::new_v4().to_string(),
                record: ConversationRecord::TestCasesDraft {
                    record_id: draft.id.clone(),
                },
            })
            .unwrap();
        Self {
            service,
            root,
            draft,
            context,
            chat,
        }
    }

    fn offer(
        &mut self,
        action: Value,
        target: Value,
        image: Option<&str>,
    ) -> ApplyVisualRefinementRequest {
        if let Some(image) = image {
            self.chat = import_chat_image_data_url(
                &self.service,
                self.root.path(),
                scope(&self.chat),
                "Captured.png".into(),
                image,
            )
            .unwrap();
        }
        let composer = self
            .service
            .save_chat_composer(ChatComposerRequest {
                scope: scope(&self.chat),
                intent: ChatComposerIntent::RefineRecord,
                composer: "Add a queue visual".into(),
                mode: ChatMode::Chat,
                attachment_ids: self
                    .chat
                    .composer_images
                    .iter()
                    .map(|image| image.attachment_id.clone())
                    .collect(),
            })
            .unwrap();
        let turn = self
            .service
            .start_chat_turn_with_response(
                ChatStartRequest {
                    scope: scope(&composer),
                },
                self.context.clone(),
                ChatRequestIntent::RefineRecord,
            )
            .unwrap();
        let contract = self
            .service
            .response_contract(&turn.chat.messages.last().unwrap().id)
            .unwrap()
            .unwrap();
        self.chat = self.service.finish_chat_turn(ChatFinishRequest {
            scope: scope(&turn.chat), turn_id: turn.turn_id,
            assistant_text: json!({"version":3,"requestId":contract.request_id(),"markdown":"Proposed a visual.",
                "outcome":{"kind":"edit","patch":{"kind":"test_cases_visual","visual":{"target":target,"caption":"Queue diagram","action":action}}}}).to_string()
        }).unwrap();
        ApplyVisualRefinementRequest {
            reference: ChatRef {
                session_id: self.chat.session_id.clone(),
                draft_id: self.chat.draft_id.clone(),
            },
            proposal_id: self.chat.proposals.last().unwrap().id.clone(),
            image_data_url: None,
            undo: false,
        }
    }
}

fn diagram() -> Value {
    json!({"kind":"diagram","replace":false,"nodes":[{"label":"New listener","row":1,"column":0}],"edges":[]})
}

#[test]
fn review_apply_restart_and_undo_keep_the_rendered_bytes_and_frozen_test_run() {
    let mut fixture = Fixture::new();
    let mut request = fixture.offer(diagram(), json!([1]), None);
    let bytes = png();
    request.image_data_url = Some(bytes.clone());
    let applied = fixture
        .service
        .apply_visual_refinement(fixture.root.path(), request.clone())
        .unwrap();
    let RefinedRecord::TestCasesDraft { record } = applied.updated else {
        panic!("Test Cases expected")
    };
    let attachment_id = match &applied.chat.proposals[0].state {
        RefinementState::VisualApplied { attachment_id } => attachment_id,
        _ => panic!("Applied visual expected"),
    };
    assert_eq!(
        attachment_preview_data_url(&fixture.service, fixture.root.path(), attachment_id)
            .unwrap()
            .as_deref(),
        Some(bytes.as_str())
    );
    let original: Value =
        serde_json::from_str(fixture.draft.body_json.as_deref().unwrap()).unwrap();
    let data: Value = serde_json::from_str(record.body_json.as_deref().unwrap()).unwrap();
    let blocks = data["doc"]["content"].as_array().unwrap();
    assert_eq!(blocks[2]["attrs"]["attachmentId"], attachment_id.as_str());
    assert_eq!(
        blocks[2]["attrs"]["visualSource"]["nodes"][0]["label"],
        "New listener"
    );
    assert_eq!(
        blocks[..2],
        original["doc"]["content"].as_array().unwrap()[..2]
    );
    assert_eq!(
        blocks[3..],
        original["doc"]["content"].as_array().unwrap()[2..]
    );
    assert_eq!(
        fixture
            .service
            .apply_visual_refinement(fixture.root.path(), request.clone())
            .unwrap()
            .chat
            .revision,
        applied.chat.revision
    );
    fixture
        .service
        .start_test_run(
            &record.id,
            vec![TestRunCaseDraft {
                title: "TC01 Queue routing".into(),
                group_title: None,
                body_json: json!({"schemaVersion":1,"doc":{"type":"doc","content":blocks[..3]}})
                    .to_string(),
            }],
        )
        .unwrap();

    let service =
        SessionService::new(Database::open(fixture.root.path().join("test.sqlite")).unwrap())
            .unwrap();
    assert_eq!(
        service.read_chat(&request.reference).unwrap().proposals[0].state,
        applied.chat.proposals[0].state
    );
    request.image_data_url = None;
    request.undo = true;
    let restored = service
        .apply_visual_refinement(fixture.root.path(), request.clone())
        .unwrap();
    let RefinedRecord::TestCasesDraft { record } = restored.updated else {
        panic!("Test Cases expected")
    };
    assert_eq!(record.body_json, fixture.draft.body_json);
    assert_eq!(record.body, fixture.draft.body);
    assert_eq!(
        restored.chat.proposals[0].state,
        RefinementState::VisualUndone
    );
    assert!(
        service.attachment_is_referenced(attachment_id).unwrap(),
        "Frozen case still owns the image"
    );
    assert_eq!(
        service
            .apply_visual_refinement(fixture.root.path(), request)
            .unwrap()
            .chat
            .revision,
        restored.chat.revision
    );
}

#[test]
fn local_derivative_keeps_chat_screenshot_and_rolls_back_failed_or_stale_commits() {
    let mut fixture = Fixture::new();
    let bytes = png();
    let mut request = fixture.offer(
        json!({"kind":"annotate","replace":false,"source":{"kind":"chat","index":0},
        "edits":[{"kind":"redact","region":{"x":0,"y":0,"width":500,"height":500}}]}),
        json!([1]),
        Some(&bytes),
    );
    assert_eq!(
        fixture
            .service
            .review_visual_refinement(
                fixture.root.path(),
                &request.reference,
                &request.proposal_id
            )
            .unwrap()
            .source
            .as_deref(),
        Some(bytes.as_str())
    );
    let source_id = fixture.chat.messages[0].images[0].attachment_id.clone();
    request.image_data_url = Some(bytes.clone());
    let db = fixture.service.database().connection();
    db.execute_batch("CREATE TRIGGER reject_visual BEFORE UPDATE ON chat_refinements BEGIN SELECT RAISE(ABORT,'disk full'); END;").unwrap();
    assert!(
        fixture
            .service
            .apply_visual_refinement(fixture.root.path(), request.clone())
            .is_err()
    );
    assert_eq!(
        fixture
            .service
            .list_attachments(&fixture.draft.session_id)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM chat_image_imports", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        fixture
            .service
            .list_drafts(&fixture.draft.session_id)
            .unwrap()[0],
        fixture.draft
    );
    db.execute_batch("DROP TRIGGER reject_visual; UPDATE drafts SET title='Later edits';")
        .unwrap();
    assert!(
        fixture
            .service
            .apply_visual_refinement(fixture.root.path(), request.clone())
            .is_err()
    );
    db.execute_batch("UPDATE drafts SET title='Queue tests';")
        .unwrap();
    let updated = fixture
        .service
        .apply_visual_refinement(fixture.root.path(), request.clone())
        .unwrap();
    let RefinedRecord::TestCasesDraft { record } = updated.updated else {
        panic!("Test Cases expected")
    };
    assert!(record.body_json.as_ref().unwrap().contains(&source_id));
    assert!(
        record
            .body_json
            .as_ref()
            .unwrap()
            .contains("annotated_screenshot")
    );
    assert_eq!(
        attachment_preview_data_url(&fixture.service, fixture.root.path(), &source_id)
            .unwrap()
            .as_deref(),
        Some(bytes.as_str())
    );
    db.execute_batch("UPDATE drafts SET title='Newer edits';")
        .unwrap();
    request.undo = true;
    request.image_data_url = None;
    assert!(
        fixture
            .service
            .apply_visual_refinement(fixture.root.path(), request)
            .is_err()
    );
    assert_eq!(
        fixture
            .service
            .list_drafts(&fixture.draft.session_id)
            .unwrap()[0]
            .title,
        "Newer edits"
    );
}

#[test]
fn visual_update_keeps_unsaved_title_and_undo_restores_the_saved_revision() {
    let mut fixture = Fixture::new();
    let ChatTarget::TestCasesDraft { snapshot } = &mut fixture.context else {
        unreachable!()
    };
    snapshot.origin = RecordSnapshotOrigin::UnsavedEditor;
    snapshot.title = "Renamed locally".into();
    let mut request = fixture.offer(diagram(), json!([1]), None);
    request.image_data_url = Some(png());
    let applied = fixture
        .service
        .apply_visual_refinement(fixture.root.path(), request.clone())
        .unwrap();
    let RefinedRecord::TestCasesDraft { record } = applied.updated else {
        panic!("Test Cases expected")
    };
    assert_eq!(record.title, "Renamed locally");
    request.undo = true;
    request.image_data_url = None;
    let restored = fixture
        .service
        .apply_visual_refinement(fixture.root.path(), request)
        .unwrap();
    let RefinedRecord::TestCasesDraft { record } = restored.updated else {
        panic!("Test Cases expected")
    };
    assert_eq!(record.title, fixture.draft.title);
    assert_eq!(record.body_json, fixture.draft.body_json);
}

#[test]
fn diagram_replacement_can_be_undone_in_order() {
    let mut f = Fixture::new();
    let mut first = f.offer(diagram(), json!([1]), None);
    first.image_data_url = Some(png());
    let saved = f
        .service
        .apply_visual_refinement(f.root.path(), first.clone())
        .unwrap();
    let RefinedRecord::TestCasesDraft { record } = saved.updated else {
        panic!("Test Cases expected")
    };
    let ChatTarget::TestCasesDraft { snapshot } = &mut f.context else {
        unreachable!()
    };
    snapshot.document_json = record.body_json.unwrap();
    f.chat = saved.chat;
    let mut replacement = diagram();
    replacement["replace"] = json!(true);
    replacement["nodes"][0]["label"] = json!("Revised listener");
    let mut second = f.offer(replacement, json!([2]), None);
    second.image_data_url = Some(png());
    let applied = f
        .service
        .apply_visual_refinement(f.root.path(), second.clone())
        .unwrap();
    let RefinedRecord::TestCasesDraft { record } = applied.updated else {
        panic!("Test Cases expected")
    };
    assert!(record.body_json.unwrap().contains("Revised listener"));

    first.image_data_url = None;
    first.undo = true;
    assert!(
        f.service
            .apply_visual_refinement(f.root.path(), first.clone())
            .is_err()
    );
    second.image_data_url = None;
    second.undo = true;
    f.service
        .apply_visual_refinement(f.root.path(), second)
        .unwrap();
    let undone = f
        .service
        .apply_visual_refinement(f.root.path(), first)
        .unwrap();
    let RefinedRecord::TestCasesDraft { record } = undone.updated else {
        panic!("Test Cases expected")
    };
    assert_eq!(record.body_json, f.draft.body_json);
}
