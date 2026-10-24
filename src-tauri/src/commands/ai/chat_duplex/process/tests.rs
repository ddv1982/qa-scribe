use super::*;

#[test]
fn image_stderr_is_drained_without_capturing_binary_fragments() {
    let bytes = b"Provider error contains a truncated PNG: iVBORw0KGgoAAAANSUhEUgAAB";
    let mut input = std::io::Cursor::new(bytes);
    assert_eq!(
        read_stderr(&mut input, DiagnosticCapture::Discard),
        Vec::<u8>::new()
    );
    assert_eq!(input.position(), bytes.len() as u64);
    assert_eq!(
        read_stderr(std::io::Cursor::new(bytes), DiagnosticCapture::Tail),
        bytes
    );
}
use base64::{Engine, engine::general_purpose::STANDARD};
use qa_scribe_core::{
    attachments::chat::{import_chat_image_data_url, resolve_chat_image},
    chat::{ChatInput, ChatInputMessage, ChatPromptRole, build_chat_input},
    domain::{AiProvider, ChatRevision, SessionDraft},
    services::SessionService,
};
use serde_json::json;
use std::{io::Cursor, sync::mpsc};

struct Images {
    dir: std::path::PathBuf,
    input: ChatInput,
}
impl Images {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("qa-chat-echo-{}", uuid::Uuid::new_v4()));
        let service = SessionService::in_memory().unwrap();
        let session = service
            .create_session(SessionDraft {
                title: "Echo".into(),
                ..Default::default()
            })
            .unwrap();
        let chat = service.load_chat(&session.id).unwrap();
        let mut state = 1u32;
        let mut rgba = vec![0u8; 768 * 768 * 4];
        for byte in &mut rgba {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            *byte = state as u8;
        }
        let image = image::RgbaImage::from_raw(768, 768, rgba).unwrap();
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let data = format!(
            "data:image/png;base64,{}",
            STANDARD.encode(bytes.into_inner())
        );
        let chat = import_chat_image_data_url(
            &service,
            &dir,
            ChatRevision {
                session_id: session.id.clone(),
                draft_id: chat.draft_id,
                expected_revision: chat.revision,
            },
            "noise.png".into(),
            &data,
        )
        .unwrap();
        let image = resolve_chat_image(
            &service,
            &dir,
            &session.id,
            &chat.composer_images[0].attachment_id,
        )
        .unwrap();
        let input = build_chat_input(
            "",
            vec![ChatInputMessage {
                id: "message".into(),
                role: ChatPromptRole::User,
                text: "pixels".into(),
                images: vec![image],
            }],
        )
        .unwrap();
        Self { dir, input }
    }
}
impl Drop for Images {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn exact_image_echoes_are_discarded_under_a_separate_bound_and_normal_stdout_stays_one_mib() {
    let fixture = Images::new();
    for provider in [AiProvider::ClaudeCode, AiProvider::CopilotCli] {
        let blocks = fixture.input.content_blocks(provider);
        let echo = if provider == AiProvider::ClaudeCode {
            json!({"type":"user","message":{"role":"user","content":blocks}})
        } else {
            json!({"method":"session/update","params":{"update":{"sessionUpdate":"user_message_chunk","content":blocks[3]}}})
        };
        let mut bytes = serde_json::to_vec(&echo).unwrap();
        bytes.push(b'\n');
        assert!(bytes.len() > 1024 * 1024);
        bytes.extend_from_slice(b"{\"type\":\"result\"}\n");
        let (tx, rx) = mpsc::sync_channel(2);
        read_lines_with_echo(
            Cursor::new(bytes),
            tx,
            1024 * 1024,
            2 * 1024 * 1024,
            ImageEchoPolicy::new(&fixture.input, provider),
        );
        assert_eq!(
            rx.into_iter().collect::<Vec<_>>(),
            vec![Ok(b"{\"type\":\"result\"}\n".to_vec())]
        );
        let mut bad = echo;
        if provider == AiProvider::ClaudeCode {
            bad["type"] = json!("assistant");
        } else {
            bad["params"]["update"]["sessionUpdate"] = json!("agent_message_chunk");
        }
        let (tx, rx) = mpsc::sync_channel(2);
        read_lines_with_echo(
            Cursor::new(serde_json::to_vec(&bad).unwrap()),
            tx,
            1024 * 1024,
            2 * 1024 * 1024,
            ImageEchoPolicy::new(&fixture.input, provider),
        );
        assert_eq!(
            rx.recv().unwrap(),
            Err("Provider output line exceeded the safety limit".into())
        );
    }
}

#[test]
fn duplicate_echo_and_over_total_stdout_fail_and_outgoing_frame_limit_is_independent() {
    let fixture = Images::new();
    let echo = json!({"type":"user","message":{"role":"user","content":fixture.input.content_blocks(AiProvider::ClaudeCode)}});
    let mut bytes = serde_json::to_vec(&echo).unwrap();
    bytes.push(b'\n');
    let duplicate = bytes.clone();
    bytes.extend(duplicate);
    let (tx, rx) = mpsc::sync_channel(2);
    read_lines_with_echo(
        Cursor::new(bytes),
        tx,
        1024 * 1024,
        2 * 1024 * 1024,
        ImageEchoPolicy::new(&fixture.input, AiProvider::ClaudeCode),
    );
    assert_eq!(
        rx.recv().unwrap(),
        Err("Provider output line exceeded the safety limit".into())
    );
    let (tx, rx) = mpsc::sync_channel(8);
    read_lines(Cursor::new(b"111\n222\n333\n"), tx, 4, 8);
    assert_eq!(
        rx.into_iter().collect::<Vec<_>>(),
        vec![
            Ok(b"111\n".to_vec()),
            Ok(b"222\n".to_vec()),
            Err("Provider output exceeded the total byte safety limit".into())
        ]
    );
    let jobs = crate::jobs::JobStore::default();
    let (_, control) = jobs
        .insert_generation_job("outgoing".into(), "session".into(), "chat".into())
        .unwrap();
    let mut peer = Peer::new(&control);
    let (tx, rx) = mpsc::sync_channel(1);
    peer.sender = Some(tx);
    let frame = json!({"type":"user","message":{"role":"user","content":fixture.input.content_blocks(AiProvider::ClaudeCode)}});
    assert_eq!(
        peer.send(&frame, 1024 * 1024),
        Err("Provider input frame exceeded the safety limit".into())
    );
    peer.send(&frame, qa_scribe_core::chat::MAX_CHAT_INPUT_FRAME_BYTES)
        .unwrap();
    let sent = rx.recv().unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&sent).unwrap(),
        frame
    );
}
