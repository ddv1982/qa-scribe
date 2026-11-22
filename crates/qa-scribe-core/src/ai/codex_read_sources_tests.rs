use super::*;
use crate::ai::generation_tools::{
    GenerationToolPolicy, codex_mcp_list_args, generation_command_with_tool_policy,
};
use crate::domain::AiProvider;
use GenerationReadSource::{Confluence, Jira, TeamsChannels, TeamsChats};
use serde_json::json;

fn codex_args(
    sources: &[GenerationReadSource],
    status: Option<CodexAtlassianStatus>,
) -> Vec<String> {
    let policy = GenerationToolPolicy {
        read_sources: sources.to_vec(),
        codex_mcp_servers: vec!["exa".into()],
        codex_atlassian: status,
    };
    generation_command_with_tool_policy(
        AiProvider::CodexCli,
        "note",
        "default",
        None,
        true,
        &policy,
    )
    .unwrap()
    .args
}

fn server_settings(args: &[String]) -> Vec<&str> {
    let prefix = format!("mcp_servers.{CODEX_ATLASSIAN_SERVER}.");
    args.iter()
        .filter_map(|arg| arg.strip_prefix(&prefix))
        .collect()
}

#[test]
fn a_signed_in_run_exposes_only_the_enabled_read_tools() {
    let args = codex_args(&[Jira, Confluence], Some(CodexAtlassianStatus::SignedIn));
    assert_eq!(args.last().map(String::as_str), Some("-"));
    assert_eq!(
        server_settings(&args),
        [
            r#"url="https://mcp.atlassian.com/v2/mcp?tools=all""#,
            r#"scopes=["read:me","offline_access","read:jira:agent-interface","search:jira:agent-interface","read:confluence:agent-interface","search:confluence:agent-interface"]"#,
            "enabled=true",
            r#"enabled_tools=["getAccessibleAtlassianResources","getJiraIssue","searchJiraIssuesUsingJql","listJiraIssueComments","getConfluenceContent","searchConfluence"]"#,
        ]
    );
    assert!(args.contains(&"features.apps=false".to_owned()));
    assert!(args.contains(&"mcp_servers.exa.enabled=false".to_owned()));
}

#[test]
fn the_allowlist_follows_the_enabled_sources() {
    let args = codex_args(&[Confluence], Some(CodexAtlassianStatus::SignedIn));
    assert!(server_settings(&args).contains(
        &r#"enabled_tools=["getAccessibleAtlassianResources","getConfluenceContent","searchConfluence"]"#
    ));
}

#[test]
fn the_server_stays_out_unless_signed_in_with_an_atlassian_source() {
    for (sources, status) in [
        (&[Jira][..], Some(CodexAtlassianStatus::SignedOut)),
        (&[Jira][..], None),
        (
            &[TeamsChannels, TeamsChats][..],
            Some(CodexAtlassianStatus::SignedIn),
        ),
        (&[][..], Some(CodexAtlassianStatus::SignedIn)),
    ] {
        assert!(server_settings(&codex_args(sources, status)).is_empty());
    }
}

#[test]
fn the_server_list_includes_the_atlassian_server_only_when_needed() {
    let plain = codex_mcp_list_args(&[TeamsChats]);
    assert_eq!(plain.first().map(String::as_str), Some("-c"));
    assert!(server_settings(&plain).is_empty());
    assert!(plain.ends_with(&["mcp".into(), "list".into(), "--json".into()]));
    let with_atlassian = codex_mcp_list_args(&[Jira]);
    assert_eq!(server_settings(&with_atlassian).len(), 2);
    assert!(with_atlassian.ends_with(&plain));
}

fn listed(name: &str, enabled: bool, url: &str, auth: &str) -> Value {
    json!({
        "name": name,
        "enabled": enabled,
        "transport": {"type": "streamable_http", "url": url, "bearer_token_env_var": null,
            "http_headers": null, "env_http_headers": null, "http_headers_helper": null},
        "auth_status": auth,
    })
}

fn inventory(servers: Vec<Value>) -> Result<CodexMcpInventory, String> {
    codex_mcp_inventory(&Value::Array(servers).to_string())
}

