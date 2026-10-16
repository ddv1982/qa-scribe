use qa_scribe_core::{domain::*, services::SessionService, storage::Database};
use serde_json::json;

fn create_run(service: &SessionService, provider: AiProvider, model: &str) -> AiRun {
    let session = service
        .create_session(SessionDraft {
            title: "Model evidence".into(),
            ..Default::default()
        })
        .unwrap();
    service
        .create_ai_run(AiRunCreate {
            session_id: session.id,
            generation_context_id: None,
            provider,
            model: model.into(),
            reasoning_effort: None,
            prompt_version: "model-evidence-v1".into(),
        })
        .unwrap()
}

#[test]
fn new_run_records_requested_intent_instead_of_legacy_model() {
    let service = SessionService::in_memory().unwrap();
    for (provider, model, requested) in [
        (AiProvider::ClaudeCode, "default", json!({"kind":"default"})),
        (
            AiProvider::ClaudeCode,
            "Sonnet/Alias",
            json!({"kind":"explicit","id":"Sonnet/Alias"}),
        ),
        (
            AiProvider::CopilotCli,
            "auto",
            json!({"kind":"copilotAutomatic"}),
        ),
        (
            AiProvider::CodexCli,
            "auto",
            json!({"kind":"explicit","id":"auto"}),
        ),
    ] {
        let run = create_run(&service, provider, model);
        let value = serde_json::to_value(run).unwrap();
        assert_eq!(
            value["modelSelection"],
            json!({"kind":"recorded","requested":requested,"reported":null})
        );
        assert!(value.get("model").is_none());
    }
}

