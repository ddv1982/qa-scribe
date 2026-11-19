//! Scope of the chat "Approve all for this tool" decision: it covers later
//! requests for the same tool on the same server in this response, never a
//! different tool.
use std::sync::mpsc::Receiver;

use qa_scribe_core::ai::chat_protocol::ChatProtocolPermission;

use crate::jobs::ChatPermissionDecision;

/// Tool name and MCP server of a permission request.
pub(super) type ToolIdentity = (String, Option<String>);

pub(super) struct PendingPermission {
    pub(super) decision: Receiver<ChatPermissionDecision>,
    pub(super) tool: Option<ToolIdentity>,
}

/// Only a provider-supplied tool name identifies a tool. A title is display
/// text that different tools can share, so requests without a tool name are
/// never covered by "Approve all" and the UI offers only "Approve once".
pub(super) fn tool_identity(details: &ChatProtocolPermission) -> Option<ToolIdentity> {
    let tool = details.tool_name.as_deref()?.trim();
    (!tool.is_empty()).then(|| (tool.to_owned(), details.server_name.clone()))
}

pub(super) fn covered_by_approve_all(
    details: &ChatProtocolPermission,
    approved_tools: &[ToolIdentity],
) -> bool {
    details.can_approve && tool_identity(details).is_some_and(|tool| approved_tools.contains(&tool))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(tool: Option<&str>, server: Option<&str>) -> ChatProtocolPermission {
        ChatProtocolPermission {
            can_approve: true,
            title: String::new(),
            tool_name: tool.map(str::to_owned),
            server_name: server.map(str::to_owned),
            input_json: None,
        }
    }

    #[test]
    fn approve_all_covers_only_the_same_tool_on_the_same_server() {
        let read = request(Some("getJiraIssue"), Some("atlassian"));
        let approved = vec![tool_identity(&read).unwrap()];

        assert!(covered_by_approve_all(&read, &approved));
        assert!(!covered_by_approve_all(
            &request(Some("Bash"), None),
            &approved
        ));
        assert!(!covered_by_approve_all(
            &request(Some("createJiraIssue"), Some("atlassian")),
            &approved
        ));
        assert!(!covered_by_approve_all(
            &request(Some("getJiraIssue"), Some("other-server")),
            &approved
        ));
    }

    #[test]
    fn approve_all_never_covers_unnamed_or_unapprovable_requests() {
        let approved = vec![("Bash".to_string(), None)];
        assert!(!covered_by_approve_all(&request(None, None), &approved));
        let mut bash = request(Some("Bash"), None);
        bash.can_approve = false;
        assert!(!covered_by_approve_all(&bash, &approved));
        assert!(!covered_by_approve_all(&request(Some("Bash"), None), &[]));
    }

    #[test]
    fn approve_all_ignores_titles_and_compares_tool_names() {
        let titled = |tool: Option<&str>| ChatProtocolPermission {
            title: "Run tool".into(),
            ..request(tool, Some("jira"))
        };
        // A title alone is no identity, even when titles match.
        assert_eq!(tool_identity(&titled(None)), None);
        let approved = vec![tool_identity(&titled(Some("getJiraIssue"))).unwrap()];
        assert!(!covered_by_approve_all(&titled(None), &approved));
        assert!(!covered_by_approve_all(
            &titled(Some("createJiraIssue")),
            &approved
        ));
        assert!(covered_by_approve_all(
            &titled(Some("getJiraIssue")),
            &approved
        ));
    }
}
