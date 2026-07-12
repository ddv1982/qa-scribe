use crate::domain::Attachment;

use super::{attribute_value, clean_managed_attachment_id, image_html, managed_image_html};
use crate::generation::html::{MANAGED_ATTACHMENT_PROTOCOL, find_case_insensitive};

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

/// Rewrites AI-echoed relative attachment paths to the real managed source.
/// Relative paths are attachment-unique. Bare filenames are restored only
/// when exactly one attachment has that filename, so evidence is never
/// silently attributed to the wrong attachment.
fn restore_known_attachment_sources(value: &str, attachments: &[Attachment]) -> String {
    let mut output = value.to_string();
    for attachment in attachments {
        if !attachment.relative_path.trim().is_empty() {
            output = replace_image_source(&output, &attachment.relative_path, &attachment.id);
        }
    }
    for attachment in attachments {
        if attachment.filename.trim().is_empty()
            || !filename_is_unique(attachments, &attachment.filename)
        {
            continue;
        }
        output = replace_image_source(&output, &attachment.filename, &attachment.id);
    }
    output
}

fn filename_is_unique(attachments: &[Attachment], filename: &str) -> bool {
    attachments
        .iter()
        .filter(|attachment| attachment.filename == filename)
        .count()
        == 1
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
        .and_then(|id| clean_managed_attachment_id(&id))
        .or_else(|| {
            attribute_value(tag, "src").and_then(|src| {
                let source = src.trim();
                source
                    .strip_prefix(MANAGED_ATTACHMENT_PROTOCOL)
                    .and_then(clean_managed_attachment_id)
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

fn is_preservable_external_image_source(source: &str) -> bool {
    source.starts_with("https://") || source.starts_with("http://")
}
