use crate::domain::Attachment;

const MANAGED_ATTACHMENT_PROTOCOL: &str = "qa-scribe-attachment://";
const EDITOR_HTML_TAGS: &[&str] = &[
    "a", "b", "br", "em", "h2", "h3", "i", "img", "input", "li", "ol", "p", "strong", "ul",
];
const SELF_CLOSING_EDITOR_HTML_TAGS: &[&str] = &["br", "img", "input"];

pub fn parse_session_report_response(response: &str) -> String {
    strip_response_fence(response)
}

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
    let original_images = managed_images_from_html(original_note_html, attachments);

    for image in original_images {
        if contains_managed_attachment(&output, &image.id) {
            continue;
        }
        if !output.is_empty() && !output.ends_with('\n') {
            output.push('\n');
        }
        output.push_str("<p>");
        output.push_str(&managed_image_html(&image.id, &image.alt));
        output.push_str("</p>");
    }

    output
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ManagedImage {
    id: String,
    alt: String,
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

fn managed_images_from_html(value: &str, attachments: &[Attachment]) -> Vec<ManagedImage> {
    let mut images = Vec::new();
    let mut offset = 0usize;
    while let Some(relative_start) = value[offset..].to_ascii_lowercase().find("<img") {
        let tag_start = offset + relative_start;
        let Some(relative_end) = value[tag_start..].find('>') else {
            break;
        };
        let tag = &value[tag_start + 1..tag_start + relative_end];
        if let Some(id) = managed_attachment_id_from_img_tag(tag, attachments)
            && !images.iter().any(|image: &ManagedImage| image.id == id)
        {
            let alt = attribute_value(tag, "alt")
                .filter(|value| !value.trim().is_empty())
                .or_else(|| {
                    attachments
                        .iter()
                        .find(|attachment| attachment.id == id)
                        .map(|attachment| attachment.filename.clone())
                })
                .unwrap_or_else(|| "Attached image".to_string());
            images.push(ManagedImage { id, alt });
        }
        offset = tag_start + relative_end + 1;
    }
    images
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

fn attribute_value(raw_tag: &str, attribute: &str) -> Option<String> {
    let mut index = raw_tag.find(char::is_whitespace).unwrap_or(raw_tag.len());
    while index < raw_tag.len() {
        index = skip_whitespace(raw_tag, index);
        if index >= raw_tag.len() {
            return None;
        }
        if raw_tag[index..].starts_with('/') {
            index += 1;
            continue;
        }

        let name_start = index;
        while index < raw_tag.len() {
            let character = raw_tag[index..].chars().next()?;
            if character.is_whitespace() || character == '=' || character == '/' {
                break;
            }
            index += character.len_utf8();
        }
        if name_start == index {
            index += raw_tag[index..].chars().next()?.len_utf8();
            continue;
        }
        let name = raw_tag[name_start..index].to_ascii_lowercase();
        index = skip_whitespace(raw_tag, index);

        let value = if raw_tag[index..].starts_with('=') {
            index += 1;
            index = skip_whitespace(raw_tag, index);
            if index >= raw_tag.len() {
                String::new()
            } else {
                let quote = raw_tag[index..].chars().next()?;
                if quote == '"' || quote == '\'' {
                    index += quote.len_utf8();
                    let value_start = index;
                    let mut value_end = raw_tag.len();
                    while index < raw_tag.len() {
                        let character = raw_tag[index..].chars().next()?;
                        if character == quote {
                            value_end = index;
                            index += quote.len_utf8();
                            break;
                        }
                        index += character.len_utf8();
                    }
                    raw_tag[value_start..value_end].to_string()
                } else {
                    let value_start = index;
                    while index < raw_tag.len() {
                        let character = raw_tag[index..].chars().next()?;
                        if character.is_whitespace() || character == '/' {
                            break;
                        }
                        index += character.len_utf8();
                    }
                    raw_tag[value_start..index].to_string()
                }
            }
        } else {
            String::new()
        };

        if name == attribute.to_ascii_lowercase() {
            return Some(decode_basic_html_entities(&value));
        }
    }
    None
}

fn skip_whitespace(value: &str, mut index: usize) -> usize {
    while index < value.len() {
        let Some(character) = value[index..].chars().next() else {
            break;
        };
        if !character.is_whitespace() {
            break;
        }
        index += character.len_utf8();
    }
    index
}

fn decode_basic_html_entities(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn escape_html_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
