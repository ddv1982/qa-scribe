use crate::domain::Attachment;

use super::html::{
    MANAGED_ATTACHMENT_PROTOCOL, attribute_value_with_decoder, decode_basic_html_entities,
    escape_html_attribute, find_case_insensitive,
};

const EDITOR_HTML_TAGS: &[&str] = &[
    "a", "b", "br", "em", "h2", "h3", "i", "img", "input", "li", "ol", "p", "strong", "ul",
];
const SELF_CLOSING_EDITOR_HTML_TAGS: &[&str] = &["br", "img", "input"];

pub fn parse_rich_html_fragment_response(response: &str) -> String {
    let stripped = strip_response_fence(response);
    repair_escaped_editor_html(&stripped)
}

pub fn preserve_managed_attachment_images(
    response: &str,
    original_note_html: &str,
    attachments: &[Attachment],
) -> String {
    let mut output = restore_known_attachment_sources(response.trim(), attachments);
    let original_images = preservable_images_from_html(original_note_html, attachments);

    for image in original_images {
        if image_already_present(&output, &image) {
            continue;
        }
        if !output.is_empty() && !output.ends_with('\n') {
            output.push('\n');
        }
        output.push_str("<p>");
        output.push_str(&image.html);
        output.push_str("</p>");
    }

    output
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PreservableImage {
    key: String,
    managed_attachment_id: Option<String>,
    html: String,
}

fn image_already_present(output: &str, image: &PreservableImage) -> bool {
    image
        .managed_attachment_id
        .as_deref()
        .map(|id| contains_managed_attachment(output, id))
        .unwrap_or_else(|| output.contains(&image.key))
}

fn restore_known_attachment_sources(value: &str, attachments: &[Attachment]) -> String {
    let mut output = value.to_string();
    for attachment in attachments {
        for source in [&attachment.relative_path, &attachment.filename] {
            if source.trim().is_empty() {
                continue;
            }
            output = replace_image_source(&output, source, &attachment.id);
        }
    }
    output
}

fn replace_image_source(value: &str, source: &str, attachment_id: &str) -> String {
    let mut output = value.to_string();
    for quote in ['"', '\''] {
        let needle = format!("src={quote}{source}{quote}");
        let replacement = format!(
            "src={quote}{MANAGED_ATTACHMENT_PROTOCOL}{attachment_id}{quote} data-attachment-id={quote}{attachment_id}{quote}"
        );
        output = output.replace(&needle, &replacement);
    }
    output
}

fn strip_response_fence(response: &str) -> String {
    let trimmed = response.trim();
    let Some(after_ticks) = trimmed.strip_prefix("```") else {
        return trimmed.to_string();
    };
    let Some(body_start) = after_ticks.find('\n') else {
        return trimmed.to_string();
    };

    let body = after_ticks[body_start + 1..].trim();
    body.strip_suffix("```")
        .map(str::trim)
        .unwrap_or(body)
        .to_string()
}

fn repair_escaped_editor_html(value: &str) -> String {
    let trimmed = value.trim();
    if should_decode_escaped_editor_html(trimmed) {
        decode_basic_html_entities(trimmed)
    } else {
        trimmed.to_string()
    }
}

fn should_decode_escaped_editor_html(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    if !contains_escaped_editor_opening_tag(&lower) {
        return false;
    }

    contains_escaped_editor_closing_tag(&lower)
        || contains_literal_editor_tag(&lower)
        || contains_escaped_self_closing_editor_tag(&lower)
}

fn contains_escaped_editor_opening_tag(lower: &str) -> bool {
    EDITOR_HTML_TAGS
        .iter()
        .any(|tag| contains_escaped_tag_start(lower, tag, false))
}

fn contains_escaped_editor_closing_tag(lower: &str) -> bool {
    EDITOR_HTML_TAGS
        .iter()
        .filter(|tag| !SELF_CLOSING_EDITOR_HTML_TAGS.contains(tag))
        .any(|tag| contains_escaped_tag_start(lower, tag, true))
}

fn contains_escaped_self_closing_editor_tag(lower: &str) -> bool {
    SELF_CLOSING_EDITOR_HTML_TAGS
        .iter()
        .any(|tag| contains_escaped_tag_start(lower, tag, false))
}

fn contains_literal_editor_tag(lower: &str) -> bool {
    EDITOR_HTML_TAGS.iter().any(|tag| {
        contains_literal_tag_start(lower, tag, false)
            || contains_literal_tag_start(lower, tag, true)
    })
}

fn contains_escaped_tag_start(lower: &str, tag: &str, closing: bool) -> bool {
    let needle = if closing {
        format!("&lt;/{tag}")
    } else {
        format!("&lt;{tag}")
    };
    contains_tag_boundary(lower, &needle, tag.len() + if closing { 5 } else { 4 })
}

fn contains_literal_tag_start(lower: &str, tag: &str, closing: bool) -> bool {
    let needle = if closing {
        format!("</{tag}")
    } else {
        format!("<{tag}")
    };
    contains_tag_boundary(lower, &needle, tag.len() + if closing { 2 } else { 1 })
}

fn contains_tag_boundary(lower: &str, needle: &str, boundary_offset: usize) -> bool {
    let mut offset = 0usize;
    while let Some(relative_start) = lower[offset..].find(needle) {
        let start = offset + relative_start;
        let boundary_index = start + boundary_offset;
        if tag_boundary_matches(lower, boundary_index) {
            return true;
        }
        offset = boundary_index;
    }
    false
}

fn tag_boundary_matches(value: &str, index: usize) -> bool {
    value[index..]
        .chars()
        .next()
        .is_some_and(|character| character.is_whitespace() || character == '/' || character == '>')
        || value[index..].starts_with("&gt;")
}

fn preservable_images_from_html(value: &str, attachments: &[Attachment]) -> Vec<PreservableImage> {
    let mut images = Vec::new();
    let mut offset = 0usize;
    while let Some(relative_start) = find_case_insensitive(&value[offset..], "<img") {
        let tag_start = offset + relative_start;
        let Some(relative_end) = value[tag_start..].find('>') else {
            break;
        };
        let tag = &value[tag_start + 1..tag_start + relative_end];
        if let Some(image) = preservable_image_from_img_tag(tag, attachments)
            && !images
                .iter()
                .any(|existing: &PreservableImage| existing.key == image.key)
        {
            images.push(image);
        }
        offset = tag_start + relative_end + 1;
    }
    images
}

/// `attribute_value_with_decoder` pinned to the narrow (six-entity) decoder.
/// Every attribute read in this module feeds into repaired/stored note HTML,
/// so it must not widen entity decoding beyond what
/// `decode_basic_html_entities` does — see that function's doc comment.
fn attribute_value(raw_tag: &str, attribute: &str) -> Option<String> {
    attribute_value_with_decoder(raw_tag, attribute, decode_basic_html_entities)
}

fn preservable_image_from_img_tag(
    tag: &str,
    attachments: &[Attachment],
) -> Option<PreservableImage> {
    if let Some(id) = managed_attachment_id_from_img_tag(tag, attachments) {
        let alt = image_alt_from_tag(tag).or_else(|| {
            attachments
                .iter()
                .find(|attachment| attachment.id == id)
                .map(|attachment| attachment.filename.clone())
        });
        return Some(PreservableImage {
            key: format!("{MANAGED_ATTACHMENT_PROTOCOL}{id}"),
            managed_attachment_id: Some(id.clone()),
            html: managed_image_html(&id, alt.as_deref().unwrap_or("Attached image")),
        });
    }

    let source = attribute_value(tag, "src")?.trim().to_string();
    if !is_preservable_external_image_source(&source) {
        return None;
    }
    Some(PreservableImage {
        key: source.clone(),
        managed_attachment_id: None,
        html: image_html(
            &source,
            image_alt_from_tag(tag)
                .as_deref()
                .unwrap_or("Attached image"),
        ),
    })
}

fn image_alt_from_tag(tag: &str) -> Option<String> {
    attribute_value(tag, "alt").filter(|value| !value.trim().is_empty())
}

fn managed_attachment_id_from_img_tag(tag: &str, attachments: &[Attachment]) -> Option<String> {
    attribute_value(tag, "data-attachment-id")
        .filter(|id| !id.trim().is_empty())
        .or_else(|| {
            attribute_value(tag, "src").and_then(|src| {
                let source = src.trim();
                source
                    .strip_prefix(MANAGED_ATTACHMENT_PROTOCOL)
                    .filter(|id| !id.trim().is_empty())
                    .map(ToOwned::to_owned)
                    .or_else(|| {
                        attachments
                            .iter()
                            .find(|attachment| {
                                source == attachment.relative_path || source == attachment.filename
                            })
                            .map(|attachment| attachment.id.clone())
                    })
            })
        })
}

fn contains_managed_attachment(value: &str, attachment_id: &str) -> bool {
    value.contains(&format!("data-attachment-id=\"{attachment_id}\""))
        || value.contains(&format!("data-attachment-id='{attachment_id}'"))
        || value.contains(&format!("{MANAGED_ATTACHMENT_PROTOCOL}{attachment_id}"))
}

fn managed_image_html(attachment_id: &str, alt: &str) -> String {
    format!(
        "<img src=\"{}{attachment_id}\" data-attachment-id=\"{}\" alt=\"{}\" />",
        MANAGED_ATTACHMENT_PROTOCOL,
        escape_html_attribute(attachment_id),
        escape_html_attribute(alt)
    )
}

fn image_html(source: &str, alt: &str) -> String {
    format!(
        "<img src=\"{}\" alt=\"{}\" />",
        escape_html_attribute(source),
        escape_html_attribute(alt)
    )
}

fn is_preservable_external_image_source(source: &str) -> bool {
    source.starts_with("https://") || source.starts_with("http://")
}
