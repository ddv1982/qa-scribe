use serde_json::{Value, json};

use super::{INITIALIZE_REQUEST_ID, MAX_MODELS, parse_fixture};
use crate::commands::providers::{
    ProviderDefaultSnapshot, ProviderDescriptor, ProviderModelCatalogSnapshot, ProviderState,
    models::provider_catalog,
    probe::{CommandProbe, DetectionMode, ProbeRunner, StructuredCatalog, StructuredCatalogProbe},
};

struct NormalizedCatalogRunner(Vec<Value>);

impl ProbeRunner for NormalizedCatalogRunner {
    fn executable_path(&self, _program: &str) -> Option<std::path::PathBuf> {
        None
    }

    fn run(&self, _program: &str, _args: &[&str]) -> CommandProbe {
        CommandProbe::not_found()
    }

    fn claude_structured_catalog(&self) -> StructuredCatalogProbe {
        StructuredCatalogProbe::Success(StructuredCatalog {
            models: self.0.clone(),
            cli_version: None,
        })
    }
}

fn image_admission_from_frame(
    rows: Value,
    default: Option<&str>,
    selection: &str,
) -> Result<(), String> {
    let frame = json!({
        "type":"control_response",
        "response":{"request_id":INITIALIZE_REQUEST_ID,"subtype":"success",
            "response":{"models":rows}}
    });
    let normalized = parse_fixture(&frame.to_string(), MAX_MODELS).unwrap();
    let catalog = provider_catalog(
        qa_scribe_core::domain::AiProvider::ClaudeCode,
        &NormalizedCatalogRunner(normalized.models),
        DetectionMode::Deep,
        None,
    );
    descriptor_from_catalog(catalog, default).validate_image_model(selection)
}

fn descriptor_from_catalog(
    catalog: ProviderModelCatalogSnapshot,
    default: Option<&str>,
) -> ProviderDescriptor {
    let mut defaults = ProviderDefaultSnapshot::unchecked();
    defaults.model.value = default.map(str::to_string);
    ProviderDescriptor {
        id: "claude_code".into(),
        label: "Claude Code",
        status: ProviderState::Ready,
        available: true,
        reason: "fixture".into(),
        command: None,
        models: catalog.models.clone(),
        catalog_snapshot: catalog,
        default_snapshot: defaults,
        local_only: true,
    }
}

