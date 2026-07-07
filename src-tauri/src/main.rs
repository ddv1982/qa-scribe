mod commands;
mod jobs;
mod process_io;
mod provider_command;
mod settings;
mod specta_bindings;

use jobs::JobStore;
use qa_scribe_core::{services::SessionService, storage::Database};
use settings::AppState;
use std::time::Instant;
use tauri::Manager;

fn main() {
    let specta_builder = specta_bindings::builder();

    // Rust owns the bridge types: regenerate the frontend bindings on every
    // debug run so a renamed field surfaces as a frontend compile error. The
    // committed file is also verified GUI-lessly by `specta_bindings`' test.
    #[cfg(debug_assertions)]
    specta_builder
        .export(specta_bindings::exporter(), specta_bindings::BINDINGS_PATH)
        .expect("failed to export TypeScript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let setup_started = Instant::now();
            let span_started = Instant::now();
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            eprintln!(
                "qa-scribe startup app data ready: elapsed_ms={}",
                span_started.elapsed().as_millis()
            );

            let span_started = Instant::now();
            let database = Database::open(app_data_dir.join("qa-scribe.sqlite"))?;
            eprintln!(
                "qa-scribe startup database open complete: elapsed_ms={}",
                span_started.elapsed().as_millis()
            );

            let span_started = Instant::now();
            let session_service = SessionService::new(database)?;
            eprintln!(
                "qa-scribe startup session service ready: elapsed_ms={}",
                span_started.elapsed().as_millis()
            );

            app.manage(AppState::new(session_service, app_data_dir));
            app.manage(JobStore::default());
            eprintln!(
                "qa-scribe startup backend setup complete: elapsed_ms={}",
                setup_started.elapsed().as_millis()
            );
            Ok(())
        })
        .invoke_handler(specta_builder.invoke_handler())
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
