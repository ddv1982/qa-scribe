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
    let service = SessionService::in_memory().expect("service should open");
    let mut settings = service.get_settings().expect("settings should read");
    settings.generation_read_sources = vec![GenerationReadSource::Jira];
    service
        .update_settings(settings)
        .expect("settings should save");
    let session = create_session(&service, "Gmail login");
    let note = create_note(&service, &session.id, "Gmail login", "<p>See QA-1.</p>");
    let mut request = request_for(&service, &session.id, action, Some(&note.id));
    request.provider = AiProvider::ClaudeCode;
    let prepared =
        prepare_ai_action_generation(&service, &request).expect("generation should prepare");
    let mut output = successful_structured_output(GenerationOutputFormat::ClaudeStreamJson, stdout);
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
