use crate::ai::GenerationOutputFormat;
use crate::domain::AiProvider;

use super::{
    GenerationCommand, MAX_PROVIDER_FAILURE_MESSAGE_BYTES, MAX_PROVIDER_STDOUT_BYTES,
    ProviderExecution, ProviderExecutor, ProviderGenerationOutput, run_streaming_generation,
};

fn failed_output(stderr: &[u8]) -> ProviderGenerationOutput {
    ProviderGenerationOutput {
        model_report: None,
        exit_success: Some(false),
        stdout: Vec::new(),
        stderr: stderr.to_vec(),
        assistant_text: None,
        output_format: GenerationOutputFormat::PlainText,
        cancelled: false,
    }
}

#[test]
fn copilot_generation_auth_failure_gets_actionable_message() {
    let output = failed_output(b"Error: No authentication information found");

    let message = output.failure_message_for_provider(AiProvider::CopilotCli);

    assert!(message.contains("copilot login"));
    assert!(message.contains("COPILOT_GITHUB_TOKEN"));
    assert!(message.contains("No authentication information found"));
}

#[test]
fn non_copilot_generation_failure_stays_raw() {
    let output = failed_output(b"Error: No authentication information found");

    assert_eq!(
        output.failure_message_for_provider(AiProvider::CodexCli),
        "Error: No authentication information found"
    );
}

struct ScriptedExecutor(Vec<&'static str>);

impl ProviderExecutor for ScriptedExecutor {
    fn execute(
        &self,
        _command: &GenerationCommand,
        on_line: &mut dyn FnMut(&[u8]),
    ) -> Result<ProviderExecution, String> {
        for line in &self.0 {
            on_line(format!("{line}\n").as_bytes());
        }
        Ok(ProviderExecution {
            exit_success: Some(true),
            stderr: Vec::new(),
            cancelled: false,
        })
    }
}

#[test]
fn run_streaming_generation_parses_lines_and_keeps_raw_stdout() {
    let executor = ScriptedExecutor(vec![
        r#"{"type":"item/agentMessage/delta","delta":"Hello "}"#,
        r#"{"type":"item/agentMessage/delta","delta":"world"}"#,
    ]);
    let command = GenerationCommand {
        program: "scripted".to_string(),
        args: Vec::new(),
        stdin: "prompt".to_string(),
        output_format: GenerationOutputFormat::CodexJsonl,
    };

    let mut updates = 0usize;
    let output = run_streaming_generation(&executor, &command, |_| updates += 1)
        .expect("scripted run succeeds");

    assert!(output.success());
    assert_eq!(
        output.response_text().expect("recognized Codex response"),
        "Hello world"
    );
    assert!(updates >= 2, "each delta should surface an update");
    assert!(
        String::from_utf8_lossy(&output.stdout).contains("agentMessage"),
        "raw stdout is preserved for diagnostics"
    );
}

#[test]
fn structured_init_event_reports_the_resolved_model() {
    let command = GenerationCommand {
        program: "scripted".into(),
        args: Vec::new(),
        stdin: "prompt".into(),
        output_format: GenerationOutputFormat::ClaudeStreamJson,
    };
    let output = run_streaming_generation(
        &ScriptedExecutor(vec![
            r#"{"type":"system","subtype":"init","model":"claude-sonnet-4-6"}"#,
            r#"{"type":"result","result":"done"}"#,
        ]),
        &command,
        |_| {},
    )
    .unwrap();
    assert_eq!(
        output.model_report,
        Some(crate::domain::ReportedModel::ClaudeInitialization {
            id: "claude-sonnet-4-6".into()
        })
    );
    assert_eq!(output.response_text().unwrap(), "done");
}

#[test]
fn current_structured_provider_fixtures_return_only_assistant_content() {
    let fixtures = [
        (
            GenerationOutputFormat::CodexJsonl,
            vec![
                r#"{"type":"thread.started","thread_id":"thread-1"}"#,
                r#"{"type":"item.completed","item":{"type":"agent_message","text":"<h2>Codex cases</h2>"}}"#,
                r#"{"type":"turn.completed","usage":{"input_tokens":10}}"#,
            ],
            "<h2>Codex cases</h2>",
        ),
        (
            GenerationOutputFormat::ClaudeStreamJson,
            vec![
                r#"{"type":"system","subtype":"init","model":"claude-sonnet"}"#,
                r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"<h2>Claude cases</h2>"}}}"#,
                r#"{"type":"result","result":"<h2>Claude cases</h2>"}"#,
            ],
            "<h2>Claude cases</h2>",
        ),
    ];

    for (output_format, lines, expected) in fixtures {
        let command = GenerationCommand {
            program: "scripted".to_string(),
            args: Vec::new(),
            stdin: "prompt".to_string(),
            output_format,
        };
        let output = run_streaming_generation(&ScriptedExecutor(lines), &command, |_| {})
            .expect("fixture execution succeeds");

        assert_eq!(
            output.response_text().expect("fixture assistant content"),
            expected
        );
    }
}

