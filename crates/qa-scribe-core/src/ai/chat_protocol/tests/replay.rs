use super::*;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Step {
    Receive {
        release: String,
        frame: Value,
        events: Option<Vec<Value>>,
        error: Option<String>,
    },
    Decide {
        release: String,
        approved: bool,
        reply: Value,
    },
    NextPermission {
        release: String,
        permission: Value,
    },
}

fn corpus(name: &str) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../e2e/fixtures/chat-replay")
        .join(name);
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn expand(value: &mut Value) {
    match value {
        Value::String(text) if text == "$APP_VERSION" => *text = env!("CARGO_PKG_VERSION").into(),
        Value::String(text) if text == "$CWD" => *text = "/work".into(),
        Value::Array(values) => values.iter_mut().for_each(expand),
        Value::Object(values) => values.values_mut().for_each(expand),
        _ => {}
    }
}

fn detail(permission: &ChatProtocolPermission) -> Value {
    json!({"can_approve":permission.can_approve,"title":permission.title,
        "tool_name":permission.tool_name,"server_name":permission.server_name,
        "input_json":permission.input_json})
}

fn event(event: ChatProtocolEvent) -> Value {
    match event {
        ChatProtocolEvent::Send(frame) => json!({"send":frame}),
        ChatProtocolEvent::Permission(permission) => json!({"permission":detail(&permission)}),
        ChatProtocolEvent::Update(StreamUpdate::PartialDelta(text)) => json!({"delta":text}),
        ChatProtocolEvent::Update(StreamUpdate::PartialSnapshot(text)) => json!({"snapshot":text}),
        ChatProtocolEvent::Update(StreamUpdate::Progress(text)) => json!({"progress":text}),
        ChatProtocolEvent::Complete => json!({"complete":true}),
    }
}

fn exact(actual: Value, expected: Value, release: &str) -> Result<(), String> {
    if actual == expected {
        Ok(())
    } else {
        Err(format!("{release}: expected {expected}, received {actual}"))
    }
}

fn replay(mut transcript: Value) -> Result<(), String> {
    assert_eq!(transcript["version"], 1);
    assert_eq!(transcript["cli_version"], "synthetic");
    expand(&mut transcript);
    let provider = match transcript["provider"].as_str().unwrap() {
        "claude" => AiProvider::ClaudeCode,
        "codex" => AiProvider::CodexCli,
        "copilot" => AiProvider::CopilotCli,
        other => panic!("unknown replay provider {other}"),
    };
    let config = &transcript["constructor"];
    let mut protocol = ChatProtocol::new(
        provider,
        config["prompt"].as_str().unwrap(),
        config["model"].as_str().unwrap(),
        config["effort"].as_str(),
        config["cwd"].as_str().unwrap(),
    );
    exact(
        protocol.initial_message(),
        transcript["initial"].clone(),
        "initial",
    )?;
    let steps: Vec<Step> = serde_json::from_value(transcript["steps"].clone()).unwrap();
    for step in steps {
        match step {
            Step::Receive {
                release,
                frame,
                events,
                error,
            } => match protocol.handle(&frame) {
                Ok(actual) => exact(
                    json!(actual.into_iter().map(event).collect::<Vec<_>>()),
                    json!(events.expect("successful step needs exact events")),
                    &release,
                )?,
                Err(actual) => exact(json!(actual.to_string()), json!(error), &release)?,
            },
            Step::Decide {
                release,
                approved,
                reply,
            } => {
                exact(
                    protocol
                        .permission_reply(approved)
                        .map_err(|e| format!("{release}: {e}"))?,
                    reply,
                    &release,
                )?;
            }
            Step::NextPermission {
                release,
                permission,
            } => exact(
                protocol
                    .take_queued_permission()
                    .as_ref()
                    .map(detail)
                    .unwrap_or(Value::Null),
                permission,
                &release,
            )?,
        }
    }
    let finish = match protocol.finish() {
        Ok(text) => json!({"ok":text}),
        Err(error) => json!({"error":error.to_string()}),
    };
    exact(finish, transcript["finish"].clone(), "finish")
}

#[test]
fn chat_duplex_shared_transcripts_preserve_events_wire_order_and_finish() {
    let dir =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../e2e/fixtures/chat-replay");
    let mut files = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect::<Vec<_>>();
    files.sort();
    for name in files {
        let name = name.to_str().unwrap();
        if name.ends_with(".json") {
            replay(corpus(name)).unwrap_or_else(|error| panic!("{name}: {error}"));
        }
    }
}

#[test]
fn chat_duplex_replay_negative_control_detects_changed_permission_reply() {
    let mut transcript = corpus("copilot-queued.json");
    let step = transcript["steps"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|step| step["op"] == "decide")
        .unwrap();
    step["reply"]["result"]["outcome"]["optionId"] = json!("wrong-option");
    let error = replay(transcript).expect_err("wrong permission reply must fail replay");
    assert!(error.starts_with("approve-head:"), "{error}");
    assert!(error.contains("wrong-option"), "{error}");
}

#[test]
fn chat_duplex_codex_replay_completes_before_turn_start_response() {
    let mut transcript = corpus("codex-queued.json");
    transcript["steps"]
        .as_array_mut()
        .unwrap()
        .retain(|step| step["release"] != "turn-response");
    replay(transcript).expect("announced turn may complete before its start response");
}