#[test]
fn image_admission_preserves_evidence_through_normalization_and_catalog_parsing() {
    let unsupported = Err("The selected model does not support images. Choose a model with image support; your composer is retained.".into());
    let unknown = Err("Image support for the selected model is unknown. Choose a model with confirmed image support; your composer is retained.".into());
    let cases = [
        (
            json!([{"value":"sonnet","displayName":"Sonnet","supportsEffort":true,"supportedEffortLevels":["low","high"]}]),
            None,
            "sonnet",
            Ok(()),
        ),
        (
            json!([{"value":"sonnet","resolvedModel":"claude-sonnet-4-6"}]),
            Some("claude-sonnet-4-6"),
            "default",
            Ok(()),
        ),
        (
            json!([{"value":"default","resolvedModel":"claude-sonnet-4-6"}]),
            Some("claude-sonnet-4-6"),
            "default",
            Ok(()),
        ),
        (
            json!([{"value":"sonnet","resolvedModel":"claude-sonnet-4-6"}]),
            None,
            "claude-sonnet-4-6",
            Ok(()),
        ),
        (
            json!([{"value":"custom","vision":true}]),
            None,
            "custom",
            Ok(()),
        ),
        (
            json!([{"value":"custom","supportsVision":true}]),
            None,
            "custom",
            Ok(()),
        ),
        (
            json!([{"value":"custom","capabilities":{"image_input":{"supported":true}}}]),
            None,
            "custom",
            Ok(()),
        ),
        (
            json!([{"value":"custom","inputModalities":["text","image"]}]),
            None,
            "custom",
            Ok(()),
        ),
        (
            json!([{"value":"sonnet","vision":false}]),
            None,
            "sonnet",
            unsupported.clone(),
        ),
        (
            json!([{"value":"sonnet","supportsVision":false}]),
            None,
            "sonnet",
            unsupported.clone(),
        ),
        (
            json!([{"value":"sonnet","capabilities":{"image_input":{"supported":false}}}]),
            None,
            "sonnet",
            unsupported.clone(),
        ),
        (
            json!([{"value":"sonnet","vision":true,"inputModalities":["text"]}]),
            None,
            "sonnet",
            unsupported.clone(),
        ),
        (
            json!([{"value":"sonnet","vision":true,"supportsVision":false}]),
            None,
            "sonnet",
            unsupported.clone(),
        ),
        (
            json!([{"value":"sonnet","vision":true,"capabilities":{"image_input":{"supported":false}}}]),
            None,
            "sonnet",
            unsupported.clone(),
        ),
        (
            json!([{"value":"custom","vision":false}]),
            None,
            "custom",
            unsupported.clone(),
        ),
        (
            json!([{"value":"custom","vision":"true","inputModalities":["image",42]}]),
            None,
            "custom",
            unknown.clone(),
        ),
        (json!([{"value":"custom"}]), None, "custom", unknown.clone()),
        (
            json!([{"value":"default"}]),
            None,
            "default",
            unknown.clone(),
        ),
        (
            json!([{"value":"sonnet","resolvedModel":"custom"}]),
            None,
            "sonnet",
            unknown.clone(),
        ),
        (
            json!([{"value":"default","resolvedModel":"custom"}]),
            Some("custom"),
            "default",
            unknown.clone(),
        ),
        (
            json!([{"value":"sonnet","resolvedModel":"claude-sonnet-4-6","vision":false}]),
            Some("claude-sonnet-4-6"),
            "default",
            unsupported.clone(),
        ),
        (
            json!([{"value":"sonnet","resolvedModel":"claude-sonnet-4-6","vision":true},{"value":"claude-sonnet-4-6","vision":false}]),
            None,
            "claude-sonnet-4-6",
            unsupported.clone(),
        ),
        (
            json!([{"value":"claude-sonnet-4-6","vision":false},{"value":"sonnet","resolvedModel":"claude-sonnet-4-6","vision":true}]),
            Some("claude-sonnet-4-6"),
            "default",
            unsupported,
        ),
        (
            json!([{"value":"sonnet","resolvedModel":"claude-sonnet-4-6","vision":true},{"value":"claude-sonnet-4-6","resolvedModel":"custom"}]),
            None,
            "claude-sonnet-4-6",
            unknown,
        ),
        (
            json!([{"value":"sonnet","resolvedModel":"claude-sonnet-4-6","vision":false},{"value":"claude-sonnet-4-6","vision":true}]),
            None,
            "claude-sonnet-4-6",
            Ok(()),
        ),
    ];
    for (rows, default, selection, expected) in cases {
        assert_eq!(
            image_admission_from_frame(rows.clone(), default, selection),
            expected,
            "rows={rows}, default={default:?}, selection={selection}"
        );
    }
}

struct HelpCatalogRunner;

impl ProbeRunner for HelpCatalogRunner {
    fn executable_path(&self, _program: &str) -> Option<std::path::PathBuf> {
        None
    }

    fn run(&self, _program: &str, _args: &[&str]) -> CommandProbe {
        CommandProbe {
            success: true,
            stdout: "--model choose 'sonnet', 'claude-opus-4-8', 'custom-text' or 'default'".into(),
            stderr: String::new(),
            not_found: false,
            scope_error: None,
        }
    }
}

#[test]
fn image_admission_uses_known_identity_evidence_in_static_and_help_catalogs() {
    use crate::commands::providers::ProviderCatalogSource;
    use qa_scribe_core::domain::AiProvider;
    for (mode, source) in [
        (DetectionMode::Fast, ProviderCatalogSource::Preset),
        (DetectionMode::Deep, ProviderCatalogSource::CliHelp),
    ] {
        let catalog = provider_catalog(AiProvider::ClaudeCode, &HelpCatalogRunner, mode, None);
        assert_eq!(catalog.source, source);
        let mut descriptor = descriptor_from_catalog(catalog, None);
        for selection in ["sonnet", "claude-opus-4-8"] {
            assert_eq!(descriptor.validate_image_model(selection), Ok(()));
        }
        assert_eq!(descriptor.models[0].id, "default");
        assert_eq!(descriptor.models[0].capabilities.vision, None);
        assert_eq!(descriptor.default_snapshot.model.value, None);
        let unknown = Err("Image support for the selected model is unknown. Choose a model with confirmed image support; your composer is retained.".into());
        assert_eq!(descriptor.validate_image_model("default"), unknown);
        assert_eq!(descriptor.validate_image_model("custom-text"), unknown);
        descriptor.default_snapshot.model.value = Some("sonnet".into());
        for selection in ["default", " default ", "auto", "", " "] {
            assert_eq!(descriptor.validate_image_model(selection), Ok(()));
        }
        descriptor.default_snapshot.model.value = Some("custom-text".into());
        assert_eq!(descriptor.validate_image_model("default"), unknown);
    }
}
