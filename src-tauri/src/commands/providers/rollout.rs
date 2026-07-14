use super::ProviderCatalogRollout;

pub(super) const PROVIDER_CATALOG_ROLLOUT_ENV: &str = "QA_SCRIBE_PROVIDER_CATALOG_MODE";

pub(super) fn provider_catalog_rollout() -> ProviderCatalogRollout {
    rollout_from_value(std::env::var(PROVIDER_CATALOG_ROLLOUT_ENV).ok().as_deref())
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
}
