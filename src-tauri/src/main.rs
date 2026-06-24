mod commands;
mod jobs;
mod path_access;
mod provider_command;
mod settings;

use commands::{
    cancel_ai_action_job, copy_attachment_image_to_clipboard, create_ai_run, create_draft,
    create_entry, create_evidence_link, create_finding, create_generation_context, create_session,
    delete_draft, delete_finding, delete_session, export_session, generate_ai_action,
    generate_session_report, get_ai_action_job_status, get_app_status,
    get_attachment_preview_data_url, get_command_shell_status, get_provider_status, get_session,
    get_settings, import_attachment, import_clipboard_screenshot, list_attachments, list_drafts,
    list_entries, list_findings, list_sessions, refresh_provider_status, reopen_session,
    start_ai_action_job, update_draft, update_entry, update_finding, update_session,
    update_settings,
};
use jobs::JobStore;
use path_access::PathAccess;
use qa_scribe_core::{services::SessionService, storage::Database};
use settings::AppState;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let database = Database::open(app_data_dir.join("qa-scribe.sqlite"))?;
            app.manage(AppState::new(SessionService::new(database), app_data_dir));
            app.manage(JobStore::default());
            app.manage(PathAccess::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            get_command_shell_status,
            get_settings,
            update_settings,
            list_sessions,
            create_session,
            get_session,
            reopen_session,
            update_session,
            delete_session,
            create_entry,
            list_entries,
            update_entry,
            create_finding,
            list_findings,
            update_finding,
            create_evidence_link,
            create_generation_context,
            create_ai_run,
            create_draft,
            list_drafts,
            update_draft,
            delete_draft,
            delete_finding,
            generate_ai_action,
            start_ai_action_job,
            get_ai_action_job_status,
            cancel_ai_action_job,
            generate_session_report,
            import_attachment,
            import_clipboard_screenshot,
            list_attachments,
            get_provider_status,
            refresh_provider_status,
            export_session,
            get_attachment_preview_data_url,
            copy_attachment_image_to_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running qa-scribe");
}
