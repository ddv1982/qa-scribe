use crate::domain::Attachment;

const MANAGED_ATTACHMENT_PROTOCOL: &str = "qa-scribe-attachment://";

pub fn parse_session_report_response(response: &str) -> String {
    let trimmed = response.trim();
    if let Some(stripped) = trimmed.strip_prefix("```markdown") {
        return stripped.trim_end_matches("```").trim().to_string();
    }
    if let Some(stripped) = trimmed.strip_prefix("```") {
        return stripped.trim_end_matches("```").trim().to_string();
    }
    trimmed.to_string()
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
            "src={quote}{}{attachment_id}{quote} data-attachment-id={quote}{attachment_id}{quote}",
            MANAGED_ATTACHMENT_PROTOCOL
        );
        output = output.replace(&needle, &replacement);
    }
    output
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
