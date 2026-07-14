use qa_scribe_core::domain::AiProvider;

use super::{
    apply_claude_declarative_allowlist, catalog_error, claude_auth_scope_warnings,
    claude_static_models, compatibility_models, copilot_auto_model, copilot_base_models,
    copilot_models, fallback_warning, normalize_models, parse_claude_model_help,
    parse_claude_structured_models, parse_codex_app_server_models, parse_codex_models,
    parse_copilot_config_help, parse_copilot_structured_models, provider_default_model,
    sanitize_catalog_error,
};
use crate::commands::providers::{
    ProbeRunner, ProviderCatalogRollout, ProviderCatalogSource, ProviderDiscoveryErrorCode,
    ProviderModelCatalogSnapshot,
    probe::{CodexDefaultsProbe, DetectionMode, StructuredCatalogProbe},
    rollout::provider_catalog_rollout,
};

pub(in crate::commands::providers) fn provider_catalog(
    provider: AiProvider,
    runner: &dyn ProbeRunner,
    mode: DetectionMode,
    cli_version: Option<String>,
) -> ProviderModelCatalogSnapshot {
    if mode == DetectionMode::Fast {
        let models = match provider {
            AiProvider::ClaudeCode => claude_static_models(),
            AiProvider::CodexCli => super::codex_static_models(),
            AiProvider::CopilotCli => copilot_models(),
        };
        return ProviderModelCatalogSnapshot::idle(models, ProviderCatalogSource::Preset);
    }

    if provider != AiProvider::CodexCli
        && provider_catalog_rollout() == ProviderCatalogRollout::Disabled
    {
        return ProviderModelCatalogSnapshot::disabled(compatibility_models(provider));
    }

    match provider {
        AiProvider::ClaudeCode => claude_catalog(runner, cli_version),
        AiProvider::CodexCli => codex_catalog(runner, cli_version),
        AiProvider::CopilotCli => copilot_catalog(runner, cli_version),
    }
}

fn codex_catalog(
    runner: &dyn ProbeRunner,
    cli_version: Option<String>,
) -> ProviderModelCatalogSnapshot {
    let structured_error = match runner.codex_app_server_defaults() {
        CodexDefaultsProbe::Success(defaults) => {
            let mut models = vec![provider_default_model()];
            models.extend(parse_codex_app_server_models(&defaults.models));
            let models = normalize_models(models);
            if models.len() > 1 {
                return ProviderModelCatalogSnapshot::fresh(
                    ProviderCatalogSource::CliCatalog,
                    models,
                    cli_version,
                    Vec::new(),
                );
            }
            Some(catalog_error(
                ProviderDiscoveryErrorCode::InvalidResponse,
                "Codex returned an empty account model catalog.",
            ))
        }
        CodexDefaultsProbe::Failed(error) => Some(sanitize_catalog_error(error)),
        CodexDefaultsProbe::NotAttempted => None,
    };

    let catalog = runner.run("codex", &["debug", "models"]);
    if catalog.success {
        let detected = parse_codex_models(&catalog.stdout);
        if !detected.is_empty() {
            let mut models = vec![provider_default_model()];
            models.extend(detected);
            let models = normalize_models(models);
            if let Some(error) = structured_error {
                return ProviderModelCatalogSnapshot::failed(
                    ProviderCatalogSource::CliHelp,
                    models,
                    cli_version,
                    error,
                    vec![fallback_warning("Codex account catalog")],
                );
            }
            return ProviderModelCatalogSnapshot::fresh(
                ProviderCatalogSource::CliHelp,
                models,
                cli_version,
                Vec::new(),
            );
        }
    }

    let error = structured_error.unwrap_or_else(|| {
        catalog_error(
            ProviderDiscoveryErrorCode::InvalidResponse,
            "Codex model discovery did not return a usable catalog.",
        )
    });
    ProviderModelCatalogSnapshot::failed(
        ProviderCatalogSource::Preset,
        super::codex_static_models(),
        cli_version,
        error,
        vec![fallback_warning("Codex model discovery")],
    )
}

