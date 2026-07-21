use std::collections::{HashMap, HashSet};

use crate::domain::Attachment;

use super::{attribute_value, clean_managed_attachment_id, image_html, managed_image_html};
use crate::generation::html::{MANAGED_ATTACHMENT_PROTOCOL, find_html_tag_end};

pub fn preserve_managed_attachment_images(
    response: &str,
    original_note_html: &str,
    attachments: &[Attachment],
) -> String {
    let sanitized = super::sanitize_generated_rich_html(response.trim());
    let mut output = restore_known_attachment_sources(&sanitized, attachments);
    let original_images = preservable_images_from_html(original_note_html, attachments, true);
    let mut present_image_keys = preservable_images_from_html(&output, attachments, false)
        .into_iter()
        .map(|image| image.key)
        .collect::<HashSet<_>>();

    for image in original_images {
        if !present_image_keys.insert(image.key) {
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
    html: String,
}

/// Rewrites sanitizer-confirmed image sources only when they identify one
/// attachment across both relative paths and filenames.
fn restore_known_attachment_sources(value: &str, attachments: &[Attachment]) -> String {
    let known_sources = unique_attachment_sources(attachments);
    let mut output = String::with_capacity(value.len());
    let mut offset = 0;
    while let Some(relative_start) = value[offset..].find("<img") {
        let tag_start = offset + relative_start;
        let Some(tag_end) = find_html_tag_end(value, tag_start + 1) else {
            break;
        };
        let tag = &value[tag_start + 1..tag_end];
        output.push_str(&value[offset..tag_start]);
        let replacement = attribute_value(tag, "src")
            .and_then(|source| known_sources.get(source.trim()).copied().flatten())
            .map(|attachment_id| {
                managed_image_html(
                    attachment_id,
                    image_alt_from_tag(tag)
                        .as_deref()
                        .unwrap_or("Attached image"),
                )
            });
        if let Some(replacement) = replacement {
            output.push_str(&replacement);
        } else {
            output.push_str(&value[tag_start..=tag_end]);
        }
        offset = tag_end + 1;
    }
    output.push_str(&value[offset..]);
    output
}

fn unique_attachment_sources(attachments: &[Attachment]) -> HashMap<&str, Option<&str>> {
    let mut sources: HashMap<&str, Option<&str>> = HashMap::new();
    for attachment in attachments {
        for source in [
            attachment.relative_path.as_str(),
            attachment.filename.as_str(),
        ] {
            if source.trim().is_empty() {
                continue;
            }
            sources
                .entry(source)
                .and_modify(|matched_id| {
                    if matched_id.is_some_and(|id| id != attachment.id.as_str()) {
                        *matched_id = None;
                    }
                })
                .or_insert(Some(attachment.id.as_str()));
        }
    }
    sources
}

fn preservable_images_from_html(
    value: &str,
    attachments: &[Attachment],
    infer_known_paths: bool,
) -> Vec<PreservableImage> {
    let mut images = Vec::new();
    let mut image_keys = HashSet::new();
    let mut offset = 0usize;
    while let Some(relative_start) = value[offset..].find('<') {
        let tag_start = offset + relative_start;
        if value[tag_start..].starts_with("<!--") {
            let Some(relative_end) = value[tag_start + 4..].find("-->") else {
                break;
            };
            offset = tag_start + 4 + relative_end + 3;
            continue;
        }
        let Some(tag_prefix) = value.get(tag_start + 1..tag_start + 4) else {
            offset = tag_start + 1;
            continue;
        };
        let boundary = value[tag_start + 4..].chars().next();
        if !tag_prefix.eq_ignore_ascii_case("img")
            || !boundary.is_some_and(|character| {
                character.is_ascii_whitespace() || character == '/' || character == '>'
            })
        {
            offset = tag_start + 1;
            continue;
        }
        let Some(tag_end) = find_html_tag_end(value, tag_start + 1) else {
            offset = tag_start + 4;
            continue;
        };
        let tag = &value[tag_start + 1..tag_end];
        if let Some(image) = preservable_image_from_img_tag(tag, attachments, infer_known_paths)
            && image_keys.insert(image.key.clone())
        {
            images.push(image);
        }
        offset = tag_end + 1;
    }
    images
}

fn preservable_image_from_img_tag(
    tag: &str,
    attachments: &[Attachment],
    infer_known_paths: bool,
) -> Option<PreservableImage> {
    if let Some(id) = managed_attachment_id_from_img_tag(tag, attachments, infer_known_paths) {
        let alt = image_alt_from_tag(tag).or_else(|| {
            attachments
                .iter()
                .find(|attachment| attachment.id == id)
                .map(|attachment| attachment.filename.clone())
        });
        return Some(PreservableImage {
            key: format!("{MANAGED_ATTACHMENT_PROTOCOL}{id}"),
            html: managed_image_html(&id, alt.as_deref().unwrap_or("Attached image")),
        });
    }

    let source = attribute_value(tag, "src")?.trim().to_string();
    if !is_preservable_external_image_source(&source) {
        return None;
    }
    Some(PreservableImage {
        key: source.clone(),
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

fn managed_attachment_id_from_img_tag(
    tag: &str,
    attachments: &[Attachment],
    infer_known_paths: bool,
) -> Option<String> {
    attribute_value(tag, "data-attachment-id")
        .and_then(|id| clean_managed_attachment_id(&id))
        .or_else(|| {
            attribute_value(tag, "src").and_then(|src| {
                let source = src.trim();
                source
                    .strip_prefix(MANAGED_ATTACHMENT_PROTOCOL)
                    .and_then(clean_managed_attachment_id)
                    .or_else(|| {
                        infer_known_paths.then(|| unique_attachment_id(source, attachments))?
                    })
            })
        })
}

fn unique_attachment_id(source: &str, attachments: &[Attachment]) -> Option<String> {
    let mut matches = attachments
        .iter()
        .filter(|attachment| source == attachment.relative_path || source == attachment.filename);
    let attachment_id = matches.next()?.id.clone();
    matches.next().is_none().then_some(attachment_id)
}

fn is_preservable_external_image_source(source: &str) -> bool {
    source.starts_with("https://") || source.starts_with("http://")
}
