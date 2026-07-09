fn main() {
    // `tauri::generate_context!` embeds `frontend/dist` at macro-expansion
    // time, but cargo does not watch those files on its own — a rebuilt
    // frontend would otherwise ship inside a stale binary until something
    // else forces this crate to recompile.
    emit_rerun_if_changed_recursive(std::path::Path::new("../frontend/dist"));

    const COMMANDS: &[&str] = &[
        "get_settings",
        "update_settings",
        "list_sessions",
        "list_recent_sessions",
        "create_session",
        "reopen_session",
        "open_session_note_state",
        "update_session",
        "delete_session",
        "create_entry",
        "list_entries",
        "update_entry",
        "create_finding",
        "list_findings",
        "update_finding",
        "create_draft",
        "list_drafts",
        "update_draft",
        "delete_draft",
        "delete_finding",
        "start_ai_action_job",
        "get_ai_action_job_status",
        "list_active_ai_action_jobs",
        "cancel_ai_action_job",
        "import_clipboard_screenshot",
        "get_provider_status",
        "refresh_provider_status",
        "get_attachment_preview_data_url",
        "read_clipboard_image_data_url",
        "copy_attachment_image_to_clipboard",
        "copy_html_to_clipboard",
    ];

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("Tauri build should register the explicit command manifest");
}

/// Watching the directory itself only catches added/removed entries, so every
/// file is emitted individually; content edits to an existing file (e.g. a
/// regenerated `index.html`) must also trigger a rebuild.
fn emit_rerun_if_changed_recursive(path: &std::path::Path) {
    println!("cargo:rerun-if-changed={}", path.display());
    let Ok(entries) = std::fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let entry_path = entry.path();
        if entry_path.is_dir() {
            emit_rerun_if_changed_recursive(&entry_path);
        } else {
            println!("cargo:rerun-if-changed={}", entry_path.display());
        }
    }
}
