use rusqlite::{OptionalExtension, params};

use crate::{
    Result,
    domain::{
        AppSettings, default_generation_system_prompt, legacy_testware_generation_system_prompt,
        validate_optional_text, validate_required_text,
    },
    error::validation,
};

use super::{SessionService, now};

const APPLICATION_SETTINGS_KEY: &str = "application";

fn normalize_loaded_settings(mut settings: AppSettings) -> AppSettings {
    if settings.generation_system_prompt.trim() == legacy_testware_generation_system_prompt() {
        settings.generation_system_prompt = default_generation_system_prompt();
    }
    settings
}

impl SessionService {
    pub fn get_settings(&self) -> Result<AppSettings> {
        let value_json: Option<String> = self
            .database
            .connection()
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = ?1",
                [APPLICATION_SETTINGS_KEY],
                |row| row.get(0),
            )
            .optional()?;

        match value_json {
            Some(value) => serde_json::from_str(&value)
                .map(normalize_loaded_settings)
                .map_err(|_| validation("stored app settings are invalid")),
            None => Ok(AppSettings::default()),
        }
    }

    pub fn update_settings(&self, settings: AppSettings) -> Result<AppSettings> {
        if settings.schema_version != 1 {
            return Err(validation("unsupported app settings schema version"));
        }
        let prompt = validate_required_text(
            "generation system prompt",
            &settings.generation_system_prompt,
            8_000,
        )?;
        let model = validate_required_text("selected AI model", &settings.selected_ai_model, 240)?;
        let mut selected_ai_models_by_provider =
            AppSettings::default().selected_ai_models_by_provider;
        for (provider, model) in settings.selected_ai_models_by_provider.clone() {
            selected_ai_models_by_provider.insert(
                provider,
                validate_required_text("selected AI provider model", &model, 240)?,
            );
        }
        let mut selected_ai_reasoning_efforts_by_provider =
            AppSettings::default().selected_ai_reasoning_efforts_by_provider;
        for (provider, effort) in settings.selected_ai_reasoning_efforts_by_provider.clone() {
            selected_ai_reasoning_efforts_by_provider.insert(
                provider,
                validate_optional_text("selected AI reasoning effort", effort, 40)?,
            );
        }
        let testware_template =
            validate_required_text("testware template", &settings.testware_template, 12_000)?;
        let finding_template =
            validate_required_text("finding template", &settings.finding_template, 12_000)?;
        let note_summary_template = validate_required_text(
            "note summary template",
            &settings.note_summary_template,
            12_000,
        )?;
        let next = AppSettings {
            generation_system_prompt: prompt,
            selected_ai_model: model,
            selected_ai_models_by_provider,
            selected_ai_reasoning_efforts_by_provider,
            testware_template,
            finding_template,
            note_summary_template,
            ..settings
        };
        let now = now();
        let value_json = serde_json::to_string(&next)
            .map_err(|_| validation("app settings could not serialize"))?;

        self.database.connection().execute(
            "INSERT INTO app_settings (key, value_json, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
            params![APPLICATION_SETTINGS_KEY, value_json, now],
        )?;

        Ok(next)
    }
}
