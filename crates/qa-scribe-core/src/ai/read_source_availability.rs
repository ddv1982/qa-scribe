//! Which enabled Generate read sources Claude Code could not offer. Claude
//! Code reports its loaded tools and MCP server states in the stream's
//! `system/init` event. A run still succeeds when a connector is missing, so
//! without this check a draft would silently lack the context the user asked
//! for.

use serde::Serialize;
use serde_json::Value;

use super::generation_tools::{read_tools, server};
use crate::domain::GenerationReadSource;

/// Why an enabled read source was not available to a run.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ReadSourceUnavailableReason {
    /// Claude Code did not load the connector at all: it is not added, is
    /// turned off, or is blocked by policy.
    ConnectorMissing,
    /// The connector needs the user to sign in again.
    NeedsSignIn,
    /// The connector loaded but did not connect.
    NotConnected,
    /// The connector connected but some of the source's tools are missing.
    ToolsMissing,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UnavailableReadSource {
    pub source: GenerationReadSource,
    pub reason: ReadSourceUnavailableReason,
}

/// The enabled sources whose read tools are not all in Claude Code's top-level
/// `system/init` event. Returns nothing when no init event with a tool list
/// was seen, because an unknown inventory is not evidence of a gap.
pub fn unavailable_read_sources(
    events: impl IntoIterator<Item = Value>,
    enabled: &[GenerationReadSource],
) -> Vec<UnavailableReadSource> {
    if enabled.is_empty() {
        return Vec::new();
    }
    let Some(init) = events.into_iter().find(is_top_level_init) else {
        eprintln!("Generate read sources: Claude Code sent no init event; availability unknown.");
        return Vec::new();
    };
    let Some(tools) = init["tools"]
        .as_array()
        .filter(|tools| tools.iter().all(Value::is_string))
    else {
        eprintln!(
            "Generate read sources: Claude Code init has no tool list; availability unknown."
        );
        return Vec::new();
    };
    let loaded = |tool: &str| tools.iter().any(|name| name.as_str() == Some(tool));
    enabled
        .iter()
        .filter(|source| {
            !read_tools(**source)
                .iter()
                .all(|tool| loaded(&format!("{}{tool}", server(**source))))
        })
        .map(|source| UnavailableReadSource {
            source: *source,
            reason: reason(&init["mcp_servers"], server(*source)),
        })
        .collect()
}

fn is_top_level_init(event: &Value) -> bool {
    event["type"] == "system"
        && event["subtype"] == "init"
        && event.get("parent_tool_use_id").is_none_or(Value::is_null)
}