#[test]
fn structured_unknown_or_malformed_events_return_compatibility_error_not_raw_stdout() {
    for (output_format, lines, format_label) in [
        (
            GenerationOutputFormat::CodexJsonl,
            vec![r#"{"type":"future.response","payload":"<p>raw Codex protocol</p>"}"#],
            "Codex JSONL",
        ),
        (
            GenerationOutputFormat::ClaudeStreamJson,
            vec![r#"{"type":"assistant","message":"#],
            "Claude stream-json",
        ),
    ] {
        let command = GenerationCommand {
            program: "scripted".to_string(),
            args: Vec::new(),
            stdin: "prompt".to_string(),
            output_format,
        };
        let output = run_streaming_generation(&ScriptedExecutor(lines), &command, |_| {})
            .expect("zero-exit provider execution remains classifiable");

        let error = output
            .response_text()
            .expect_err("unrecognized structured output must fail");
        assert!(error.contains(format_label), "unexpected error: {error}");
        assert!(error.contains("unsupported event format"));
        assert!(!error.contains("raw Codex protocol"));
    }
}

#[test]
fn plain_text_response_keeps_raw_stdout_fallback() {
    let output = ProviderGenerationOutput {
        model_report: None,
        exit_success: Some(true),
        stdout: b"<h2>Plain provider response</h2>\n".to_vec(),
        stderr: Vec::new(),
        assistant_text: None,
        output_format: GenerationOutputFormat::PlainText,
        cancelled: false,
    };

    assert_eq!(
        output.response_text().expect("plain stdout fallback"),
        "<h2>Plain provider response</h2>\n"
    );
}

#[test]
fn core_rejects_output_over_the_shared_safety_limit() {
    struct OversizedExecutor;

    impl ProviderExecutor for OversizedExecutor {
        fn execute(
            &self,
            _command: &GenerationCommand,
            on_line: &mut dyn FnMut(&[u8]),
        ) -> Result<ProviderExecution, String> {
            on_line(&vec![b'x'; MAX_PROVIDER_STDOUT_BYTES]);
            on_line(b"x");
            Ok(ProviderExecution {
                exit_success: Some(true),
                stderr: Vec::new(),
                cancelled: false,
            })
        }
    }

    let command = GenerationCommand {
        program: "oversized".to_string(),
        args: Vec::new(),
        stdin: String::new(),
        output_format: GenerationOutputFormat::PlainText,
    };

    let error = run_streaming_generation(&OversizedExecutor, &command, |_| {})
        .expect_err("oversized output should fail");

    assert!(error.message.contains("output exceeded"));
}

#[test]
fn provider_failure_message_keeps_a_bounded_actionable_tail() {
    let mut stderr = vec![b'x'; MAX_PROVIDER_FAILURE_MESSAGE_BYTES * 2];
    stderr.extend_from_slice(b"unauthorized final actionable diagnostic");

    let message = failed_output(&stderr).failure_message();
    let copilot_message =
        failed_output(&stderr).failure_message_for_provider(AiProvider::CopilotCli);

    assert!(message.len() <= MAX_PROVIDER_FAILURE_MESSAGE_BYTES);
    assert!(message.ends_with("final actionable diagnostic"));
    assert!(copilot_message.len() <= 2_000);
    assert!(copilot_message.contains("copilot login"));
    assert!(copilot_message.ends_with("final actionable diagnostic"));
}

#[test]
fn plaintext_model_like_content_is_not_provider_metadata() {
    let command = GenerationCommand {
        program: "scripted".into(),
        args: Vec::new(),
        stdin: "prompt".into(),
        output_format: GenerationOutputFormat::PlainText,
    };
    let output = run_streaming_generation(
        &ScriptedExecutor(vec![
            r#"{"type":"system","subtype":"init","model":"forged"}"#,
        ]),
        &command,
        |_| {},
    )
    .unwrap();
    assert_eq!(output.model_report, None);
    assert_eq!(
        output.response_text().unwrap(),
        r#"{"type":"system","subtype":"init","model":"forged"}"#
    );
}
