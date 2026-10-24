//! RED process contract. All peers are local Python children, never installed
//! provider CLIs. Negative cases require spawn evidence, so the stub cannot pass.
use super::*;
use crate::jobs::{ChatPermissionDecision, ChatPermissionDecisionRequest};
use qa_scribe_core::ai::GenerationOutputFormat;
use serde_json::{Value, json};
use std::{fs, path::PathBuf, thread, time::Instant};

const PROVIDERS: [AiProvider; 3] = [
    AiProvider::ClaudeCode,
    AiProvider::CodexCli,
    AiProvider::CopilotCli,
];

struct Fixture {
    dir: PathBuf,
    provider: AiProvider,
    jobs: JobStore,
    control: JobControl,
    input: qa_scribe_core::chat::ChatInput,
}

impl Fixture {
    fn new(provider: AiProvider) -> Self {
        let dir = std::env::temp_dir().join(format!("qa-scribe-duplex-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let jobs = JobStore::default();
        let (_, control) = jobs
            .insert_generation_job("job".into(), "session".into(), "chat".into())
            .unwrap();
        jobs.mark_running("job", "run".into(), "Running").unwrap();
        Self {
            dir,
            provider,
            jobs,
            control,
            input: qa_scribe_core::chat::ChatInput::from("fixture prompt"),
        }
    }

    fn context(&self) -> ChatDuplexContext<'_> {
        ChatDuplexContext {
            input: &self.input,
            job_id: "job",
            jobs: &self.jobs,
            control: &self.control,
            provider: self.provider,
            app_data_dir: &self.dir,
            model: "chosen-model",
            reasoning_effort: Some("high"),
        }
    }

    fn command(&self, mode: &str, id: &str) -> GenerationCommand {
        let provider = match self.provider {
            AiProvider::ClaudeCode => "claude",
            AiProvider::CodexCli => "codex",
            AiProvider::CopilotCli => "copilot",
        };
        GenerationCommand {
            program: "python3".into(),
            args: vec![
                "-u".into(),
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("src/commands/ai/chat_duplex/fixture.py")
                    .to_string_lossy()
                    .into_owned(),
                provider.into(),
                mode.into(),
                self.dir.to_string_lossy().into_owned(),
                id.into(),
                env!("CARGO_PKG_VERSION").into(),
            ],
            // Internal prompt transport only, never copied to process argv.
            stdin: "fixture prompt".into(),
            output_format: GenerationOutputFormat::PlainText,
        }
    }

    fn records(&self) -> Vec<Value> {
        fs::read_to_string(self.dir.join("wire.jsonl"))
            .expect("real child must start and record its wire exchange")
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    fn run(
        &self,
        mode: &str,
        id: &str,
        updates: impl FnMut(StreamUpdate),
        statuses: impl FnMut(GenerationJobStatus),
    ) -> Result<ProviderGenerationOutput, qa_scribe_core::ai::ProviderExecutionError> {
        run_chat_duplex_with_limits(
            &self.command(mode, id),
            &self.context(),
            updates,
            statuses,
            DuplexLimits {
                watchdog: Duration::from_secs(3),
                line_bytes: 4096,
                total_bytes: 8192,
            },
        )
    }

    fn decide(&self, status: GenerationJobStatus, decision: ChatPermissionDecision) {
        if let Some(pending) = status.pending_permission {
            assert_eq!(pending.provider, self.provider);
            assert!(!pending.title.trim().is_empty());
            assert_eq!(
                serde_json::from_str::<Value>(pending.input_json.as_ref().unwrap()).unwrap(),
                json!({"path":"local-fixture-only","nested":{"raw":true}})
            );
            // Public UI identity is newly generated, not the opaque wire ID.
            assert_ne!(pending.request_id, "opaque:permission/481");
            self.jobs
                .decide_chat_permission(ChatPermissionDecisionRequest {
                    job_id: "job".into(),
                    session_id: "session".into(),
                    request_id: pending.request_id,
                    provider: self.provider,
                    decision,
                })
                .unwrap();
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.jobs.kill_all_children();
        let _ = fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn chat_duplex_process_copilot_one_sided_deny_completes_without_markers() {
    assert_copilot_one_sided_deny("allow_only_deny");
}

#[test]
fn chat_duplex_process_copilot_reject_only_forged_approve_then_deny() {
    assert_copilot_one_sided_deny("reject_only_deny");
}

fn assert_copilot_one_sided_deny(mode: &str) {
    for id in ["number", "string"] {
        let fixture = Fixture::new(AiProvider::CopilotCli);
        let mut permissions = 0;
        let output = fixture
            .run(
                mode,
                id,
                |_| {},
                |status| {
                    let Some(pending) = status.pending_permission.as_ref() else {
                        return;
                    };
                    permissions += 1;
                    assert_eq!(pending.can_approve, mode == "allow_only_deny");
                    if mode == "reject_only_deny" {
                        let forged = ChatPermissionDecisionRequest {
                            job_id: "job".into(),
                            session_id: "session".into(),
                            request_id: pending.request_id.clone(),
                            provider: AiProvider::CopilotCli,
                            decision: ChatPermissionDecision::Approve,
                        };
                        assert!(fixture.jobs.decide_chat_permission(forged).is_err());
                        assert_eq!(fixture.jobs.status("job").unwrap(), status);
                    }
                    fixture.decide(status, ChatPermissionDecision::Deny);
                },
            )
            .expect("one-sided refusal must complete the provider turn");
        assert!(output.success(), "{}", output.failure_message());
        assert_eq!(output.response_text().unwrap(), "Permission denied.");
        assert_eq!(permissions, 1);
        assert!(!fixture.dir.join("tool-marker").exists());
        assert!(
            fixture
                .jobs
                .status("job")
                .unwrap()
                .pending_permission
                .is_none()
        );
        let records = fixture.records();
        assert!(
            records
                .iter()
                .any(|r| r["verified_reply"] == true && r["approved"] == false)
        );
        let wire_id = if id == "number" {
            json!(481)
        } else {
            json!("opaque:permission/481")
        };
        let replies: Vec<_> = records
            .iter()
            .filter_map(|r| r.get("received"))
            .filter(|r| r["id"] == wire_id)
            .collect();
        assert_eq!(
            replies.len(),
            1,
            "forged approval must never reach the child"
        );
        assert_eq!(
            replies[0]["result"]["outcome"],
            if mode == "allow_only_deny" {
                json!({"outcome":"cancelled"})
            } else {
                json!({"outcome":"selected","optionId":"opaque-no/481"})
            }
        );
    }
}

#[test]
fn chat_duplex_process_approve_executes_once_and_persists_final_text_all_providers() {
    for provider in PROVIDERS {
        for id in ["number", "string"] {
            let fixture = Fixture::new(provider);
            let mut partial = String::new();
            let mut permissions = 0;
            let started = Instant::now();
            let output = fixture
                .run(
                    "approve",
                    id,
                    |update| match update {
                        StreamUpdate::PartialDelta(text) => partial.push_str(&text),
                        StreamUpdate::PartialSnapshot(text) => partial = text,
                        StreamUpdate::Progress(_) => {}
                    },
                    |status| {
                        if status.pending_permission.is_some() {
                            permissions += 1;
                        }
                        fixture.decide(status, ChatPermissionDecision::Approve);
                    },
                )
                .expect("approved duplex exchange must succeed");
            assert!(
                output.success(),
                "{provider:?}: {}",
                output.failure_message()
            );
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "must not wait for server exit"
            );
            assert_eq!(permissions, 1);
            // response_text is the production workflow's persistence input.
            assert_eq!(output.response_text().unwrap(), "Connected.");
            assert_eq!(partial, "Connected.");
            assert_eq!(
                fs::read_to_string(fixture.dir.join("tool-marker")).unwrap(),
                "executed\n"
            );
            assert!(
                fixture
                    .jobs
                    .status("job")
                    .unwrap()
                    .pending_permission
                    .is_none()
            );
            let records = fixture.records();
            assert!(
                records
                    .iter()
                    .any(|r| r["verified_reply"] == true && r["approved"] == true)
            );
            let received: Vec<_> = records.iter().filter_map(|r| r.get("received")).collect();
            let expected = match provider {
                AiProvider::ClaudeCode => 3,
                AiProvider::CodexCli => 5,
                AiProvider::CopilotCli => 4,
            };
            assert_eq!(
                received.len(),
                expected,
                "init/new/prompt/decision exactly once"
            );
        }
    }
}

#[test]
fn chat_duplex_process_deny_never_executes_tool_all_providers() {
    for provider in PROVIDERS {
        for id in ["number", "string"] {
            let fixture = Fixture::new(provider);
            let mut permissions = 0;
            let output = fixture
                .run(
                    "deny",
                    id,
                    |_| {},
                    |status| {
                        if status.pending_permission.is_some() {
                            permissions += 1;
                        }
                        fixture.decide(status, ChatPermissionDecision::Deny);
                    },
                )
                .expect("denial is a completed provider turn, not a transport failure");
            assert_eq!(permissions, 1);
            assert_eq!(output.response_text().unwrap(), "Permission denied.");
            assert!(!fixture.dir.join("tool-marker").exists());
            assert!(
                fixture
                    .records()
                    .iter()
                    .any(|r| r["verified_reply"] == true && r["approved"] == false)
            );
            assert!(
                fixture
                    .jobs
                    .status("job")
                    .unwrap()
                    .pending_permission
                    .is_none()
            );
        }
    }
}

#[test]
fn chat_duplex_process_bad_metadata_unsupported_method_and_schema_fail_visibly() {
    for provider in PROVIDERS {
        for mode in ["bad_metadata", "unsupported", "schema"] {
            if mode == "schema" && provider != AiProvider::CodexCli {
                continue;
            }
            let fixture = Fixture::new(provider);
            let mut pending = false;
            let result = fixture.run(
                mode,
                "string",
                |_| {},
                |status| {
                    pending |= status.pending_permission.is_some();
                },
            );
            assert!(!fixture.records().is_empty());
            let error = result.expect_err("unsupported permission must visibly fail");
            assert!(!error.message.trim().is_empty());
            assert!(
                !error.message.contains("not implemented"),
                "must reach real protocol validation"
            );
            assert!(
                !error.message.contains("timed out"),
                "must reject immediately, not hang: {error}"
            );
            assert!(!pending);
            assert!(!fixture.dir.join("tool-marker").exists());
            assert!(
                fixture
                    .jobs
                    .status("job")
                    .unwrap()
                    .pending_permission
                    .is_none()
            );
        }
    }
}

#[cfg(unix)]
#[test]
fn chat_duplex_process_cancel_pending_kills_process_group_before_tool_marker() {
    for provider in PROVIDERS {
        let fixture = Fixture::new(provider);
        let mut cancelled = false;
        let started = Instant::now();
        let result = fixture.run(
            "cancel",
            "number",
            |_| {},
            |status| {
                if status.pending_permission.is_some() {
                    cancelled = true;
                    let status = fixture.jobs.cancel("job").unwrap();
                    assert!(status.pending_permission.is_none());
                }
            },
        );
        assert!(
            cancelled,
            "must reach pending permission before cancellation"
        );
        assert!(result.is_err() || result.as_ref().is_ok_and(|output| output.cancelled));
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "cancellation must wake pending wait"
        );
        assert!(fixture.control.is_cancelled());
        assert!(
            fixture
                .records()
                .iter()
                .any(|r| r.get("descendant_pid").is_some())
        );
        thread::sleep(Duration::from_millis(1200));
        assert!(
            !fixture.dir.join("descendant-marker").exists(),
            "descendant escaped group kill"
        );
        assert!(!fixture.dir.join("tool-marker").exists());
        assert!(
            fixture
                .jobs
                .status("job")
                .unwrap()
                .pending_permission
                .is_none()
        );
    }
}

#[test]
fn chat_duplex_process_policy_blocked_has_no_pending_permission() {
    for provider in PROVIDERS {
        let fixture = Fixture::new(provider);
        let mut pending = false;
        let result = fixture.run(
            "policy",
            "string",
            |_| {},
            |status| {
                pending |= status.pending_permission.is_some();
            },
        );
        assert!(!fixture.records().is_empty());
        let failure = match result {
            Err(error) => error.message,
            Ok(output) => {
                assert!(!output.success());
                output.failure_message()
            }
        };
        assert!(
            failure.contains("Permission denied by configured policy"),
            "{failure}"
        );
        assert!(!pending);
        assert!(!fixture.dir.join("tool-marker").exists());
    }
}

// Preserve exact test paths while keeping each physical source below 500 lines
// after rustfmt expands the process-contract assertions.
include!("tests/regressions.rs");
include!("tests/lifecycle.rs");
include!("tests/bulk.rs");

include!("tests/replay.rs");

mod model_evidence;
