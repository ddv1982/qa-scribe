use super::*;
use qa_scribe_core::domain::ReportedModel;

fn expected_report(provider: AiProvider) -> Option<ReportedModel> {
    match provider {
        AiProvider::ClaudeCode => Some(ReportedModel::ClaudeAssistantMessage {
            id: "actualmodel".into(),
        }),
        AiProvider::CodexCli => Some(ReportedModel::CodexThreadConfiguration {
            id: "actualmodel".into(),
        }),
        AiProvider::CopilotCli => None,
    }
}

#[test]
fn duplex_failures_keep_typed_report_without_fabricated_stdout() {
    for provider in PROVIDERS {
        for mode in ["report_eof", "report_invalid", "report_timeout"] {
            let fixture = Fixture::new(provider);
            let error = run_chat_duplex_with_limits(
                &fixture.command(mode, "string"),
                &fixture.context(),
                |_| {},
                |_| {},
                DuplexLimits {
                    watchdog: Duration::from_millis(500),
                    line_bytes: 4096,
                    total_bytes: 8192,
                },
            )
            .unwrap_err();
            assert_eq!(
                error.model_report,
                expected_report(provider),
                "{provider:?}/{mode}: {error}"
            );
            let expected = match mode {
                "report_eof" => "stdout",
                "report_invalid" => "Invalid provider protocol JSON",
                _ => "timed out",
            };
            assert!(
                error.message.contains(expected),
                "{provider:?}/{mode}: {error}"
            );
        }
    }
}

#[test]
fn duplex_cancel_retains_report_and_rejects_buffered_successor_metadata() {
    for provider in PROVIDERS {
        let fixture = Fixture::new(provider);
        let mut cancelled = false;
        let output = fixture
            .run(
                "report_cancel",
                "string",
                |update| {
                    if !cancelled
                        && matches!(
                            update,
                            StreamUpdate::PartialSnapshot(_) | StreamUpdate::PartialDelta(_)
                        )
                    {
                        fixture.jobs.cancel("job").unwrap();
                        cancelled = true;
                    }
                },
                |_| {},
            )
            .unwrap();
        assert!(cancelled);
        assert!(output.cancelled);
        assert_eq!(output.model_report, expected_report(provider));
        assert!(output.stdout.is_empty());
    }
}