/// Claude Code names a server's tools `mcp__<name>__<tool>`, with every
/// character outside `[A-Za-z0-9_-]` in the name replaced by `_`.
fn reason(servers: &Value, tool_prefix: &str) -> ReadSourceUnavailableReason {
    let status = servers.as_array().and_then(|servers| {
        servers.iter().find_map(|entry| {
            let name: String = entry["name"]
                .as_str()?
                .chars()
                .map(|c| {
                    if c.is_ascii_alphanumeric() || c == '-' {
                        c
                    } else {
                        '_'
                    }
                })
                .collect();
            (format!("mcp__{name}__") == tool_prefix).then(|| entry["status"].as_str())
        })
    });
    match status {
        None => ReadSourceUnavailableReason::ConnectorMissing,
        Some(Some("needs-auth")) => ReadSourceUnavailableReason::NeedsSignIn,
        Some(Some("connected")) => ReadSourceUnavailableReason::ToolsMissing,
        Some(Some("disabled")) => ReadSourceUnavailableReason::ConnectorMissing,
        Some(_) => ReadSourceUnavailableReason::NotConnected,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use GenerationReadSource::{Confluence, Jira, TeamsChannels, TeamsChats};
    use ReadSourceUnavailableReason::*;
    use serde_json::json;

    const ATLASSIAN: &str = "claude.ai Atlassian MCP";
    const MICROSOFT_365: &str = "claude.ai Microsoft 365";

    fn tools(source: GenerationReadSource) -> Vec<String> {
        read_tools(source)
            .iter()
            .map(|tool| format!("{}{tool}", server(source)))
            .collect()
    }

    /// A sanitized Claude Code 2.1.330 init event.
    fn init(tools: Vec<String>, servers: &[(&str, &str)]) -> Value {
        json!({
            "type": "system",
            "subtype": "init",
            "model": "claude-haiku-4-5-20251001",
            "parent_tool_use_id": null,
            "tools": tools,
            "mcp_servers": servers
                .iter()
                .map(|(name, status)| json!({"name": name, "status": status, "source": "claudeai"}))
                .collect::<Vec<_>>(),
        })
    }

    fn check(event: Value, enabled: &[GenerationReadSource]) -> Vec<UnavailableReadSource> {
        unavailable_read_sources([json!({"type": "other"}), event], enabled)
    }

    fn gap(
        source: GenerationReadSource,
        reason: ReadSourceUnavailableReason,
    ) -> UnavailableReadSource {
        UnavailableReadSource { source, reason }
    }

    #[test]
    fn connected_connectors_with_all_tools_are_available() {
        let mut loaded = tools(Jira);
        loaded.extend(tools(Confluence));
        loaded.extend(tools(TeamsChannels));
        loaded.extend(tools(TeamsChats));
        loaded.push("mcp__claude_ai_Atlassian_MCP__discover".into());
        let event = init(
            loaded,
            &[(ATLASSIAN, "connected"), (MICROSOFT_365, "connected")],
        );
        assert!(check(event, &[Jira, Confluence, TeamsChannels, TeamsChats]).is_empty());
    }

    #[test]
    fn connectors_turned_off_report_every_enabled_source_missing() {
        let event = init(Vec::new(), &[("exa", "connected")]);
        assert_eq!(
            check(event, &[Jira, TeamsChats]),
            [
                gap(Jira, ConnectorMissing),
                gap(TeamsChats, ConnectorMissing)
            ]
        );
    }

    #[test]
    fn server_status_names_the_cause() {
        let event = init(
            Vec::new(),
            &[(ATLASSIAN, "needs-auth"), (MICROSOFT_365, "pending")],
        );
        assert_eq!(
            check(event, &[Confluence, TeamsChannels]),
            [
                gap(Confluence, NeedsSignIn),
                gap(TeamsChannels, NotConnected)
            ]
        );
        let event = init(Vec::new(), &[(ATLASSIAN, "disabled")]);
        assert_eq!(check(event, &[Jira]), [gap(Jira, ConnectorMissing)]);
    }

    #[test]
    fn a_partial_tool_set_is_reported_and_only_for_that_source() {
        let mut loaded = tools(Jira);
        loaded.retain(|tool| !tool.ends_with("getJiraIssue"));
        loaded.extend(tools(TeamsChannels));
        let event = init(
            loaded,
            &[(ATLASSIAN, "connected"), (MICROSOFT_365, "connected")],
        );
        assert_eq!(
            check(event, &[Jira, TeamsChannels]),
            [gap(Jira, ToolsMissing)]
        );
    }

    #[test]
    fn the_shared_atlassian_lookup_does_not_make_confluence_available() {
        let event = init(tools(Jira), &[(ATLASSIAN, "connected")]);
        assert_eq!(check(event, &[Confluence]), [gap(Confluence, ToolsMissing)]);
    }

    #[test]
    fn an_unknown_inventory_reports_nothing() {
        assert!(unavailable_read_sources([json!({"type": "result"})], &[Jira]).is_empty());
        let mut event = init(Vec::new(), &[]);
        event.as_object_mut().unwrap().remove("tools");
        assert!(check(event.clone(), &[Jira]).is_empty());
        event["tools"] = json!([null]);
        assert!(check(event, &[Jira]).is_empty());
    }

    #[test]
    fn only_the_top_level_init_counts() {
        let mut subagent = init(Vec::new(), &[]);
        subagent["parent_tool_use_id"] = json!("toolu_1");
        let top = init(tools(Jira), &[(ATLASSIAN, "connected")]);
        assert!(unavailable_read_sources([subagent, top], &[Jira]).is_empty());
    }

    #[test]
    fn no_enabled_sources_means_no_check() {
        assert!(check(init(Vec::new(), &[]), &[]).is_empty());
    }
}
