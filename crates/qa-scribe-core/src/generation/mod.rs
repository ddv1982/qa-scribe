mod html;
mod html_projection;
mod preferences;
mod prompt;
mod response;
mod workflow;

pub use html_projection::project_html_to_prompt_text;
pub use preferences::{
    TestwareDepth, TestwareGenerationPreferences, TestwareOutputFormat, TestwareTechnique,
};
pub use prompt::{ActionPromptKind, managed_attachment_ids_from_html, render_action_prompt};
pub use response::{parse_rich_html_fragment_response, preserve_managed_attachment_images};
pub use workflow::{
    GenerateAiActionKind, GenerateAiActionRequest, GenerateAiActionResult, PreparedGeneration,
    finish_ai_action_generation, prepare_ai_action_generation,
};

#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;
