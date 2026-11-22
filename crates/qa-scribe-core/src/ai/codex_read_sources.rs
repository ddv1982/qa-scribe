//! Jira and Confluence lookups for Codex Generate runs. Codex cannot use the
//! Claude Code connectors, so QA Scribe adds Atlassian's remote MCP server to
//! each run with `-c` overrides; the user's Codex config is never written.
//!
//! Three layers keep the lookups read-only:
//! 1. Sign-in asks Atlassian only for read and search scopes, so the token
//!    cannot write even if a write tool were called.
//! 2. `enabled_tools` exposes exactly the source's read tools; Codex checks
//!    it both when listing tools and when dispatching a call.
//! 3. After the run, any MCP call outside that list fails the run.

use serde::Deserialize;
use serde_json::Value;

use super::generation_tools::read_tools;
use super::read_source_availability::{ReadSourceUnavailableReason, UnavailableReadSource};
use crate::domain::GenerationReadSource;

/// Codex stores the OAuth token under this server name and URL, so neither
/// may change without asking every user to sign in again.
pub const CODEX_ATLASSIAN_SERVER: &str = "qa_scribe_atlassian";
/// `tools=all` lists every tool individually instead of behind Atlassian's
/// generic `discover`/`execute*` tools, which could run write operations.
const CODEX_ATLASSIAN_URL: &str = "https://mcp.atlassian.com/v2/mcp?tools=all";
const CODEX_ATLASSIAN_SCOPES: &[&str] = &[
    "read:me",
    "offline_access",
    "read:jira:agent-interface",
    "search:jira:agent-interface",
    "read:confluence:agent-interface",
    "search:confluence:agent-interface",
];
/// How `codex mcp list --json` reports a stored OAuth token: Codex 0.171
/// serializes `McpAuthStatus::OAuth` in snake case. `oauth` covers a future
/// rename. Mistaking a signed-out server for signed in only costs the
/// warning; without a token the server can read nothing.
const SIGNED_IN_AUTH_STATUSES: &[&str] = &["o_auth", "oauth"];

/// Whether a source can be looked up through the Codex Atlassian server.
pub fn codex_supports_read_source(source: GenerationReadSource) -> bool {
    matches!(
        source,
        GenerationReadSource::Jira | GenerationReadSource::Confluence
    )
}

/// `-c` overrides that define the server. Login, logout, list and runs all
/// use these, so they always address the same stored token.
pub fn codex_atlassian_config_args() -> Vec<String> {
    let scopes = CODEX_ATLASSIAN_SCOPES
        .iter()
        .map(|scope| format!("{scope:?}"))
        .collect::<Vec<_>>()
        .join(",");
    vec![
        "-c".to_owned(),
        format!("mcp_servers.{CODEX_ATLASSIAN_SERVER}.url={CODEX_ATLASSIAN_URL:?}"),
        "-c".to_owned(),
        format!("mcp_servers.{CODEX_ATLASSIAN_SERVER}.scopes=[{scopes}]"),
    ]
}

/// The read tools the enabled sources allow, deduplicated, in source order.
pub fn codex_atlassian_tools(sources: &[GenerationReadSource]) -> Vec<&'static str> {
    let mut tools: Vec<&'static str> = Vec::new();
    for source in sources
        .iter()
        .filter(|source| codex_supports_read_source(**source))
    {
        for tool in read_tools(*source) {
            if !tools.contains(tool) {
                tools.push(tool);
            }
        }
    }
    tools
}

/// Run arguments that turn the server on with only `tools` callable.
///
/// `codex exec` cannot ask, so it refuses any MCP call that needs approval,
/// and its default mode needs approval for every tool the server does not
/// mark read-only. Each allowlisted read tool is approved explicitly; the
/// read-only token and the allowlist still bound what it can do.
pub(super) fn codex_atlassian_run_args(tools: &[&str]) -> Vec<String> {
    let mut args = codex_atlassian_config_args();
    let allowlist = tools
        .iter()
        .map(|tool| format!("{tool:?}"))
        .collect::<Vec<_>>()
        .join(",");
    args.extend([
        "-c".to_owned(),
        format!("mcp_servers.{CODEX_ATLASSIAN_SERVER}.enabled=true"),
        "-c".to_owned(),
        format!("mcp_servers.{CODEX_ATLASSIAN_SERVER}.enabled_tools=[{allowlist}]"),
    ]);
    for tool in tools {
        args.extend([
            "-c".to_owned(),
            format!("mcp_servers.{CODEX_ATLASSIAN_SERVER}.tools.{tool}.approval_mode=\"approve\""),
        ]);
    }
    args
}

