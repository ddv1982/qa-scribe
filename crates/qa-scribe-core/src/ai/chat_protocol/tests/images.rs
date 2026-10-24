use super::*;
use crate::{
    attachments::chat::ChatInputImage,
    chat::{ChatInput, ChatInputMessage, ChatPromptRole, build_chat_input},
};

fn input() -> ChatInput {
    build_chat_input(
        "context",
        vec![ChatInputMessage {
            context: crate::domain::ChatTarget::Session,
            id: "message-1".into(),
            role: ChatPromptRole::User,
            text: String::new(),
            images: vec![ChatInputImage {
                width: 1,
                height: 1,
                path: "/managed/attachments/session/pixel.png".into(),
                mime_type: "image/png".into(),
                bytes: vec![0, 1, 2].into(),
            }],
        }],
    )
    .unwrap()
}

#[test]
fn literal_claude_base64_blocks_and_labelled_image_only_input() {
    let mut p = ChatProtocol::new(AiProvider::ClaudeCode, input(), "model", None, "/neutral");
    let frames = sent(&p.handle(&json!({"type":"control_response","response":{"subtype":"success","request_id":"qa-scribe-init"}})).unwrap());
    let content = frames[0]["message"]["content"].as_array().unwrap();
    assert_eq!(
        &content[1..],
        &[
            json!({"type":"text","text":"MESSAGE message-1 User\n\"\""}),
            json!({"type":"text","text":"Image 1 for message message-1"}),
            json!({"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAEC"}}),
        ]
    );
}

#[test]
fn literal_codex_local_image_uses_exact_managed_canonical_path() {
    let mut p = ChatProtocol::new(AiProvider::CodexCli, input(), "model", None, "/neutral");
    p.handle(&json!({"id":"qa-scribe-init","result":{}}))
        .unwrap();
    let frames = sent(
        &p.handle(&json!({"id":"qa-scribe-thread","result":{"thread":{"id":"thread"}}}))
            .unwrap(),
    );
    assert_eq!(frames[0]["method"], "turn/start");
    assert_eq!(
        frames[0]["params"]["input"][2],
        json!({"type":"text","text":"Image 1 for message message-1"})
    );
    assert_eq!(
        frames[0]["params"]["input"][3],
        json!({"type":"localImage","path":"/managed/attachments/session/pixel.png"})
    );
}

#[test]
fn literal_acp_v1_image_requires_negotiated_prompt_capability() {
    for caps in [
        json!(null),
        json!({}),
        json!({"promptCapabilities":{"image":false}}),
        json!({"sessionCapabilities":{"promptCapabilities":{"image":true}}}),
    ] {
        let mut p = ChatProtocol::new(AiProvider::CopilotCli, input(), "model", None, "/neutral");
        let err = p.handle(&json!({"id":"qa-scribe-init","result":{"protocolVersion":1,"agentCapabilities":caps}})).unwrap_err();
        assert!(err.to_string().contains("did not negotiate image"));
        assert!(p.finish().is_err());
    }
    let mut p = ChatProtocol::new(AiProvider::CopilotCli, input(), "model", None, "/neutral");
    p.handle(&json!({"id":"qa-scribe-init","result":{"protocolVersion":1,"agentCapabilities":{"promptCapabilities":{"image":true}}}})).unwrap();
    let frames = sent(
        &p.handle(&json!({"id":"qa-scribe-session","result":{"sessionId":"session"}}))
            .unwrap(),
    );
    assert_eq!(frames[0]["method"], "session/prompt");
    assert_eq!(
        frames[0]["params"]["prompt"][2],
        json!({"type":"text","text":"Image 1 for message message-1"})
    );
    assert_eq!(
        frames[0]["params"]["prompt"][3],
        json!({"type":"image","mimeType":"image/png","data":"AAEC"})
    );
}

