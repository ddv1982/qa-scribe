use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use qa_scribe_core::{
    ai::chat_protocol::{ChatProtocol, ChatProtocolEvent},
    attachments::chat::import_chat_image_data_url,
};
use serde_json::json;

struct Fixture {
    service: SessionService,
    dir: std::path::PathBuf,
    request: StartChatJobRequest,
    data: String,
}
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("qa-chat-input-{}", uuid::Uuid::new_v4()));
        let service = SessionService::in_memory().unwrap();
        let session = service
            .create_session(SessionDraft {
                title: "Images".into(),
                ..Default::default()
            })
            .unwrap();
        let chat = service.load_chat(&session.id).unwrap();
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            2,
            1,
            image::Rgba([255, 0, 0, 255]),
        ))
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
        let data = STANDARD.encode(bytes.into_inner());
        let chat = import_chat_image_data_url(
            &service,
            &dir,
            scope(&chat),
            "pixel.png".into(),
            &format!("data:image/png;base64,{data}"),
        )
        .unwrap();
        let request = StartChatJobRequest {
            context: ChatTarget::Session,
            scope: scope(&chat),
            retry: false,
            provider: AiProvider::CopilotCli,
            model: "fixture-model".into(),
            reasoning_effort: None,
        };
        Self {
            service,
            dir,
            request,
            data,
        }
    }
    fn prepare(&self) -> PreparedChat {
        prepare_with_images(&self.service, &self.request, &self.dir).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn unsupported_acp_retains_immutable_image_turn_and_retry_replays_identical_pixels() {
    let mut fixture = Fixture::new();
    let prepared = fixture.prepare();
    let user = &prepared.started.chat.messages[0];
    let id = user.id.clone();
    let images = user.images.clone();
    let blocks = prepared.input.content_blocks(AiProvider::CopilotCli);
    assert_eq!(
        blocks[2],
        json!({"type":"text","text":format!("Image 1 for message {id}")})
    );
    assert_eq!(
        blocks[3],
        json!({"type":"image","mimeType":"image/png","data":fixture.data})
    );
    let mut protocol = ChatProtocol::new(
        AiProvider::CopilotCli,
        &prepared.input,
        "fixture-model",
        None,
        "/neutral",
    );
    let error = protocol
        .handle(&json!({"id":"qa-scribe-init","result":{"protocolVersion":1}}))
        .unwrap_err();
    let failed = fail(
        &fixture.service,
        &prepared,
        ChatFailureKind::Failed,
        &error.to_string(),
    )
    .unwrap();
    assert_eq!(failed.messages.len(), 1);
    assert_eq!(failed.messages[0].id, id);
    assert_eq!(failed.messages[0].images, images);
    fixture.request.scope = scope(&failed);
    fixture.request.retry = true;
    let retry = fixture.prepare();
    assert_eq!(retry.started.chat.messages[0].id, id);
    assert_eq!(retry.input.content_blocks(AiProvider::CopilotCli), blocks);
    let mut protocol = ChatProtocol::new(
        AiProvider::CopilotCli,
        &retry.input,
        "fixture-model",
        None,
        "/neutral",
    );
    protocol.handle(&json!({"id":"qa-scribe-init","result":{"protocolVersion":1,"agentCapabilities":{"promptCapabilities":{"image":true}}}})).unwrap();
    let events = protocol
        .handle(&json!({"id":"qa-scribe-session","result":{"sessionId":"session"}}))
        .unwrap();
    let ChatProtocolEvent::Send(frame) = &events[0] else {
        panic!("expected prompt")
    };
    assert_eq!(frame["params"]["prompt"][3], blocks[3]);
}

#[test]
fn next_turn_replays_completed_image_with_original_message_label() {
    let mut fixture = Fixture::new();
    let prepared = fixture.prepare();
    let original = prepared.input.content_blocks(AiProvider::CopilotCli);
    let completed = fixture
        .service
        .finish_chat_turn_with_ai_run(
            ChatFinishRequest {
                scope: scope(&prepared.started.chat),
                turn_id: prepared.started.turn_id.clone(),
                assistant_text: "Seen".into(),
            },
            &prepared.ai_run.id,
        )
        .unwrap();
    let saved = fixture
        .service
        .save_chat_composer(ChatComposerRequest {
            scope: scope(&completed),
            attachment_ids: vec![],
            composer: "What changed?".into(),
            mode: ChatMode::Chat,
        })
        .unwrap();
    fixture.request.scope = scope(&saved);
    let next = fixture.prepare();
    let blocks = next.input.content_blocks(AiProvider::CopilotCli);
    assert_eq!(&blocks[1..4], &original[1..4]);
    assert_eq!(
        blocks[4],
        json!({"type":"text","text":format!("MESSAGE {} Assistant\n\"Seen\"",completed.messages[1].id)})
    );
    assert_eq!(next.started.chat.messages.len(), 3);
}

#[test]
fn corrupt_image_preflight_keeps_composer_and_creates_no_user_or_ai_run() {
    let fixture = Fixture::new();
    let before = fixture
        .service
        .load_chat(&fixture.request.scope.session_id)
        .unwrap();
    let attachment = fixture
        .service
        .get_attachment(&before.composer_images[0].attachment_id)
        .unwrap()
        .unwrap();
    std::fs::write(fixture.dir.join(attachment.relative_path), b"tampered").unwrap();
    assert!(prepare_with_images(&fixture.service, &fixture.request, &fixture.dir).is_err());
    assert_eq!(
        fixture.service.load_chat(&before.session_id).unwrap(),
        before
    );
    let count: i64 = fixture
        .service
        .database()
        .connection()
        .query_row("SELECT count(*) FROM ai_runs", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
}
