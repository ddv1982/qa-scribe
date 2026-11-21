use qa_scribe_core::domain::AiProvider;

use super::ProviderCatalogRollout;

pub(super) const PROVIDER_CATALOG_ROLLOUT_ENV: &str = "QA_SCRIBE_PROVIDER_CATALOG_MODE";

pub(super) fn provider_catalog_rollout() -> ProviderCatalogRollout {
    rollout_from_value(std::env::var(PROVIDER_CATALOG_ROLLOUT_ENV).ok().as_deref())
}

/// Whether the picker shows the CLI's own model list for this provider.
/// Codex always does. Claude does unless the catalog is switched off.
/// Copilot only does in selector mode.
pub(super) fn catalog_selector_enabled(
    provider: AiProvider,
    rollout: ProviderCatalogRollout,
) -> bool {
    match provider {
        AiProvider::CodexCli => true,
        AiProvider::ClaudeCode => rollout != ProviderCatalogRollout::Disabled,
        AiProvider::CopilotCli => rollout == ProviderCatalogRollout::Selector,
    }
}

fn rollout_from_value(value: Option<&str>) -> ProviderCatalogRollout {
    match value
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "off" | "disabled" => ProviderCatalogRollout::Disabled,
        "selector" | "enabled" | "on" => ProviderCatalogRollout::Selector,
        _ => ProviderCatalogRollout::Diagnostics,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rollout_defaults_to_diagnostics_and_accepts_kill_switches() {
        assert_eq!(
            rollout_from_value(None),
            ProviderCatalogRollout::Diagnostics
        );
        assert_eq!(
            rollout_from_value(Some("off")),
            ProviderCatalogRollout::Disabled
        );
        assert_eq!(
            rollout_from_value(Some("selector")),
            ProviderCatalogRollout::Selector
        );
        assert_eq!(
            rollout_from_value(Some("unexpected")),
            ProviderCatalogRollout::Diagnostics
        );
    }

    #[test]
    fn claude_uses_its_catalog_unless_switched_off() {
        use ProviderCatalogRollout::{Diagnostics, Disabled, Selector};
        for (provider, expected) in [
            (AiProvider::CodexCli, [true, true, true]),
            (AiProvider::ClaudeCode, [false, true, true]),
            (AiProvider::CopilotCli, [false, false, true]),
        ] {
            let actual = [Disabled, Diagnostics, Selector]
                .map(|rollout| catalog_selector_enabled(provider, rollout));
            assert_eq!(actual, expected, "{provider:?}");
        }
    }
}
