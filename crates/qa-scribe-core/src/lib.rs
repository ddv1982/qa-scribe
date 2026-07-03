pub mod ai;
pub mod attachments;
pub mod domain;
mod error;
pub mod generation;
pub mod services;
pub mod storage;

pub use error::{QaScribeError, Result};
use serde::{Deserialize, Serialize};

pub const APP_NAME: &str = "qa-scribe";
pub const STORAGE_MODE: &str = "fresh-rust-sqlite";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub name: String,
    pub storage_mode: String,
    pub migration_required: bool,
    pub implemented_features: Vec<String>,
}

pub fn app_status() -> AppStatus {
    AppStatus {
        name: APP_NAME.to_string(),
        storage_mode: STORAGE_MODE.to_string(),
        migration_required: false,
        implemented_features: vec![
            "workspace-skeleton".to_string(),
            "core-domain-storage".to_string(),
            "tauri-command-shell".to_string(),
            "frontend-rebuild".to_string(),
            "attachments".to_string(),
            "ai-generation".to_string(),
            "packaging-validation-docs".to_string(),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skeleton_status_declares_fresh_storage() {
        let status = app_status();

        assert_eq!(status.name, "qa-scribe");
        assert_eq!(status.storage_mode, "fresh-rust-sqlite");
        assert!(!status.migration_required);
        assert_eq!(
            status.implemented_features,
            vec![
                "workspace-skeleton",
                "core-domain-storage",
                "tauri-command-shell",
                "frontend-rebuild",
                "attachments",
                "ai-generation",
                "packaging-validation-docs"
            ]
        );
    }

    #[test]
    fn skeleton_status_uses_camel_case_json() {
        let json = serde_json::to_value(app_status()).expect("status should serialize");

        assert_eq!(json["storageMode"], "fresh-rust-sqlite");
        assert_eq!(json["migrationRequired"], false);
        assert_eq!(json["implementedFeatures"][6], "packaging-validation-docs");
    }
}
