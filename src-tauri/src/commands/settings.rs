use qa_scribe_core::domain::AppSettings;
use tauri::State;

use crate::settings::AppState;

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state.with_service(|service| service.get_settings())
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    state.with_service(|service| service.update_settings(settings))
}
