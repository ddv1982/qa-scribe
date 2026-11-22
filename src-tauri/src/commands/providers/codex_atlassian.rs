//! Settings commands for the Atlassian sign-in Codex Generate runs use for
//! Jira and Confluence lookups. Codex keeps the token; QA Scribe only starts
//! `codex mcp login`/`logout` with the same `-c` overrides the runs use.

use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use qa_scribe_core::ai::{
    codex_read_sources::{
        CODEX_ATLASSIAN_SERVER, CodexAtlassianStatus, codex_atlassian_config_args,
        codex_atlassian_status_from_list,
    },
    generation_tools::codex_mcp_list_args,
};

use super::probe::{CommandProbe, SystemProbeRunner};
use crate::provider_command::ProviderPathMode;

const LIST_TIMEOUT: Duration = Duration::from_secs(20);
/// Long enough to sign in and approve in the browser.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
const SIGN_OUT_TIMEOUT: Duration = Duration::from_secs(20);

const SIGN_IN_LABEL: &str = "Signing in to Atlassian for Codex";

static SIGN_IN_RUNNING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
#[specta::specta]
pub async fn get_codex_atlassian_status() -> Result<CodexAtlassianStatus, String> {
    blocking(status).await
}

#[tauri::command]
#[specta::specta]
pub async fn sign_in_codex_atlassian() -> Result<CodexAtlassianStatus, String> {
    blocking(|| {
        // One browser sign-in at a time: Settings can remount while a
        // `codex mcp login` is still waiting for the browser.
        if SIGN_IN_RUNNING.swap(true, Ordering::AcqRel) {
            return Err("A Codex sign-in is already waiting in your browser.".to_owned());
        }
        let result = run_server_command("login", SIGN_IN_TIMEOUT, SIGN_IN_LABEL);
        SIGN_IN_RUNNING.store(false, Ordering::Release);
        result?;
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
    let runner = SystemProbeRunner::new(ProviderPathMode::Deep);
    super::codex_reserved_name_free_with(&runner)?;
    let args = codex_mcp_list_args(true);
    let probe = run_codex(&args, LIST_TIMEOUT);
    if !probe.success {
        return Err(failure("Checking the Codex Atlassian sign-in", &probe));
    }
    codex_atlassian_status_from_list(&probe.stdout)
}

/// Runs `codex mcp <action>` for QA Scribe's server. The status check first
/// refuses a user server with the reserved name, whose headers or token
/// settings Codex would otherwise merge into the sign-in.
fn run_server_command(action: &str, timeout: Duration, label: &str) -> Result<(), String> {
    status()?;
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
    let last_line = |text: &str| {
        text.lines()
            .map(str::trim)
            .rfind(|line| !line.is_empty() && !line.contains("://"))
            .map(str::to_owned)
    };
    let detail = last_line(&probe.stderr)
        .or_else(|| last_line(&probe.stdout))
        .unwrap_or_else(|| "Codex stopped without saying why.".to_owned());
    if detail.contains("timed out") || detail.contains("deadline has elapsed") {
        return if label == SIGN_IN_LABEL {
            format!("{label} timed out. Finish the sign-in in your browser within 5 minutes.")
        } else {
            format!("{label} timed out.")
        };
    }
    format!("{label} failed: {detail}")
}
