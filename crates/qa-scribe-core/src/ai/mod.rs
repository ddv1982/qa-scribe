use serde::{Deserialize, Serialize};

use crate::domain::AiProvider;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapability {
    pub id: AiProvider,
    pub label: &'static str,
    pub executable: &'static str,
    pub version_args: Vec<&'static str>,
}

pub fn provider_capabilities() -> Vec<ProviderCapability> {
    vec![
        ProviderCapability {
            id: AiProvider::ClaudeCode,
            label: "Claude Code",
            executable: "claude",
            version_args: vec!["--version"],
        },
        ProviderCapability {
            id: AiProvider::CodexCli,
            label: "Codex CLI",
            executable: "codex",
            version_args: vec!["--version"],
        },
        ProviderCapability {
            id: AiProvider::CopilotCli,
            label: "GitHub Copilot CLI",
            executable: "gh",
            version_args: vec!["copilot", "--help"],
        },
    ]
}

pub fn generation_command(provider: AiProvider, prompt: &str) -> (&'static str, Vec<String>) {
    match provider {
        AiProvider::ClaudeCode => ("claude", vec!["-p".to_string(), prompt.to_string()]),
        AiProvider::CodexCli => (
            "codex",
            vec![
                "exec".to_string(),
                "--skip-git-repo-check".to_string(),
                prompt.to_string(),
            ],
        ),
        AiProvider::CopilotCli => (
            "gh",
            vec![
                "copilot".to_string(),
                "explain".to_string(),
                prompt.to_string(),
            ],
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_capabilities_cover_supported_providers() {
        let capabilities = provider_capabilities();
        assert_eq!(capabilities.len(), 3);
        assert!(
            capabilities
                .iter()
                .any(|capability| capability.id == AiProvider::CodexCli)
        );
    }
}
