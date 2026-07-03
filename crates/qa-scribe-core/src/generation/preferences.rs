//! Testware generation preferences: user-selected technique, output format,
//! and depth. These are domain data — the selection is rendered into the
//! prompt and persisted into `Draft.metadata_json` alongside the result.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TestwareTechnique {
    Auto,
    UseCase,
    EquivalenceBoundary,
    DecisionTable,
    StateTransition,
    Pairwise,
    RiskBased,
    Exploratory,
    Bdd,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TestwareOutputFormat {
    QaCases,
    Checklist,
    Gherkin,
    Charters,
    CoverageOutline,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TestwareDepth {
    Lean,
    Balanced,
    Thorough,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestwareGenerationPreferences {
    pub technique: TestwareTechnique,
    pub output_format: TestwareOutputFormat,
    pub depth: TestwareDepth,
    pub include_negative_cases: bool,
    pub include_boundary_cases: bool,
    pub include_test_data: bool,
    pub preserve_evidence: bool,
    pub custom_instructions: Option<String>,
}

impl TestwareTechnique {
    fn label(self) -> &'static str {
        match self {
            TestwareTechnique::Auto => "Auto-select",
            TestwareTechnique::UseCase => "Use case flows",
            TestwareTechnique::EquivalenceBoundary => "Equivalence and boundary",
            TestwareTechnique::DecisionTable => "Decision table",
            TestwareTechnique::StateTransition => "State transition",
            TestwareTechnique::Pairwise => "Pairwise coverage",
            TestwareTechnique::RiskBased => "Risk-based",
            TestwareTechnique::Exploratory => "Exploratory charters",
            TestwareTechnique::Bdd => "BDD scenarios",
        }
    }

    fn guidance(self) -> &'static str {
        match self {
            TestwareTechnique::Auto => {
                "Inspect the note and choose the strongest fitting technique. State the chosen technique in the output."
            }
            TestwareTechnique::UseCase => {
                "Model the main user or system flows, including happy paths, alternate paths, and exception paths."
            }
            TestwareTechnique::EquivalenceBoundary => {
                "Identify equivalence classes and relevant boundaries. Include valid and invalid partitions, plus min/at/max style checks when the note supports them."
            }
            TestwareTechnique::DecisionTable => {
                "Identify conditions, actions, and rule combinations. Render the table-like coverage as headings and lists, not a literal HTML table."
            }
            TestwareTechnique::StateTransition => {
                "Identify states, events, transitions, and invalid transitions. Cover meaningful state changes and recovery paths."
            }
            TestwareTechnique::Pairwise => {
                "Extract parameters and values, then create a compact pairwise-style scenario set. If dimensions are missing, state assumptions and fall back to scenario coverage."
            }
            TestwareTechnique::RiskBased => {
                "Prioritize cases by likely product risk, impact, likelihood, and recent change complexity. Add concise risk notes per group."
            }
            TestwareTechnique::Exploratory => {
                "Create exploratory charters with mission, risks, setup/data, timebox, checks, and observation prompts."
            }
            TestwareTechnique::Bdd => {
                "Use Gherkin-like Given/When/Then scenario structure in clean HTML, without code fences."
            }
        }
    }
}

impl TestwareOutputFormat {
    fn label(self) -> &'static str {
        match self {
            TestwareOutputFormat::QaCases => "QA test cases",
            TestwareOutputFormat::Checklist => "Checklist",
            TestwareOutputFormat::Gherkin => "Gherkin-style scenarios",
            TestwareOutputFormat::Charters => "Exploratory charters",
            TestwareOutputFormat::CoverageOutline => "Coverage outline",
        }
    }

    fn guidance(self) -> &'static str {
        match self {
            TestwareOutputFormat::QaCases => {
                "Use h2 scenario groups and h3 test cases. For each case include preconditions, test data, steps, expected result, and coverage notes when applicable."
            }
            TestwareOutputFormat::Checklist => {
                "Use checklist items for executable checks. Keep each item directly testable and include expected results where useful."
            }
            TestwareOutputFormat::Gherkin => {
                "Use Feature/Scenario style content with Given/When/Then phrasing in h2, h3, p, ul, and ol elements."
            }
            TestwareOutputFormat::Charters => {
                "Use exploratory charter sections with mission, scope, risks, setup/data, timebox, and notes to capture observations."
            }
            TestwareOutputFormat::CoverageOutline => {
                "Start with a compact coverage map, then list the concrete cases needed to exercise each area."
            }
        }
    }
}

impl TestwareDepth {
    fn label(self) -> &'static str {
        match self {
            TestwareDepth::Lean => "Lean",
            TestwareDepth::Balanced => "Balanced",
            TestwareDepth::Thorough => "Thorough",
        }
    }

    fn guidance(self) -> &'static str {
        match self {
            TestwareDepth::Lean => "Target 3-5 high-value cases or charters.",
            TestwareDepth::Balanced => "Target 6-10 cases or charters when the note supports it.",
            TestwareDepth::Thorough => {
                "Target 10-16 cases or charters when the note supports it, with broader negative and edge coverage."
            }
        }
    }
}

fn default_testware_preferences() -> TestwareGenerationPreferences {
    TestwareGenerationPreferences {
        technique: TestwareTechnique::Auto,
        output_format: TestwareOutputFormat::QaCases,
        depth: TestwareDepth::Balanced,
        include_negative_cases: true,
        include_boundary_cases: true,
        include_test_data: true,
        preserve_evidence: true,
        custom_instructions: None,
    }
}

fn preferences_or_default(
    preferences: Option<&TestwareGenerationPreferences>,
) -> TestwareGenerationPreferences {
    preferences
        .cloned()
        .unwrap_or_else(default_testware_preferences)
}

pub(super) fn testware_preferences_prompt(
    preferences: Option<&TestwareGenerationPreferences>,
) -> String {
    let preferences = preferences_or_default(preferences);
    let custom_instructions = preferences
        .custom_instructions
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("None");

    format!(
        "\n# Testware Generation Preferences\n\
Technique: {}\n\
Technique guidance: {}\n\
Output format: {}\n\
Output contract: {}\n\
Depth: {} - {}\n\
Include negative cases: {}\n\
Include boundary cases: {}\n\
Include test data: {}\n\
Preserve evidence: {}\n\
Additional user guidance: {}\n\
\n\
Honor these preferences while still using only supplied note material and managed image references. \
If the selected technique cannot be applied cleanly, say what was missing and use the nearest useful coverage structure.\n",
        preferences.technique.label(),
        preferences.technique.guidance(),
        preferences.output_format.label(),
        preferences.output_format.guidance(),
        preferences.depth.label(),
        preferences.depth.guidance(),
        yes_no(preferences.include_negative_cases),
        yes_no(preferences.include_boundary_cases),
        yes_no(preferences.include_test_data),
        yes_no(preferences.preserve_evidence),
        custom_instructions,
    )
}

pub(super) fn testware_metadata_json(
    preferences: Option<&TestwareGenerationPreferences>,
) -> Option<String> {
    let preferences = preferences_or_default(preferences);
    serde_json::to_string(&serde_json::json!({
        "testwareGeneration": preferences,
    }))
    .ok()
}

fn yes_no(value: bool) -> &'static str {
    if value { "yes" } else { "no" }
}
