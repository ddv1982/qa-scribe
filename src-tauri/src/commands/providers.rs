use std::process::Command;

use qa_scribe_core::ai::provider_capabilities;
use serde::Serialize;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub providers: Vec<ProviderDescriptor>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptor {
    pub id: String,
    pub label: &'static str,
    pub available: bool,
    pub reason: String,
    pub local_only: bool,
}

#[tauri::command]
pub fn get_provider_status() -> ProviderStatus {
    ProviderStatus {
        providers: provider_capabilities()
            .into_iter()
            .map(|capability| {
                let available = Command::new(capability.executable)
                    .args(&capability.version_args)
                    .output()
                    .map(|output| output.status.success())
                    .unwrap_or(false);
                ProviderDescriptor {
                    id: capability.id.as_str().to_string(),
                    label: capability.label,
                    available,
                    reason: if available {
                        format!("{} is available locally.", capability.executable)
                    } else {
                        format!(
                            "{} was not found or did not run successfully.",
                            capability.executable
                        )
                    },
                    local_only: true,
                }
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::get_provider_status;

    #[test]
    fn provider_status_is_local_and_reports_all_providers() {
        let status = get_provider_status();

        assert_eq!(status.providers.len(), 3);
        assert!(status.providers.iter().all(|provider| provider.local_only));
    }
}
