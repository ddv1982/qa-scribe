use qa_scribe_core::{
    attachments::creation::{abort_creation_save as abort, commit_creation_save as commit},
    domain::{
        CommitCreationSave, CreationOutcome, NoteSource, PrepareCreationSave, PreparedCreation,
    },
};
use tauri::{AppHandle, Manager};

use crate::{
    commands::{CommandError, files::attachment_task},
    settings::AppState,
};

#[tauri::command]
#[specta::specta]
pub async fn prepare_creation_save(
    app: AppHandle,
    request: PrepareCreationSave,
) -> Result<PreparedCreation, CommandError> {
    attachment_task("Creation prepare", move || {
        app.state::<AppState>()
            .with_service(|service| service.prepare_creation_save(request))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn commit_creation_save(
    app: AppHandle,
    request: CommitCreationSave,
) -> Result<CreationOutcome, CommandError> {
    attachment_task("Creation commit", move || {
        let state = app.state::<AppState>();
        state.with_service(|service| commit(service, state.app_data_dir(), request))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn abort_creation_save(
    app: AppHandle,
    attempt_id: String,
) -> Result<CreationOutcome, CommandError> {
    attachment_task("Creation abort", move || {
        let state = app.state::<AppState>();
        state.with_service(|service| abort(service, state.app_data_dir(), &attempt_id))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn read_note_source(
    app: AppHandle,
    session_id: String,
    note_id: String,
) -> Result<Option<NoteSource>, CommandError> {
    attachment_task("Note source", move || {
        app.state::<AppState>()
            .with_service(|service| service.note_source(&session_id, &note_id))
    })
    .await
}