fn claude_catalog(
    runner: &dyn ProbeRunner,
    cli_version: Option<String>,
) -> ProviderModelCatalogSnapshot {
    let structured_error = match runner.claude_structured_catalog() {
        StructuredCatalogProbe::Success(catalog) => {
            let models =
                apply_claude_declarative_allowlist(parse_claude_structured_models(&catalog.models));
            if !models.is_empty() {
                return ProviderModelCatalogSnapshot::fresh(
                    ProviderCatalogSource::CliCatalog,
                    normalize_models(models),
                    cli_version.or(catalog.cli_version),
                    claude_auth_scope_warnings(),
                );
            }
            Some(catalog_error(
                ProviderDiscoveryErrorCode::InvalidResponse,
                "Claude Code returned an empty account model catalog.",
            ))
        }
        StructuredCatalogProbe::Failed(error) => Some(sanitize_catalog_error(error)),
        StructuredCatalogProbe::NotAttempted => None,
    };

    let help = runner.run("claude", &["--help"]);
    if help.success {
        let detected = parse_claude_model_help(&help.stdout);
        if !detected.is_empty() {
            let mut models = vec![provider_default_model()];
            models.extend(detected);
            let mut warnings = claude_auth_scope_warnings();
            if let Some(error) = structured_error {
                warnings.push(fallback_warning("Claude Code account catalog"));
                return ProviderModelCatalogSnapshot::failed(
                    ProviderCatalogSource::CliHelp,
                    normalize_models(models),
                    cli_version,
                    error,
                    warnings,
                );
            }
            return ProviderModelCatalogSnapshot::fresh(
                ProviderCatalogSource::CliHelp,
                normalize_models(models),
                cli_version,
                warnings,
            );
        }
    }

    ProviderModelCatalogSnapshot::failed(
        ProviderCatalogSource::Preset,
        claude_static_models(),
        cli_version,
        structured_error.unwrap_or_else(|| {
            catalog_error(
                ProviderDiscoveryErrorCode::InvalidResponse,
                "Claude Code model discovery did not return a usable catalog.",
            )
        }),
        vec![fallback_warning("Claude Code model discovery")],
    )
}

fn copilot_catalog(
    runner: &dyn ProbeRunner,
    cli_version: Option<String>,
) -> ProviderModelCatalogSnapshot {
    let structured_error = match runner.copilot_structured_catalog() {
        StructuredCatalogProbe::Success(catalog) => {
            let parsed = parse_copilot_structured_models(&catalog.models);
            let mut models = vec![provider_default_model()];
            if !parsed
                .iter()
                .any(|model| model.id.eq_ignore_ascii_case("auto"))
            {
                models.push(copilot_auto_model());
            }
            models.extend(parsed);
            let models = normalize_models(models);
            if models.len() > 2 {
                return ProviderModelCatalogSnapshot::fresh(
                    ProviderCatalogSource::CliCatalog,
                    models,
                    catalog.cli_version.or(cli_version),
                    Vec::new(),
                );
            }
            Some(catalog_error(
                ProviderDiscoveryErrorCode::InvalidResponse,
                "GitHub Copilot returned an empty account model catalog.",
            ))
        }
        StructuredCatalogProbe::Failed(error) => Some(sanitize_catalog_error(error)),
        StructuredCatalogProbe::NotAttempted => None,
    };

    let help = runner.run("copilot", &["--help"]);
    if help.success {
        let detected = parse_copilot_config_help(&help.stdout);
        if !detected.is_empty() {
            let mut models = copilot_base_models();
            models.extend(detected);
            let models = normalize_models(models);
            if let Some(error) = structured_error {
                return ProviderModelCatalogSnapshot::failed(
                    ProviderCatalogSource::CliHelp,
                    models,
                    cli_version,
                    error,
                    vec![fallback_warning("GitHub Copilot account catalog")],
                );
            }
            return ProviderModelCatalogSnapshot::fresh(
                ProviderCatalogSource::CliHelp,
                models,
                cli_version,
                Vec::new(),
            );
        }
    }

    ProviderModelCatalogSnapshot::failed(
        ProviderCatalogSource::Preset,
        copilot_models(),
        cli_version,
        structured_error.unwrap_or_else(|| {
            catalog_error(
                ProviderDiscoveryErrorCode::InvalidResponse,
                "GitHub Copilot model discovery did not return a usable catalog.",
            )
        }),
        vec![fallback_warning("GitHub Copilot model discovery")],
    )
}
