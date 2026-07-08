fn main() {
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
    ];

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("Tauri build should register the explicit command manifest");
}
