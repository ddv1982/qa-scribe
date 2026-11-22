use crate::{
    ai::read_source_availability::{ReadSourceUnavailableReason, UnavailableReadSource},
    domain::GenerationReadSource,
};

use super::*;

/// Claude Code stream-json where the claude.ai connectors were turned off:
/// the init event lists no Atlassian tools and no Atlassian server.
const CONNECTORS_OFF: &str = concat!(
    r#"{"type":"system","subtype":"init","parent_tool_use_id":null,"tools":[],"mcp_servers":[]}"#,
    "\n",
    r#"{"type":"result","subtype":"success","is_error":false,"result":"done"}"#,
    "\n",
);

fn finish_with_jira(action: GenerateAiActionKind, stdout: &str) -> GenerateAiActionResult {
    finish_jira_run(
        AiProvider::ClaudeCode,
        action,
        GenerationOutputFormat::ClaudeStreamJson,
        stdout,
        Vec::new(),
    )
}

fn finish_jira_run(
    provider: AiProvider,
    action: GenerateAiActionKind,
    format: GenerationOutputFormat,
    stdout: &str,
    preflight: Vec<UnavailableReadSource>,
) -> GenerateAiActionResult {
    let service = SessionService::in_memory().expect("service should open");
    let mut settings = service.get_settings().expect("settings should read");
    settings.generation_read_sources = vec![GenerationReadSource::Jira];
    service
        .update_settings(settings)
        .expect("settings should save");
    let session = create_session(&service, "Gmail login");
    let note = create_note(&service, &session.id, "Gmail login", "<p>See QA-1.</p>");
    let mut request = request_for(&service, &session.id, action, Some(&note.id));
    request.provider = provider;
    let mut prepared =
        prepare_ai_action_generation(&service, &request).expect("generation should prepare");
    prepared.unavailable_read_sources = preflight;
    let mut output = successful_structured_output(format, stdout);
    output.assistant_text = Some("<h2>Result</h2><p>Gmail login fails.</p>".to_string());
    finish_ai_action_generation(&service, &request, prepared, Ok(output))
        .expect("generation should finish")
}

#[test]
fn every_action_succeeds_and_reports_a_missing_connector() {
    for action in [
        GenerateAiActionKind::Testware,
        GenerateAiActionKind::Finding,
        GenerateAiActionKind::Summary,
    ] {
        let result = finish_with_jira(action, CONNECTORS_OFF);
        assert_eq!(result.ai_run.status, crate::domain::AiRunStatus::Completed);
        assert_eq!(
            result.unavailable_read_sources,
            [UnavailableReadSource {
                source: GenerationReadSource::Jira,
                reason: ReadSourceUnavailableReason::ConnectorMissing,
            }],
            "{action:?}"
        );
    }
}

#[test]
fn a_run_without_an_init_event_reports_nothing() {
    let result = finish_with_jira(
        GenerateAiActionKind::Testware,
        r#"{"type":"result","subtype":"success","is_error":false,"result":"done"}"#,
    );
    assert!(result.unavailable_read_sources.is_empty());
}

const CODEX_JIRA_LOOKUP: &str = concat!(
    r#"{"type":"item.completed","item":{"id":"item_1","type":"mcp_tool_call","server":"qa_scribe_atlassian","tool":"getJiraIssue","status":"completed"}}"#,
    "\n",
);

#[test]
fn codex_reports_the_sign_in_found_before_the_run() {
    let needs_sign_in = vec![UnavailableReadSource {
        source: GenerationReadSource::Jira,
        reason: ReadSourceUnavailableReason::NeedsSignIn,
    }];
    let result = finish_jira_run(
        AiProvider::CodexCli,
        GenerateAiActionKind::Testware,
        GenerationOutputFormat::CodexJsonl,
        "",
        needs_sign_in.clone(),
    );
    assert_eq!(result.ai_run.status, crate::domain::AiRunStatus::Completed);
    assert_eq!(result.unavailable_read_sources, needs_sign_in);
}

#[test]
fn codex_may_call_the_enabled_read_tools() {
    let result = finish_jira_run(
        AiProvider::CodexCli,
        GenerateAiActionKind::Finding,
        GenerationOutputFormat::CodexJsonl,
        CODEX_JIRA_LOOKUP,
        Vec::new(),
    );
    assert_eq!(result.ai_run.status, crate::domain::AiRunStatus::Completed);
    assert!(result.unavailable_read_sources.is_empty());
}

#[test]
fn a_codex_call_outside_the_allowlist_discards_the_result() {
    let write = CODEX_JIRA_LOOKUP.replace("getJiraIssue", "createJiraIssue");
    let service = SessionService::in_memory().expect("service should open");
    let session = create_session(&service, "Gmail login");
    let note = create_note(&service, &session.id, "Gmail login", "<p>See QA-1.</p>");
    let mut request = request_for(
        &service,
        &session.id,
        GenerateAiActionKind::Testware,
        Some(&note.id),
    );
    request.provider = AiProvider::CodexCli;
    let prepared =
        prepare_ai_action_generation(&service, &request).expect("generation should prepare");
    let mut output = successful_structured_output(GenerationOutputFormat::CodexJsonl, &write);
    output.assistant_text = Some("<h2>Result</h2><p>Gmail login fails.</p>".to_string());
    let error = finish_ai_action_generation(&service, &request, prepared, Ok(output))
        .expect_err("a disallowed call should fail the run");
    assert!(
        error
            .to_string()
            .contains("qa_scribe_atlassian/createJiraIssue")
    );
    assert_eq!(count_table_rows(&service, "drafts"), 0);
}
