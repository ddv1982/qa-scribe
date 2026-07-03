use qa_scribe_core::domain::AppSettings;
use tauri::State;

use crate::{commands::CommandError, settings::AppState};

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, CommandError> {
    state.with_service(|service| service.get_settings())
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, CommandError> {
    state.with_service(|service| service.update_settings(settings))
}