/// Turns the reserved server name off for a run that does not use it.
pub(super) fn codex_atlassian_disabled_args() -> Vec<String> {
    vec![
        "-c".to_owned(),
        format!("mcp_servers.{CODEX_ATLASSIAN_SERVER}.enabled=false"),
    ]
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum CodexAtlassianStatus {
    SignedIn,
    SignedOut,
}

/// What Generate needs from `codex mcp list --json`: the user's servers to
/// turn off, and whether QA Scribe's Atlassian server is signed in (`None`
/// when the list was taken without its overrides).
#[derive(Debug, Eq, PartialEq)]
pub struct CodexMcpInventory {
    pub servers_to_disable: Vec<String>,
    pub atlassian: Option<CodexAtlassianStatus>,
}

#[derive(Deserialize)]
struct ListedServer {
    name: String,
    enabled: bool,
    #[serde(default)]
    transport: Value,
    #[serde(default)]
    auth_status: Option<String>,
}

/// Reads `codex mcp list --json`. A server name that cannot be written as a
/// bare `-c` key is refused, so a server is never left on silently. A user
/// server that shares QA Scribe's Atlassian name is refused too: Codex merges
/// config tables, so its headers or token settings would leak into the run.
///
/// `with_atlassian` says the list ran with QA Scribe's overrides. Without
/// them, a server with the reserved name is the user's own and is turned off
/// like any other.
pub fn codex_mcp_inventory(
    list_json: &str,
    with_atlassian: bool,
) -> Result<CodexMcpInventory, String> {
    let servers: Vec<ListedServer> = serde_json::from_str(list_json)
        .map_err(|error| format!("Could not read the Codex MCP server list: {error}"))?;
    let mut inventory = CodexMcpInventory {
        servers_to_disable: Vec::new(),
        atlassian: None,
    };
    for server in servers {
        if with_atlassian && server.name == CODEX_ATLASSIAN_SERVER {
            inventory.atlassian = Some(atlassian_status(&server)?);
            continue;
        }
        if !server.enabled {
            continue;
        }
        let bare = !server.name.is_empty()
            && server
                .name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'));
        if !bare {
            return Err(format!(
                "Codex MCP server \"{}\" cannot be turned off for this run. Rename it to letters, digits, '_' or '-', or turn it off in your Codex config.",
                server.name
            ));
        }
        inventory.servers_to_disable.push(server.name);
    }
    Ok(inventory)
}

fn atlassian_status(server: &ListedServer) -> Result<CodexAtlassianStatus, String> {
    let transport = &server.transport;
    let only_ours = transport["type"] == "streamable_http"
        && transport["url"] == CODEX_ATLASSIAN_URL
        && transport.as_object().is_some_and(|fields| {
            fields
                .iter()
                .all(|(key, value)| matches!(key.as_str(), "type" | "url") || value.is_null())
        });
    if !only_ours {
        return Err(format!(
            "Codex lists an MCP server named \"{CODEX_ATLASSIAN_SERVER}\" with settings QA Scribe did not add, so Jira and Confluence lookups are off. Rename or remove that server in your Codex config. If you have none, update QA Scribe: your Codex version may report new server settings."
        ));
    }
    Ok(
        if server
            .auth_status
            .as_deref()
            .is_some_and(|status| SIGNED_IN_AUTH_STATUSES.contains(&status))
        {
            CodexAtlassianStatus::SignedIn
        } else {
            CodexAtlassianStatus::SignedOut
        },
    )
}

/// The enabled Atlassian sources a run cannot look up because QA Scribe's
/// Codex server is not signed in.
pub fn codex_unavailable_read_sources(
    sources: &[GenerationReadSource],
    status: Option<CodexAtlassianStatus>,
) -> Vec<UnavailableReadSource> {
    if status == Some(CodexAtlassianStatus::SignedIn) {
        return Vec::new();
    }
    sources
        .iter()
        .filter(|source| codex_supports_read_source(**source))
        .map(|source| UnavailableReadSource {
            source: *source,
            reason: ReadSourceUnavailableReason::NeedsSignIn,
        })
        .collect()
}

/// The enabled sources whose lookup failed during a Codex run, such as an
/// expired token or a renamed tool, so the draft is not silently missing
/// context the note referred to.
pub fn codex_failed_lookups(
    events: impl IntoIterator<Item = Value>,
    sources: &[GenerationReadSource],
) -> Vec<UnavailableReadSource> {
    let mut failed: Vec<UnavailableReadSource> = Vec::new();
    for event in events {
        let item = &event["item"];
        if event["type"] != "item.completed"
            || item["type"] != "mcp_tool_call"
            || item["server"] != CODEX_ATLASSIAN_SERVER
            || item["status"] != "failed"
        {
            continue;
        }
        let tool = item["tool"].as_str().unwrap_or_default();
        for source in sources.iter().filter(|source| {
            codex_supports_read_source(**source) && read_tools(**source).contains(&tool)
        }) {
            let gap = UnavailableReadSource {
                source: *source,
                reason: ReadSourceUnavailableReason::NotConnected,
            };
            if !failed.contains(&gap) {
                failed.push(gap);
            }
        }
    }
    failed
}

/// Codex's built-in MCP resource operations. They reach only servers that
/// are on for the run, and Codex reports them as MCP calls on `codex` (all
/// servers) or on the server named in the call.
const CODEX_RESOURCE_TOOLS: &[&str] = &[
    "list_mcp_resources",
    "list_mcp_resource_templates",
    "read_mcp_resource",
];

/// The first MCP tool call in a Codex run that was neither one of the
/// enabled sources' read tools nor a resource operation on a permitted
/// server, as `server/tool`. Codex should never make one; if a Codex release
/// stops honoring `enabled_tools`, this fails the run.
pub fn codex_disallowed_tool_call(
    events: impl IntoIterator<Item = Value>,
    sources: &[GenerationReadSource],
) -> Option<String> {
    let allowed = codex_atlassian_tools(sources);
    events.into_iter().find_map(|event| {
        let item = &event["item"];
        if item["type"] != "mcp_tool_call" {
            return None;
        }
        let server = item["server"].as_str().unwrap_or_default();
        let tool = item["tool"].as_str().unwrap_or_default();
        let ours = server == CODEX_ATLASSIAN_SERVER && !allowed.is_empty();
        let permitted = (ours && allowed.contains(&tool))
            || ((ours || server == "codex") && CODEX_RESOURCE_TOOLS.contains(&tool));
        (!permitted).then(|| format!("{server}/{tool}"))
    })
}

#[cfg(test)]
#[path = "codex_read_sources_tests.rs"]
mod tests;
