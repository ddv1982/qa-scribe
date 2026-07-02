mod html_projection;
mod prompt;
mod response;

pub use html_projection::project_html_to_prompt_text;
pub use prompt::{ActionPromptKind, managed_attachment_ids_from_html, render_action_prompt};
pub use response::{parse_rich_html_fragment_response, preserve_managed_attachment_images};

#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;
