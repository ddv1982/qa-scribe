mod commands;
mod jobs;
mod process_io;
mod provider_command;
mod settings;

use commands::{
    cancel_ai_action_job, copy_attachment_image_to_clipboard, create_draft, create_entry,
    create_finding, create_session, delete_draft, delete_finding, delete_session, export_session,
    get_ai_action_job_status, get_attachment_preview_data_url, get_provider_status, get_settings,
    import_clipboard_screenshot, list_drafts, list_entries, list_findings, list_sessions,
    read_clipboard_image_data_url, refresh_provider_status, reopen_session, start_ai_action_job,
    update_draft, update_entry, update_finding, update_session, update_settings,
};
use jobs::JobStore;
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
            app.manage(AppState::new(SessionService::new(database)?, app_data_dir));
            app.manage(JobStore::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            update_settings,
            list_sessions,
            create_session,
            reopen_session,
            update_session,
            delete_session,
            create_entry,
            list_entries,
            update_entry,
            create_finding,
            list_findings,
            update_finding,
            create_draft,
            list_drafts,
            update_draft,
            delete_draft,
            delete_finding,
            start_ai_action_job,
            get_ai_action_job_status,
            cancel_ai_action_job,
            import_clipboard_screenshot,
            get_provider_status,
            refresh_provider_status,
            export_session,
            get_attachment_preview_data_url,
            read_clipboard_image_data_url,
            copy_attachment_image_to_clipboard
        ])
        .build(tauri::generate_context!())
        .expect("error while building qa-scribe")
        .run(|app, event| {
            // Both events can fire during a single shutdown; that's fine since
            // killing an already-killed/reaped child is a no-op in place.
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                app.state::<JobStore>().kill_all_children();
            }
        });
}