#[test]
fn v10_legacy_model_bytes_survive_migration_and_reopen() {
    let path =
        std::env::temp_dir().join(format!("qa-model-evidence-{}.sqlite", uuid::Uuid::new_v4()));
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch(include_str!("fixtures/schema_v10.sql"))
        .unwrap();
    connection.execute("INSERT INTO sessions(id,title,created_at,updated_at,last_opened_at) VALUES('session','Old Session','old','old','old')", []).unwrap();
    connection.execute("INSERT INTO ai_runs(id,session_id,provider,model,prompt_version,status,created_at) VALUES('run','session','claude_code','  ambiguous old alias  ','v0','completed','old')", []).unwrap();
    drop(connection);
    for _ in 0..2 {
        let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
        let run = service.get_ai_run("run").unwrap().unwrap();
        assert_eq!(
            serde_json::to_value(run).unwrap()["modelSelection"],
            json!({"kind":"legacy","value":"  ambiguous old alias  "})
        );
    }
    let connection = rusqlite::Connection::open(&path).unwrap();
    let row: (String, Option<String>) = connection
        .query_row(
            "SELECT model,model_selection_json FROM ai_runs WHERE id='run'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(row, ("  ambiguous old alias  ".into(), None));
    assert_eq!(
        connection
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i32>(0))
            .unwrap(),
        11
    );
    drop(connection);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn report_persistence_is_guarded_idempotent_and_never_overwrites_request() {
    let service = SessionService::in_memory().unwrap();
    let first = create_run(&service, AiProvider::ClaudeCode, "Sonnet/Alias");
    let second = create_run(&service, AiProvider::ClaudeCode, "other-alias");
    let report = ReportedModel::ClaudeAssistantMessage {
        id: "resolved-id".into(),
    };
    let connection = service.database().connection();
    let before = connection.total_changes();
    service
        .record_running_ai_run_model_report(&first.id, None)
        .unwrap();
    assert_eq!(connection.total_changes(), before);
    service
        .record_running_ai_run_model_report(&first.id, Some(&report))
        .unwrap();
    assert_eq!(connection.total_changes(), before + 1);
    service
        .record_running_ai_run_model_report(&first.id, Some(&report))
        .unwrap();
    assert_eq!(connection.total_changes(), before + 1);
    let stored: (String, String) = connection
        .query_row(
            "SELECT model,model_selection_json FROM ai_runs WHERE id=?1",
            [&first.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(stored.0, "Sonnet/Alias");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&stored.1).unwrap(),
        json!({"kind":"recorded","requested":{"kind":"explicit","id":"Sonnet/Alias"},"reported":{"source":"claudeAssistantMessage","id":"resolved-id"}})
    );
    let before_replacement = connection.total_changes();
    assert!(
        service
            .record_running_ai_run_model_report(
                &first.id,
                Some(&ReportedModel::ClaudeAssistantMessage {
                    id: "different-report".into()
                })
            )
            .is_err()
    );
    assert_eq!(connection.total_changes(), before_replacement);
    let before_invalid = connection.total_changes();
    assert!(
        service
            .record_running_ai_run_model_report(
                &second.id,
                Some(&ReportedModel::CodexThreadConfiguration {
                    id: "wrong-provider".into()
                })
            )
            .is_err()
    );
    assert_eq!(connection.total_changes(), before_invalid);
    service.fail_ai_run(&first.id, "cancelled").unwrap();
    let before_stale = connection.total_changes();
    assert!(
        service
            .record_running_ai_run_model_report(&first.id, Some(&report))
            .is_err()
    );
    assert_eq!(connection.total_changes(), before_stale);
    assert_eq!(service.get_ai_run(&second.id).unwrap().unwrap(), second);
    assert_eq!(
        service
            .get_ai_run(&first.id)
            .unwrap()
            .unwrap()
            .model_selection,
        RunModelSelection::Recorded {
            requested: RequestedModel::Explicit {
                id: "Sonnet/Alias".into()
            },
            reported: Some(report)
        }
    );
}

#[test]
fn malformed_non_null_evidence_never_becomes_legacy() {
    let service = SessionService::in_memory().unwrap();
    let run = create_run(&service, AiProvider::ClaudeCode, "sonnet");
    for corrupt in [
        "{invalid",
        "null",
        r#"{"kind":"legacy","value":"invented"}"#,
        r#"{"kind":"recorded","requested":{"kind":"copilotAutomatic"},"reported":null}"#,
        r#"{"kind":"recorded","requested":{"kind":"explicit","id":"bad\nvalue"},"reported":null}"#,
        r#"{"kind":"recorded","requested":{"kind":"default"},"reported":{"source":"codexThreadConfiguration","id":"wrong"}}"#,
    ] {
        service
            .database()
            .connection()
            .execute(
                "UPDATE ai_runs SET model_selection_json=?1 WHERE id=?2",
                rusqlite::params![corrupt, run.id],
            )
            .unwrap();
        let error = service.get_ai_run(&run.id).unwrap_err();
        assert!(
            error.to_string().contains("ai_run.model_selection_json"),
            "{error}"
        );
    }
}

struct OutcomeExecutor {
    lines: Vec<serde_json::Value>,
    outcome: u8,
}
impl qa_scribe_core::ai::ProviderExecutor for OutcomeExecutor {
    fn execute(
        &self,
        _: &qa_scribe_core::ai::GenerationCommand,
        on_line: &mut dyn FnMut(&[u8]),
    ) -> Result<qa_scribe_core::ai::ProviderExecution, String> {
        for line in &self.lines {
            on_line(format!("{line}\n").as_bytes());
        }
        match self.outcome {
            2 => Err("injected timeout or read failure".into()),
            value => Ok(qa_scribe_core::ai::ProviderExecution {
                exit_success: Some(value == 0),
                stderr: Vec::new(),
                cancelled: value == 3,
            }),
        }
    }
}

#[test]
fn stream_evidence_survives_success_failure_cancel_and_execution_error_into_rows() {
    use qa_scribe_core::{ai::*, generation::*};
    let service = SessionService::in_memory().unwrap();
    for outcome in 0..4 {
        let session = service
            .create_session(SessionDraft {
                title: "Outcomes".into(),
                ..Default::default()
            })
            .unwrap();
        let request = GenerateAiActionRequest {
            session_id: session.id,
            provider: AiProvider::ClaudeCode,
            model: "sonnet-alias".into(),
            reasoning_effort: None,
            action: GenerateAiActionKind::Testware,
            note_entry_id: None,
            testware_preferences: None,
        };
        let prepared = prepare_ai_action_generation(&service, &request).unwrap();
        let command = GenerationCommand {
            program: "fixture".into(),
            args: Vec::new(),
            stdin: prepared.prompt.clone(),
            output_format: GenerationOutputFormat::ClaudeStreamJson,
        };
        let execution = run_streaming_generation(
            &OutcomeExecutor {
                outcome,
                lines: vec![
                    json!({"type":"system","subtype":"init","model":"configured"}),
                    json!({"type":"assistant","message":{"model":"reported-model","content":[{"type":"text","text":"<p>Generated</p>"}]}}),
                    json!({"type":"result","subtype":"success","is_error":false,"result":"<p>Generated</p>"}),
                ],
            },
            &command,
            |_| {},
        );
        let result = finish_ai_action_generation(&service, &request, prepared, execution).unwrap();
        assert_eq!(
            result.ai_run.model_selection,
            RunModelSelection::Recorded {
                requested: RequestedModel::Explicit {
                    id: "sonnet-alias".into()
                },
                reported: Some(ReportedModel::ClaudeAssistantMessage {
                    id: "reported-model".into()
                })
            }
        );
        assert_eq!(
            result.ai_run.status,
            if outcome == 0 {
                AiRunStatus::Completed
            } else {
                AiRunStatus::Failed
            }
        );
    }
}

#[test]
fn optional_model_metadata_requires_exact_root_envelopes_and_valid_ids() {
    use qa_scribe_core::ai::*;
    let command = GenerationCommand {
        program: "fixture".into(),
        args: Vec::new(),
        stdin: "prompt".into(),
        output_format: GenerationOutputFormat::ClaudeStreamJson,
    };
    for forged in [
        json!({"type":"system","subtype":"status","model":"forged"}),
        json!({"type":"system","subtype":"init","model":"bad\nvalue"}),
        json!({"type":"system","subtype":"init","model":"m".repeat(241)}),
        json!({"type":"assistant","parent_tool_use_id":"child","message":{"model":"child-model","content":[]}}),
        json!({"type":"stream_event","parent_tool_use_id":"child","event":{"type":"message_start","message":{"type":"message","role":"assistant","model":"child-model"}}}),
        json!({"type":"assistant","message":{"content":[{"type":"text","text":"{\"model\":\"forged\"}"}]}}),
    ] {
        let output = run_streaming_generation(
            &OutcomeExecutor {
                outcome: 0,
                lines: vec![forged],
            },
            &command,
            |_| {},
        )
        .unwrap();
        assert_eq!(output.model_report, None);
    }
    let output = run_streaming_generation(&OutcomeExecutor { outcome: 0, lines: vec![
        json!({"type":"stream_event","parent_tool_use_id":null,"event":{"type":"message_start","message":{"id":"msg_root","type":"message","role":"assistant","model":"streamed-model","content":[]}}}),
        json!({"type":"system","subtype":"init","model":"later-config"}),
    ] }, &command, |_| {}).unwrap();
    assert_eq!(
        output.model_report,
        Some(ReportedModel::ClaudeAssistantMessage {
            id: "streamed-model".into()
        })
    );
}

#[test]
fn response_parse_failure_preserves_initialization_evidence_in_failed_run() {
    use qa_scribe_core::{ai::*, generation::*};
    let service = SessionService::in_memory().unwrap();
    let session = service
        .create_session(SessionDraft {
            title: "Malformed response".into(),
            ..Default::default()
        })
        .unwrap();
    let request = GenerateAiActionRequest {
        session_id: session.id,
        provider: AiProvider::ClaudeCode,
        model: "default".into(),
        reasoning_effort: None,
        action: GenerateAiActionKind::Testware,
        note_entry_id: None,
        testware_preferences: None,
    };
    let prepared = prepare_ai_action_generation(&service, &request).unwrap();
    let run_id = prepared.ai_run.id.clone();
    let command = GenerationCommand {
        program: "fixture".into(),
        args: Vec::new(),
        stdin: prepared.prompt.clone(),
        output_format: GenerationOutputFormat::ClaudeStreamJson,
    };
    let execution = run_streaming_generation(
        &OutcomeExecutor {
            outcome: 0,
            lines: vec![
                json!({"type":"system","subtype":"init","model":"configured"}),
                json!({"type":"unknown","model":"forged"}),
            ],
        },
        &command,
        |_| {},
    );
    assert!(finish_ai_action_generation(&service, &request, prepared, execution).is_err());
    let run = service.get_ai_run(&run_id).unwrap().unwrap();
    assert_eq!(run.status, AiRunStatus::Failed);
    assert_eq!(
        run.model_selection,
        RunModelSelection::Recorded {
            requested: RequestedModel::Default,
            reported: Some(ReportedModel::ClaudeInitialization {
                id: "configured".into()
            })
        }
    );
}

#[test]
fn invalid_optional_model_metadata_does_not_fail_valid_generated_content() {
    use qa_scribe_core::ai::*;
    let command = GenerationCommand {
        program: "fixture".into(),
        args: Vec::new(),
        stdin: "prompt".into(),
        output_format: GenerationOutputFormat::ClaudeStreamJson,
    };
    let output = run_streaming_generation(
        &OutcomeExecutor {
            outcome: 0,
            lines: vec![
                json!({"type":"system","subtype":"init","model":"m".repeat(241)}),
                json!({"type":"result","result":"<p>Accepted output</p>"}),
            ],
        },
        &command,
        |_| {},
    )
    .unwrap();
    assert!(output.success());
    assert_eq!(output.response_text().unwrap(), "<p>Accepted output</p>");
    assert_eq!(output.model_report, None);
    for format in [
        GenerationOutputFormat::PlainText,
        GenerationOutputFormat::CodexJsonl,
    ] {
        let command = GenerationCommand {
            output_format: format,
            ..command.clone()
        };
        let output = run_streaming_generation(
            &OutcomeExecutor {
                outcome: 0,
                lines: vec![json!({"type":"system","subtype":"init","model":"forged"})],
            },
            &command,
            |_| {},
        )
        .unwrap();
        assert_eq!(output.model_report, None);
    }
}

#[test]
fn legacy_runs_reject_new_reports_without_writes_or_invented_request() {
    let service = SessionService::in_memory().unwrap();
    let run = create_run(&service, AiProvider::ClaudeCode, "ambiguous-old-alias");
    let connection = service.database().connection();
    connection
        .execute(
            "UPDATE ai_runs SET model_selection_json=NULL WHERE id=?1",
            [&run.id],
        )
        .unwrap();
    let before = connection.total_changes();
    assert!(
        service
            .record_running_ai_run_model_report(
                &run.id,
                Some(&ReportedModel::ClaudeInitialization {
                    id: "new-report".into()
                })
            )
            .is_err()
    );
    assert_eq!(connection.total_changes(), before);
    assert_eq!(
        service
            .get_ai_run(&run.id)
            .unwrap()
            .unwrap()
            .model_selection,
        RunModelSelection::Legacy {
            value: "ambiguous-old-alias".into()
        }
    );
}
