use super::{FakeCli, JobControl, StreamUpdate, run_generation_command_streaming};

#[test]
fn chat_tools_copilot_preserves_private_permission_scope_across_turns() {
    let cli = FakeCli::new(
        "fake-copilot-scope",
        r#"#!/usr/bin/env python3
import sys, os
sys.stdin.read()
assert not {'--allow-all-tools','--deny-tool','--available-tools'}.intersection(sys.argv[1:])
marker = 'saved-approval-scope'
print('approved' if os.path.exists(marker) else 'needs-approval')
open(marker, 'a').close()
print(os.getcwd())
"#,
    );
    let command = cli.command(
        "scope probe".into(),
        qa_scribe_core::ai::GenerationOutputFormat::PlainText,
    );
    let run = |provider| {
        super::super::run_chat_command_streaming(
            &command,
            &JobControl::default(),
            provider,
            &cli.dir,
            |_| {},
        )
        .unwrap()
        .response_text()
        .unwrap()
    };
    let first = run(qa_scribe_core::domain::AiProvider::CopilotCli);
    let second = run(qa_scribe_core::domain::AiProvider::CopilotCli);
    let third = run(qa_scribe_core::domain::AiProvider::CopilotCli);
    let expected = cli
        .dir
        .join("copilot-chat")
        .canonicalize()
        .expect("stable scope still exists after each process exits");
    assert_eq!(first.lines().next(), Some("needs-approval"));
    for output in [second, third] {
        assert_eq!(output.lines().next(), Some("approved"));
        assert_eq!(
            std::path::Path::new(output.lines().nth(1).unwrap()),
            expected
        );
    }
    use std::os::unix::fs::PermissionsExt;
    assert_eq!(
        std::fs::metadata(&expected).unwrap().permissions().mode() & 0o777,
        0o700
    );
    for provider in [
        qa_scribe_core::domain::AiProvider::ClaudeCode,
        qa_scribe_core::domain::AiProvider::CodexCli,
    ] {
        let output = run(provider);
        assert_eq!(output.lines().next(), Some("needs-approval"));
        assert!(!std::path::Path::new(output.lines().nth(1).unwrap()).exists());
    }
}

