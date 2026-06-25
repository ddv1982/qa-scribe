mod html_projection;
mod prompt;
mod response;

pub use html_projection::project_html_to_prompt_text;
pub use prompt::{
    ActionPromptKind, SESSION_REPORT_PROMPT_VERSION, managed_attachment_ids_from_html,
    render_action_prompt, render_session_report_prompt,
};
pub use response::{
    parse_rich_html_fragment_response, parse_session_report_response,
    preserve_managed_attachment_images,
};

#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;
