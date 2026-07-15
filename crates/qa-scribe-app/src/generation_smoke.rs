//! Headless smoke coverage for the AI generation workflow.
//!
//! Runs the full core workflow — prepare → provider execution (scripted) →
//! stream parsing → result routing — against a fake [`ProviderExecutor`]
//! that replays Codex-style JSONL lines, then asserts the persisted records.

use qa_scribe_core::{
    ai::{
        GenerationCommand, GenerationOutputFormat, ProviderExecution, ProviderExecutor,
        run_streaming_generation, stream::StreamUpdate,
    },
    domain::{AiProvider, AiRunStatus, Attachment, Entry, EntryPatch},
    generation::{
        GenerateAiActionKind, GenerateAiActionRequest, finish_ai_action_generation,
        prepare_ai_action_generation,
    },
    services::SessionService,
};

/// A scripted provider CLI: emits the given JSONL lines and exits successfully.
struct ScriptedExecutor {
    lines: Vec<String>,
}

impl ProviderExecutor for ScriptedExecutor {
    fn execute(
        &self,
        _command: &GenerationCommand,
        on_line: &mut dyn FnMut(&[u8]),
    ) -> Result<ProviderExecution, String> {
        for line in &self.lines {
            on_line(format!("{line}\n").as_bytes());
        }
        Ok(ProviderExecution {
            exit_success: Some(true),
            stderr: Vec::new(),
            cancelled: false,
        })
    }
}

pub fn run_generation_smoke(
    service: &SessionService,
    session_id: &str,
    note: &Entry,
    attachment: &Attachment,
) -> qa_scribe_core::Result<()> {
    // Reference the managed attachment from the note body so generation must
    // preserve the managed image and link it as evidence.
    let note = service.update_entry(
        &note.id,
        EntryPatch {
            body: Some(format!(
                "<p>Checkout shows a network error after payment.</p>\
                 <img src=\"qa-scribe-attachment://{id}\" data-attachment-id=\"{id}\" alt=\"Checkout log\" />",
                id = attachment.id
            )),
            ..EntryPatch::default()
        },
    )?;

    smoke_testware_generation(service, session_id, &note)?;
    smoke_finding_generation(service, session_id, &note, attachment)?;
    Ok(())
}

/// Testware generation: scripted Codex JSONL stream → Draft + completed AiRun.
fn smoke_testware_generation(
    service: &SessionService,
    session_id: &str,
    note: &Entry,
) -> qa_scribe_core::Result<()> {
    let request = request_for(session_id, GenerateAiActionKind::Testware, &note.id);
    let prepared = prepare_ai_action_generation(service, &request)?;
    assert!(
        prepared.prompt.contains("network error after payment"),
        "prompt should contain the note body"
    );

    let executor = ScriptedExecutor {
        lines: vec![
            r#"{"type":"turn.started"}"#.to_string(),
            r#"{"type":"item/agentMessage/delta","delta":"<h2>Checkout cases</h2>"}"#.to_string(),
            r#"{"type":"item/agentMessage/delta","delta":"<p>Verify payment retry.</p>"}"#
                .to_string(),
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"<h2>Checkout cases</h2><p>Verify payment retry.</p>"}}"#
                .to_string(),
        ],
    };
    let command = scripted_command(&prepared.prompt);
    let mut partials = Vec::new();
    let mut partial = String::new();
    let output = run_streaming_generation(&executor, &command, |update| {
        match update {
            StreamUpdate::PartialDelta(delta) => partial.push_str(&delta),
            StreamUpdate::PartialSnapshot(body) => partial = body,
            StreamUpdate::Progress(_) => return,
        }
        partials.push(partial.clone());
    });
    assert_eq!(
        partials.last().map(String::as_str),
        Some("<h2>Checkout cases</h2><p>Verify payment retry.</p>"),
        "streaming should surface accumulated partial text"
    );

    let result = finish_ai_action_generation(service, &request, prepared, output)?;
    assert_eq!(result.ai_run.status, AiRunStatus::Completed);
    assert_eq!(result.ai_run.error_message, None);
    let draft = result.draft.expect("testware draft should be created");
    assert_eq!(draft.ai_run_id.as_deref(), Some(result.ai_run.id.as_str()));
    assert!(draft.body.contains("<h2>Checkout cases</h2>"));
    assert!(
        draft.body.contains("qa-scribe-attachment://"),
        "draft should preserve the managed evidence image"
    );
    Ok(())
}

/// Finding generation: scripted stream → Finding + evidence links to the note
/// and its managed attachment.
fn smoke_finding_generation(
    service: &SessionService,
    session_id: &str,
    note: &Entry,
    attachment: &Attachment,
) -> qa_scribe_core::Result<()> {
    let request = request_for(session_id, GenerateAiActionKind::Finding, &note.id);
    let prepared = prepare_ai_action_generation(service, &request)?;

    let executor = ScriptedExecutor {
        lines: vec![
            r#"{"type":"item/agentMessage/delta","delta":"<h2>Checkout returns a network error</h2><p>Payment fails.</p>"}"#
                .to_string(),
        ],
    };
    let command = scripted_command(&prepared.prompt);
    let output = run_streaming_generation(&executor, &command, |_| {});
    let result = finish_ai_action_generation(service, &request, prepared, output)?;

    assert_eq!(result.ai_run.status, AiRunStatus::Completed);
    let finding = result.finding.expect("finding should be created");
    assert_eq!(finding.title, "Checkout returns a network error");

    let evidence_links = service.list_evidence_links(session_id)?;
    assert!(
        evidence_links
            .iter()
            .any(|link| link.finding_id == finding.id
                && link.entry_id.as_deref() == Some(note.id.as_str())),
        "finding should link the source note as evidence"
    );
    assert!(
        evidence_links
            .iter()
            .any(|link| link.finding_id == finding.id
                && link.attachment_id.as_deref() == Some(attachment.id.as_str())),
        "finding should link the managed attachment as evidence"
    );
    Ok(())
}

fn request_for(
    session_id: &str,
    action: GenerateAiActionKind,
    note_id: &str,
) -> GenerateAiActionRequest {
    GenerateAiActionRequest {
        session_id: session_id.to_string(),
        provider: AiProvider::CodexCli,
        model: "default".to_string(),
        reasoning_effort: None,
        action,
        note_entry_id: Some(note_id.to_string()),
        testware_preferences: None,
    }
}

fn scripted_command(prompt: &str) -> GenerationCommand {
    GenerationCommand {
        program: "scripted-provider".to_string(),
        args: Vec::new(),
        stdin: prompt.to_string(),
        output_format: GenerationOutputFormat::CodexJsonl,
    }
}