#[test]
fn chat_tools_copilot_rejects_invalid_scope_before_spawning() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    for kind in ["file", "symlink", "public"] {
        let cli = FakeCli::new(
            "fake-invalid-copilot",
            "#!/bin/sh\ncat >/dev/null\ntouch spawned\n",
        );
        let scope = cli.dir.join("copilot-chat");
        match kind {
            "file" => std::fs::write(&scope, "preserve").unwrap(),
            "symlink" => symlink(&cli.dir, &scope).unwrap(),
            _ => {
                std::fs::create_dir(&scope).unwrap();
                std::fs::set_permissions(&scope, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
        }
        let command = cli.command(
            "probe".into(),
            qa_scribe_core::ai::GenerationOutputFormat::PlainText,
        );
        let error = super::super::run_chat_command_streaming(
            &command,
            &JobControl::default(),
            qa_scribe_core::domain::AiProvider::CopilotCli,
            &cli.dir,
            |_| {},
        )
        .unwrap_err();
        assert!(
            error.contains("provider was not started"),
            "{kind}: {error}"
        );
        assert!(!cli.dir.join("spawned").exists());
        assert!(!scope.join("spawned").exists());
        assert!(
            std::fs::symlink_metadata(&scope).is_ok(),
            "invalid scope must be preserved"
        );
    }
}

#[test]
fn chat_tools_copilot_scope_does_not_override_permission_denial() {
    let cli = FakeCli::new(
        "fake-copilot-denial",
        "#!/bin/sh\ncat >/dev/null\nprintf '%s' 'Permission denied by configured Copilot policy' >&2\nexit 1\n",
    );
    let mut command = qa_scribe_core::ai::chat::streaming_chat_command(
        qa_scribe_core::domain::AiProvider::CopilotCli,
        "probe",
        "default",
        None,
        true,
    )
    .unwrap();
    command.program = cli.path.to_string_lossy().into_owned();
    let output = super::super::run_chat_command_streaming(
        &command,
        &JobControl::default(),
        qa_scribe_core::domain::AiProvider::CopilotCli,
        &cli.dir,
        |_| {},
    )
    .unwrap();
    assert!(!output.success());
    assert!(output.failure_message().contains("Permission denied"));
    assert!(cli.dir.join("copilot-chat").exists());
}

#[test]
fn chat_tools_all_providers_preserve_configured_tool_policy_at_process_boundary() {
    use qa_scribe_core::{ai::chat::streaming_chat_command, domain::AiProvider};
    for provider in [
        AiProvider::ClaudeCode,
        AiProvider::CodexCli,
        AiProvider::CopilotCli,
    ] {
        let cli = FakeCli::new(
            "fake-provider-tools",
            r#"#!/usr/bin/env python3
import sys, json
args = sys.argv[1:]
assert not {'--tools','--strict-mcp-config','--mcp-config','--disallowedTools','--disable-slash-commands','--sandbox','--available-tools','--deny-tool','--disable-builtin-mcps','--dangerously-skip-permissions','--allow-all-tools','--yolo'}.intersection(args)
assert 'features.shell_tool=false' not in args
assert sys.stdin.read() == 'tool policy probe'
if '--output-format' in args:
    print(json.dumps({'type':'result','subtype':'success','result':'Tool policy inherited.'}))
elif '--json' in args:
    assert args[-1] == '-'
    print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':'Tool policy inherited.'}}))
else:
    print('Tool policy inherited.')
"#,
        );
        let mut command =
            streaming_chat_command(provider, "tool policy probe", "default", None, true).unwrap();
        command.program = cli.path.to_string_lossy().into_owned();
        let output =
            run_generation_command_streaming(&command, &JobControl::default(), |_| {}).unwrap();
        assert!(
            output.success(),
            "{provider:?}: {}",
            output.failure_message()
        );
        assert_eq!(
            output.response_text().unwrap().trim(),
            "Tool policy inherited."
        );
    }
}

/// Explicit developer smoke only: no account-dependent calls in the normal suite.
#[test]
#[ignore = "requires authenticated Claude and an existing Atlassian connector"]
fn chat_tools_live_atlassian_resource_discovery() {
    let prompt = qa_scribe_core::chat::build_chat_prompt("", &[qa_scribe_core::chat::ChatPromptMessage {
        role: qa_scribe_core::chat::ChatPromptRole::User,
        text: "Use the already configured Atlassian connector only to list accessible Atlassian resources (getAccessibleAtlassianResources). Do not fetch, search or modify any Jira issue or Confluence page. Do not include resource names, IDs or URLs in your response. If the tool succeeds, respond exactly CONNECTOR_OK. If permission is denied or unavailable, explain that limitation truthfully.".into(),
    }]).unwrap();
    let mut command = qa_scribe_core::ai::chat::streaming_chat_command(
        qa_scribe_core::domain::AiProvider::ClaudeCode,
        &prompt,
        "sonnet",
        None,
        false,
    )
    .unwrap();
    // Process-local, read-only smoke permission. No saved configuration changes
    // and no blanket tool approval; production chat itself adds no permissions.
    command.args.extend([
        "--allowedTools".into(),
        "mcp__claude_ai_Atlassian_MCP__getAccessibleAtlassianResources".into(),
    ]);
    let output =
        run_generation_command_streaming(&command, &JobControl::default(), |_| {}).unwrap();
    assert!(
        output.success(),
        "live provider failed: {}",
        output.failure_message()
    );
    let events: Vec<serde_json::Value> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    let invoked = events.iter().any(|event| {
        event["type"] == "assistant"
            && event["message"]["content"]
                .as_array()
                .is_some_and(|blocks| {
                    blocks.iter().any(|block| {
                        block["type"] == "tool_use"
                            && block["name"].as_str().is_some_and(|name| {
                                name.contains("getAccessibleAtlassianResources")
                            })
                    })
                })
    });
    let tool_succeeded = events.iter().any(|event| {
        event["type"] == "user"
            && event["message"]["content"]
                .as_array()
                .is_some_and(|blocks| {
                    blocks
                        .iter()
                        .any(|block| block["type"] == "tool_result" && block["is_error"] != true)
                })
    });
    assert!(
        invoked,
        "no actual resource-discovery tool invocation observed"
    );
    assert!(
        tool_succeeded,
        "resource-discovery tool did not return a successful result"
    );
    assert_eq!(output.response_text().unwrap().trim(), "CONNECTOR_OK");
    println!(
        "Production chat command/prompt: Atlassian resource tool invoked and succeeded; final marker CONNECTOR_OK; resource details omitted."
    );
}

#[test]
fn chat_tools_execute_configured_connector_and_keep_final_answer() {
    let cli = FakeCli::new(
        "fake-chat-tools",
        r#"#!/usr/bin/env python3
import sys, json, os
args = sys.argv[1:]
blocked = {'--tools', '--strict-mcp-config', '--mcp-config', '--disallowedTools', '--disable-slash-commands', '--dangerously-skip-permissions', '--permission-mode'}
if blocked.intersection(args):
    sys.stderr.write('Chat overrides configured tools or permissions')
    sys.exit(1)
prompt = sys.stdin.read()
assert 'TRANSCRIPT_JSON' in prompt
assert 'Do not use tools' not in prompt
assert os.path.basename(os.getcwd()).startswith('qa-scribe-provider-cwd-')
events = [
 {'type':'assistant','message':{'content':[{'type':'text','text':'I will query the configured connector to check its available resources.'},{'type':'tool_use','name':'mcp__jira__resources','input':{'private':'not assistant text'}}]}},
 {'type':'user','message':{'content':[{'type':'tool_result','content':'private tool result'}]}},
 {'type':'stream_event','event':{'type':'message_start'}},
 {'type':'stream_event','event':{'type':'content_block_delta','delta':{'type':'text_delta','text':'Connected.'}}},
 {'type':'assistant','message':{'content':[{'type':'text','text':'Connected.'}]}},
 {'type':'result','subtype':'success','result':'Connected.','is_error':False}
]
for event in events: print(json.dumps(event), flush=True)
"#,
    );
    let prompt = qa_scribe_core::chat::build_chat_prompt(
        "",
        &[qa_scribe_core::chat::ChatPromptMessage {
            role: qa_scribe_core::chat::ChatPromptRole::User,
            text: "Check configured connector resources".into(),
        }],
    )
    .unwrap();
    let mut command = qa_scribe_core::ai::chat::streaming_chat_command(
        qa_scribe_core::domain::AiProvider::ClaudeCode,
        &prompt,
        "default",
        None,
        false,
    )
    .unwrap();
    command.program = cli.path.to_string_lossy().into_owned();
    let mut partial = String::new();
    let output =
        run_generation_command_streaming(&command, &JobControl::default(), |update| match update {
            StreamUpdate::PartialDelta(text) => partial.push_str(&text),
            StreamUpdate::PartialSnapshot(text) => partial = text,
            StreamUpdate::Progress(_) => {}
        })
        .unwrap();
    assert!(output.success(), "{}", output.failure_message());
    assert_eq!(output.response_text().unwrap(), "Connected.");
    assert_eq!(partial, "Connected.");
}

#[test]
fn chat_tools_codex_final_answer_replaces_tool_preamble() {
    let cli = FakeCli::new(
        "fake-codex-tools",
        r#"#!/bin/sh
cat >/dev/null
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"I will query the configured connector to check its available resources."}}' '{"type":"item.completed","item":{"type":"mcp_tool_call","result":"private tool result"}}' '{"type":"item.completed","item":{"type":"reasoning","text":"private reasoning"}}' '{"type":"item.completed","item":{"type":"agent_message","text":"Connected."}}' '{"type":"turn.completed"}'
"#,
    );
    let mut command = qa_scribe_core::ai::chat::streaming_chat_command(
        qa_scribe_core::domain::AiProvider::CodexCli,
        "Check connector",
        "default",
        None,
        false,
    )
    .unwrap();
    command.program = cli.path.to_string_lossy().into_owned();
    let mut partial = String::new();
    let output =
        run_generation_command_streaming(&command, &JobControl::default(), |update| match update {
            StreamUpdate::PartialDelta(text) => partial.push_str(&text),
            StreamUpdate::PartialSnapshot(text) => partial = text,
            StreamUpdate::Progress(_) => {}
        })
        .unwrap();
    assert!(output.success());
    assert_eq!(output.response_text().unwrap(), "Connected.");
    assert_eq!(partial, "Connected.");
}

#[test]
fn chat_tools_permission_denial_does_not_become_success_even_with_zero_exit() {
    let cli = FakeCli::new(
        "fake-chat-denied",
        r#"#!/bin/sh
cat >/dev/null
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"Checking connector."}]}}' '{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["Permission denied for configured Jira tool; approve it in the CLI."]}'
"#,
    );
    let mut command = qa_scribe_core::ai::chat::streaming_chat_command(
        qa_scribe_core::domain::AiProvider::ClaudeCode,
        "Check connector",
        "default",
        None,
        false,
    )
    .unwrap();
    command.program = cli.path.to_string_lossy().into_owned();
    let output =
        run_generation_command_streaming(&command, &JobControl::default(), |_| {}).unwrap();
    assert!(!output.success());
    assert!(output.failure_message().contains("Permission denied"));
}