#[test]
fn image_replay_preserves_message_and_ordinal_and_enforces_separate_history_budget() {
    let image = ChatInputImage {
        width: 1,
        height: 1,
        path: "/managed/pixel.png".into(),
        mime_type: "image/png".into(),
        bytes: vec![0, 1, 2].into(),
    };
    let messages = vec![
        ChatInputMessage {
            context: crate::domain::ChatTarget::Session,
            id: "old-user".into(),
            role: ChatPromptRole::User,
            text: "First".into(),
            images: vec![image.clone(), image.clone()],
        },
        ChatInputMessage {
            context: crate::domain::ChatTarget::Session,
            id: "assistant".into(),
            role: ChatPromptRole::Assistant,
            text: "Seen".into(),
            images: vec![],
        },
        ChatInputMessage {
            context: crate::domain::ChatTarget::Session,
            id: "current".into(),
            role: ChatPromptRole::User,
            text: "Again".into(),
            images: vec![image.clone()],
        },
    ];
    let input = build_chat_input("", messages).unwrap();
    let blocks = input.content_blocks(AiProvider::CopilotCli);
    assert_eq!(
        blocks[2],
        json!({"type":"text","text":"Image 1 for message old-user"})
    );
    assert_eq!(
        blocks[4],
        json!({"type":"text","text":"Image 2 for message old-user"})
    );
    assert_eq!(
        blocks[8],
        json!({"type":"text","text":"Image 1 for message current"})
    );
    assert_eq!(
        blocks[9],
        json!({"type":"image","mimeType":"image/png","data":"AAEC"})
    );
    input.preflight_wire(AiProvider::ClaudeCode).unwrap();
    let rejected = build_chat_input(
        "",
        vec![ChatInputMessage {
            context: crate::domain::ChatTarget::Session,
            id: "over".into(),
            role: ChatPromptRole::User,
            text: "".into(),
            images: vec![image; 17],
        }],
    );
    assert!(rejected.unwrap_err().contains("16 images or 40 MiB"));
}

#[test]
fn image_data_is_redacted_from_diagnostics_and_provider_limits_reject_before_encoding() {
    let input = input();
    assert_eq!(
        input.provider_error_message("failed payload AAEC"),
        "The provider could not complete this image response. Check its configuration and image support, then retry."
    );
    assert_eq!(
        input.provider_error_message(
            "Provider rejected a truncated image chunk: iVBORw0KGgoAAAANSUhEUgAAB"
        ),
        "The provider could not complete this image response. Check its configuration and image support, then retry."
    );
    assert_eq!(
        ChatInput::from("Text-only prompt").provider_error_message("Provider is offline"),
        "Provider is offline"
    );
    let image = ChatInputImage {
        width: 8001,
        height: 1,
        path: "/managed/wide.png".into(),
        mime_type: "image/png".into(),
        bytes: vec![0, 1, 2].into(),
    };
    let input = build_chat_input(
        "",
        vec![ChatInputMessage {
            context: crate::domain::ChatTarget::Session,
            id: "wide".into(),
            role: ChatPromptRole::User,
            text: "wide".into(),
            images: vec![image],
        }],
    )
    .unwrap();
    assert!(
        input
            .preflight_wire(AiProvider::ClaudeCode)
            .unwrap_err()
            .contains("8000-pixel")
    );
    input.preflight_wire(AiProvider::CodexCli).unwrap();
    let image = ChatInputImage {
        width: 1,
        height: 1,
        path: "/managed/large.png".into(),
        mime_type: "image/png".into(),
        bytes: vec![0; 3_750_001].into(),
    };
    let input = build_chat_input(
        "",
        vec![ChatInputMessage {
            context: crate::domain::ChatTarget::Session,
            id: "large".into(),
            role: ChatPromptRole::User,
            text: "large".into(),
            images: vec![image],
        }],
    )
    .unwrap();
    assert!(
        input
            .preflight_wire(AiProvider::ClaudeCode)
            .unwrap_err()
            .contains("5 MB")
    );
}