#[test]
fn the_inventory_reports_sign_in_and_never_disables_the_atlassian_server() {
    let ours = |auth| listed(CODEX_ATLASSIAN_SERVER, true, CODEX_ATLASSIAN_URL, auth);
    let other = listed("exa", true, "https://mcp.exa.ai/mcp", "not_logged_in");
    let off = listed("sentry", false, "https://mcp.sentry.dev/mcp", "oauth");
    assert_eq!(
        inventory(vec![other.clone(), ours("o_auth"), off]).unwrap(),
        CodexMcpInventory {
            servers_to_disable: vec!["exa".into()],
            atlassian: Some(CodexAtlassianStatus::SignedIn),
        }
    );
    assert_eq!(
        inventory(vec![ours("oauth")]).unwrap().atlassian,
        Some(CodexAtlassianStatus::SignedIn)
    );
    for auth in ["not_logged_in", "bearer_token", "unsupported"] {
        assert_eq!(
            inventory(vec![ours(auth)]).unwrap().atlassian,
            Some(CodexAtlassianStatus::SignedOut)
        );
    }
    assert_eq!(inventory(vec![other]).unwrap().atlassian, None);
}

#[test]
fn a_user_server_with_the_reserved_name_is_refused() {
    let elsewhere = listed(
        CODEX_ATLASSIAN_SERVER,
        true,
        "https://example.com/mcp",
        "oauth",
    );
    assert!(inventory(vec![elsewhere]).is_err());
    let mut with_header = listed(CODEX_ATLASSIAN_SERVER, false, CODEX_ATLASSIAN_URL, "oauth");
    with_header["transport"]["http_headers"] = json!({"Authorization": "x"});
    assert!(inventory(vec![with_header]).is_err());
    let stdio = json!({"name": CODEX_ATLASSIAN_SERVER, "enabled": true,
        "transport": {"type": "stdio", "command": "x"}});
    assert!(inventory(vec![stdio]).is_err());
}

#[test]
fn unsafe_server_names_and_bad_json_are_refused() {
    assert!(inventory(vec![listed("a.b", true, "https://x", "unsupported")]).is_err());
    assert!(
        inventory(vec![listed("a.b", false, "https://x", "unsupported")])
            .unwrap()
            .servers_to_disable
            .is_empty()
    );
    assert!(codex_mcp_inventory("not json").is_err());
}

#[test]
fn only_atlassian_sources_need_codex_sign_in() {
    let sources = [Jira, TeamsChats, Confluence];
    let needs_sign_in = |source| UnavailableReadSource {
        source,
        reason: ReadSourceUnavailableReason::NeedsSignIn,
    };
    assert_eq!(
        codex_unavailable_read_sources(&sources, Some(CodexAtlassianStatus::SignedOut)),
        [needs_sign_in(Jira), needs_sign_in(Confluence)]
    );
    assert_eq!(
        codex_unavailable_read_sources(&sources, None),
        [needs_sign_in(Jira), needs_sign_in(Confluence)]
    );
    assert!(
        codex_unavailable_read_sources(&sources, Some(CodexAtlassianStatus::SignedIn)).is_empty()
    );
}

fn tool_call(server: &str, tool: &str) -> Value {
    json!({"type": "item.completed", "item": {"id": "item_1", "type": "mcp_tool_call",
        "server": server, "tool": tool, "status": "completed"}})
}

#[test]
fn a_call_outside_the_allowlist_is_caught() {
    let message = json!({"type": "item.completed", "item": {"type": "agent_message", "text": "x"}});
    let read = tool_call(CODEX_ATLASSIAN_SERVER, "getJiraIssue");
    assert_eq!(
        codex_disallowed_tool_call([message.clone(), read.clone()], &[Jira]),
        None
    );
    assert_eq!(
        codex_disallowed_tool_call(
            [
                read.clone(),
                tool_call(CODEX_ATLASSIAN_SERVER, "createJiraIssue")
            ],
            &[Jira]
        ),
        Some(format!("{CODEX_ATLASSIAN_SERVER}/createJiraIssue"))
    );
    assert_eq!(
        codex_disallowed_tool_call([read.clone()], &[Confluence]),
        Some(format!("{CODEX_ATLASSIAN_SERVER}/getJiraIssue"))
    );
    assert_eq!(
        codex_disallowed_tool_call([tool_call("exa", "web_search_exa")], &[Jira]),
        Some("exa/web_search_exa".into())
    );
    assert_eq!(
        codex_disallowed_tool_call([read], &[]),
        Some(format!("{CODEX_ATLASSIAN_SERVER}/getJiraIssue"))
    );
}
