use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::AiProvider;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub schema_version: u16,
    pub generation_system_prompt: String,
    #[serde(default = "default_selected_ai_provider")]
    pub selected_ai_provider: AiProvider,
    #[serde(default = "default_selected_ai_model")]
    pub selected_ai_model: String,
    #[serde(default = "default_selected_ai_models_by_provider")]
    pub selected_ai_models_by_provider: HashMap<AiProvider, String>,
    #[serde(default = "default_selected_ai_reasoning_efforts_by_provider")]
    pub selected_ai_reasoning_efforts_by_provider: HashMap<AiProvider, Option<String>>,
    #[serde(default = "default_testware_template")]
    pub testware_template: String,
    #[serde(default = "default_finding_template")]
    pub finding_template: String,
    #[serde(default = "default_note_summary_template")]
    pub note_summary_template: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            generation_system_prompt: default_generation_system_prompt(),
            selected_ai_provider: default_selected_ai_provider(),
            selected_ai_model: default_selected_ai_model(),
            selected_ai_models_by_provider: default_selected_ai_models_by_provider(),
            selected_ai_reasoning_efforts_by_provider:
                default_selected_ai_reasoning_efforts_by_provider(),
            testware_template: default_testware_template(),
            finding_template: default_finding_template(),
            note_summary_template: default_note_summary_template(),
        }
    }
}

pub fn default_generation_system_prompt() -> String {
    [
        "You help QA practitioners transform selected QA Scribe material into the requested output.",
        "Follow the action-specific instructions exactly.",
        "Use only supplied note material and managed image references.",
        "Do not invent facts, environment details, severity, steps, expected results, or test data.",
        "Return the requested clean HTML fragment unless the action explicitly asks otherwise.",
    ]
    .join("\n")
}

pub fn legacy_testware_generation_system_prompt() -> &'static str {
    "Turn the selected Session material into concise, evidence-grounded Testware."
}

fn default_selected_ai_provider() -> AiProvider {
    AiProvider::CodexCli
}

fn default_selected_ai_model() -> String {
    "default".to_string()
}

/// Per-provider default model selection. Single source of truth for both the
/// `AppSettings` default and the frontend's provider-defaults (exported to
/// TypeScript as a bindings constant), so the two can never drift.
pub fn default_selected_ai_models_by_provider() -> HashMap<AiProvider, String> {
    HashMap::from([
        (AiProvider::ClaudeCode, "default".to_string()),
        (AiProvider::CodexCli, "default".to_string()),
        (AiProvider::CopilotCli, "auto".to_string()),
    ])
}

/// Per-provider default reasoning effort. Single source of truth shared with
/// the frontend via a bindings constant (see the models default above).
pub fn default_selected_ai_reasoning_efforts_by_provider() -> HashMap<AiProvider, Option<String>> {
    HashMap::from([
        (AiProvider::ClaudeCode, Some("medium".to_string())),
        (AiProvider::CodexCli, Some("low".to_string())),
        (AiProvider::CopilotCli, None),
    ])
}

fn default_testware_template() -> String {
    [
        "Create test scenarios with test cases from the selected note only.",
        "Group related cases under scenario headings.",
        "For each test case include purpose, preconditions, test data, steps, expected result, and coverage notes when supported.",
        "Use checkboxes only for executable test steps.",
        "Do not create a bug finding, severity field, Jira issue, or impact section.",
        "Do not wrap the response in a code fence.",
    ]
    .join("\n")
}

fn default_finding_template() -> String {
    [
        "Create exactly one QA finding from the selected note only.",
        "Use the first h2 as the concise finding title.",
        "Include sections for severity, environment, steps to reproduce, expected result, actual result, evidence, and impact.",
        "If a field is not supported by the note, write \"Unknown\".",
        "Do not create test scenarios or test cases.",
        "Do not wrap the response in a code fence.",
    ]
    .join("\n")
}

fn default_note_summary_template() -> String {
    [
        "Summarize and clarify the selected note only.",
        "Keep it as a note, not a finding and not testware.",
        "Preserve the original meaning, relevant checkboxes, links, and managed images.",
        "Remove duplication and tighten wording.",
        "Do not add severity, expected/actual result sections, test cases, Jira fields, or new facts.",
        "Do not wrap the response in a code fence.",
    ]
    .join("\n")
}
