//! Settings commands for the Atlassian sign-in Codex Generate runs use for
//! Jira and Confluence lookups. Codex keeps the token; QA Scribe only starts
//! `codex mcp login`/`logout` with the same `-c` overrides the runs use.

use std::time::Duration;

use qa_scribe_core::{
    ai::{
        codex_read_sources::{
            CODEX_ATLASSIAN_SERVER, CodexAtlassianStatus, codex_atlassian_config_args,
            codex_mcp_inventory,
        },
        generation_tools::codex_mcp_list_args,
    },
    domain::GenerationReadSource,
};

use super::probe::{CommandProbe, SystemProbeRunner};
use crate::provider_command::ProviderPathMode;

const LIST_TIMEOUT: Duration = Duration::from_secs(20);
/// Long enough to sign in and approve in the browser.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
const SIGN_OUT_TIMEOUT: Duration = Duration::from_secs(20);

#[tauri::command]
#[specta::specta]
pub async fn get_codex_atlassian_status() -> Result<CodexAtlassianStatus, String> {
    blocking(status).await
}

#[tauri::command]
#[specta::specta]
pub async fn sign_in_codex_atlassian() -> Result<CodexAtlassianStatus, String> {
    blocking(|| {
        run_server_command(
            "login",
            SIGN_IN_TIMEOUT,
            "Signing in to Atlassian for Codex",
        )?;
        status()
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn sign_out_codex_atlassian() -> Result<CodexAtlassianStatus, String> {
    blocking(|| {
        run_server_command(
            "logout",
            SIGN_OUT_TIMEOUT,
            "Signing out of Atlassian for Codex",
        )?;
        status()
    })
    .await
}

async fn blocking(
    work: impl FnOnce() -> Result<CodexAtlassianStatus, String> + Send + 'static,
) -> Result<CodexAtlassianStatus, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("Codex Atlassian sign-in worker failed: {error}"))?
}

fn status() -> Result<CodexAtlassianStatus, String> {
    let args = codex_mcp_list_args(&[GenerationReadSource::Jira]);
    let probe = run_codex(&args, LIST_TIMEOUT);
    if !probe.success {
        return Err(failure("Checking the Codex Atlassian sign-in", &probe));
    }
    codex_mcp_inventory(&probe.stdout)?
        .atlassian
        .ok_or_else(|| "Codex did not list QA Scribe's Atlassian server.".to_owned())
}

fn run_server_command(action: &str, timeout: Duration, label: &str) -> Result<(), String> {
    let mut args = codex_atlassian_config_args();
    args.extend(["mcp".into(), action.into(), CODEX_ATLASSIAN_SERVER.into()]);
    let probe = run_codex(&args, timeout);
    if probe.success {
        Ok(())
    } else {
        Err(failure(label, &probe))
    }
}

fn run_codex(args: &[String], timeout: Duration) -> CommandProbe {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    SystemProbeRunner::new(ProviderPathMode::Deep).run_with_timeout("codex", &args, timeout)
}

/// The last line Codex printed, without URLs: sign-in output carries the
/// OAuth authorization link.
fn failure(label: &str, probe: &CommandProbe) -> String {
    if probe.not_found {
        return format!("{label} failed: Codex CLI was not found.");
    }
    let detail = probe
        .stderr
        .lines()
        .chain(probe.stdout.lines())
        .map(str::trim)
        .rfind(|line| !line.is_empty() && !line.contains("://"))
        .unwrap_or("Codex stopped without saying why.");
    format!("{label} failed: {detail}")
}
