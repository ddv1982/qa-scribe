use super::*;
use crate::jobs::JobStore;
use qa_scribe_core::domain::ReportedModel;

#[test]
fn synchronous_ui_cancel_finishes_and_freezes_report_before_trailing_frames() {
    let cli = FakeCli::new(
        "cancel-model-report",
        r#"#!/bin/sh
cat >/dev/null
sleep 120 &
sleeper=$!
printf '%s\n' '{"type":"system","subtype":"init","model":"before-cancel"}' '{"type":"content_block_delta","delta":{"text":"ready"}}' '{"type":"assistant","message":{"model":"after-cancel","content":[]}}'
wait "$sleeper"
"#,
    );
    let command = cli.command("prompt".into(), GenerationOutputFormat::ClaudeStreamJson);
    let jobs = JobStore::default();
    let (_, control) = jobs
        .insert_generation_job("job".into(), "session".into(), "test".into())
        .unwrap();
    jobs.mark_running("job", "run".into(), "Running").unwrap();
    let output = run_bounded(Duration::from_secs(10), move || {
        let mut cancelled = false;
        run_generation_command_streaming(&command, &control, |update| {
            if !cancelled && matches!(update, StreamUpdate::PartialDelta(_)) {
                jobs.cancel("job").unwrap();
                cancelled = true;
            }
        })
    })
    .unwrap();
    assert!(output.cancelled);
    assert_eq!(
        output.model_report,
        Some(ReportedModel::ClaudeInitialization {
            id: "before-cancel".into()
        })
    );
    assert!(!String::from_utf8_lossy(&output.stdout).contains("after-cancel"));
}

#[test]
fn process_timeout_preserves_metadata_collected_before_failure() {
    let cli = FakeCli::new(
        "timeout-model-report",
        r#"#!/bin/sh
cat >/dev/null
printf '%s\n' '{"type":"system","subtype":"init","model":"configured-before-timeout"}'
sleep 120
"#,
    );
    let command = cli.command("prompt".into(), GenerationOutputFormat::ClaudeStreamJson);
    let error = run_bounded(Duration::from_secs(10), move || {
        let control = JobControl::default();
        let executor = ProcessProviderExecutor::with_timeout(&control, Duration::from_millis(500));
        run_streaming_generation(&executor, &command, |_| {})
    })
    .unwrap_err();
    assert!(error.message.contains("timed out"));
    assert_eq!(
        error.model_report,
        Some(ReportedModel::ClaudeInitialization {
            id: "configured-before-timeout".into()
        })
    );
}

#[test]
fn watchdog_kills_silent_child_and_fails_job() {
    let cli = FakeCli::new(
        "fake-silent",
        "#!/bin/sh\ncat >/dev/null\nsleep 120\nexit 0\n",
    );
    let command = cli.command("prompt".to_string(), GenerationOutputFormat::CodexJsonl);
    let control = JobControl::default();

    let started = Instant::now();
    let result = run_bounded(Duration::from_secs(15), move || {
        let executor = ProcessProviderExecutor::with_timeout(&control, Duration::from_millis(500));
        run_streaming_generation(&executor, &command, |_| {})
    });

    assert!(
        started.elapsed() < Duration::from_secs(10),
        "watchdog should fire well before the child's own sleep"
    );
    let error = result.expect_err("watchdog should fail the generation");
    assert!(
        error.message.contains("timed out"),
        "expected timeout error, got: {error}"
    );
}
