use crate::domain::Attachment;

use super::html::{
    MANAGED_ATTACHMENT_PROTOCOL, attribute_value_with_decoder, decode_basic_html_entities,
    escape_html_attribute, find_case_insensitive,
};

const EDITOR_HTML_TAGS: &[&str] = &[
    "a", "b", "br", "em", "h2", "h3", "i", "img", "input", "li", "ol", "p", "strong", "ul",
];
const SELF_CLOSING_EDITOR_HTML_TAGS: &[&str] = &["br", "img", "input"];
const REMOVED_EDITOR_HTML_TAGS: &[&str] = &[
    "embed", "form", "iframe", "math", "meta", "object", "script", "style", "svg", "template",
];

/// [`EDITOR_HTML_TAGS`] as an owned `Vec<String>`, for exporting as a typed
/// bindings constant (see `specta_bindings::builder`). The frontend's
/// `allowedEditorTags`/`editorTagPattern` in `editor/editorHtml.ts` derive
/// from this instead of restating the literal list, so the two allowlists
/// can never drift apart.
pub fn editor_html_tags() -> Vec<String> {
    EDITOR_HTML_TAGS.iter().map(|tag| tag.to_string()).collect()
}

/// [`SELF_CLOSING_EDITOR_HTML_TAGS`] as an owned `Vec<String>`, for exporting
/// as a typed bindings constant alongside [`editor_html_tags`]. The
/// frontend's void-tag pattern in `editor/editorHtml.ts` derives from this
/// instead of restating the literal list.
pub fn self_closing_editor_html_tags() -> Vec<String> {
    SELF_CLOSING_EDITOR_HTML_TAGS
        .iter()
        .map(|tag| tag.to_string())
        .collect()
}

const HTML_FRAGMENT_OPEN: &str = "<html_fragment>";
const HTML_FRAGMENT_CLOSE: &str = "</html_fragment>";
const ESCAPED_HTML_FRAGMENT_OPEN: &str = "&lt;html_fragment&gt;";
const ESCAPED_HTML_FRAGMENT_CLOSE: &str = "&lt;/html_fragment&gt;";

/// The per-generation output sentinel: `html_fragment_` plus a random hex
/// suffix. Because the suffix exists only in the one prompt that asked for
/// it, note content echoed into the output or narration mentioning the
/// generic marker can never collide with the real extraction boundaries.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutputMarker {
    tag_name: String,
}

impl OutputMarker {
    pub fn new() -> Self {
        Self::from_tag_name(&format!("html_fragment_{}", random_marker_suffix()))
    }

    /// Fixed tag name, for tests and any future persistence.
    pub fn from_tag_name(tag_name: &str) -> Self {
        Self {
            tag_name: tag_name.to_string(),
        }
    }

    pub fn tag_name(&self) -> &str {
        &self.tag_name
    }

    pub fn open_tag(&self) -> String {
        format!("<{}>", self.tag_name)
    }

    pub fn close_tag(&self) -> String {
        format!("</{}>", self.tag_name)
    }

    fn escaped_open_tag(&self) -> String {
        format!("&lt;{}&gt;", self.tag_name)
    }

    fn escaped_close_tag(&self) -> String {
        format!("&lt;/{}&gt;", self.tag_name)
    }
}

impl Default for OutputMarker {
    fn default() -> Self {
        Self::new()
    }
}

fn random_marker_suffix() -> String {
    let hex = uuid::Uuid::new_v4().simple().to_string();
    hex[..8].to_string()
}

pub fn parse_rich_html_fragment_response(response: &str, marker: &OutputMarker) -> String {
    let unwrapped = extract_sentinel_fragment(response, marker);
    let stripped = strip_response_fence(unwrapped);
    repair_escaped_editor_html(&stripped)
}

pub fn sanitize_generated_rich_html(value: &str) -> String {
    sanitize_editor_html_fragment(value).trim().to_string()
}

/// The prompt asks the model to wrap its fragment in this generation's
/// [`OutputMarker`] so that preamble/postamble narration from chatty
/// providers can be dropped deterministically instead of relying on "return
/// only the fragment" compliance. Content between the first opening and last
/// closing marker wins; a missing closing marker (e.g. a truncated stream)
/// keeps everything after the opener. Fallbacks, in order: the escaped
/// marker form (a model that escapes its HTML is exactly the one the
/// downstream repair pass guards against), the generic `<html_fragment>`
/// marker (a model that drops the random suffix), its escaped form, and
/// finally the whole response for providers that ignore the instruction.
fn extract_sentinel_fragment<'a>(response: &'a str, marker: &OutputMarker) -> &'a str {
    extract_between(response, &marker.open_tag(), &marker.close_tag())
        .or_else(|| {
            extract_between(
                response,
                &marker.escaped_open_tag(),
                &marker.escaped_close_tag(),
            )
        })
        .or_else(|| extract_between(response, HTML_FRAGMENT_OPEN, HTML_FRAGMENT_CLOSE))
        .or_else(|| {
            extract_between(
                response,
                ESCAPED_HTML_FRAGMENT_OPEN,
                ESCAPED_HTML_FRAGMENT_CLOSE,
            )
        })
        .unwrap_or(response)
}

fn extract_between<'a>(response: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = response.find(open)? + open.len();
    let end = response[start..]
        .rfind(close)
        .map(|relative| start + relative)
        .unwrap_or(response.len());
    Some(&response[start..end])
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

/// Rewrites `src="..."` references the AI response echoed back in place of
/// the managed-attachment markup it was given (see `append_managed_images`
/// in prompt.rs) to the real `qa-scribe-attachment://{id}` form.
///
/// `relative_path` is always attachment-unique (it embeds the attachment's
/// UUID: `attachments/{session}/{id}_{filename}`), so matching on it is
/// always safe. Bare `filename` is not unique — two attachments can share a
/// filename (e.g. a screenshot re-uploaded under the same name) — so it is
/// only used to resolve a `src` when exactly one attachment in the whole set
/// has that filename. When a filename is ambiguous, any bare-filename
/// reference to it is left unrestored rather than guessed at: silently
/// attributing one attachment's evidence to another's id would be worse than
/// leaving a broken image for a human to notice and fix.
fn restore_known_attachment_sources(value: &str, attachments: &[Attachment]) -> String {
    let mut output = value.to_string();
    for attachment in attachments {
        if !attachment.relative_path.trim().is_empty() {
            output = replace_image_source(&output, &attachment.relative_path, &attachment.id);
        }
    }
    for attachment in attachments {
        if attachment.filename.trim().is_empty() {
            continue;
        }
        if !filename_is_unique(attachments, &attachment.filename) {
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

fn sanitize_editor_html_fragment(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut index = 0usize;

    while let Some(relative_start) = value[index..].find('<') {
        let tag_start = index + relative_start;
        output.push_str(&value[index..tag_start]);

        if value[tag_start..].starts_with("<!--") {
            if let Some(relative_end) = value[tag_start + 4..].find("-->") {
                index = tag_start + 4 + relative_end + 3;
            } else {
                break;
            }
            continue;
        }

        let Some(relative_end) = value[tag_start..].find('>') else {
            output.push_str("&lt;");
            index = tag_start + 1;
            continue;
        };
        let tag_end = tag_start + relative_end;
        let raw_tag = &value[tag_start + 1..tag_end];
        match sanitize_editor_tag(raw_tag) {
            SanitizedTag::Keep(html) => output.push_str(&html),
            SanitizedTag::SkipTag => {}
            SanitizedTag::SkipElement(tag_name) => {
                if let Some(after_close) = find_closing_tag_end(value, tag_end + 1, &tag_name) {
                    index = after_close;
                    continue;
                }
            }
        }
        index = tag_end + 1;
    }

    output.push_str(&value[index..]);
    output
}

enum SanitizedTag {
    Keep(String),
    SkipTag,
    SkipElement(String),
}

fn sanitize_editor_tag(raw_tag: &str) -> SanitizedTag {
    let trimmed = raw_tag.trim();
    if trimmed.is_empty() || trimmed.starts_with('!') || trimmed.starts_with('?') {
        return SanitizedTag::SkipTag;
    }

    let closing = trimmed.starts_with('/');
    let tag_body = if closing {
        trimmed[1..].trim_start()
    } else {
        trimmed
    };
    let tag_name = tag_name(tag_body).to_ascii_lowercase();
    if tag_name.is_empty() {
        return SanitizedTag::SkipTag;
    }

    if REMOVED_EDITOR_HTML_TAGS.contains(&tag_name.as_str()) {
        return if closing {
            SanitizedTag::SkipTag
        } else {
            SanitizedTag::SkipElement(tag_name)
        };
    }

    if !EDITOR_HTML_TAGS.contains(&tag_name.as_str()) {
        return SanitizedTag::SkipTag;
    }

    if closing {
        if SELF_CLOSING_EDITOR_HTML_TAGS.contains(&tag_name.as_str()) {
            return SanitizedTag::SkipTag;
        }
        return SanitizedTag::Keep(format!("</{tag_name}>"));
    }

    sanitize_opening_editor_tag(&tag_name, tag_body)
        .map(SanitizedTag::Keep)
        .unwrap_or(SanitizedTag::SkipTag)
}

fn tag_name(raw_tag: &str) -> &str {
    let end = raw_tag
        .find(|character: char| character.is_whitespace() || character == '/')
        .unwrap_or(raw_tag.len());
    &raw_tag[..end]
}

fn sanitize_opening_editor_tag(tag_name: &str, raw_tag: &str) -> Option<String> {
    match tag_name {
        "a" => Some(sanitize_link_tag(raw_tag)),
        "img" => sanitize_image_tag(raw_tag),
        "input" => sanitize_input_tag(raw_tag),
        "ul" => Some(sanitize_unordered_list_tag(raw_tag)),
        "li" => Some(sanitize_list_item_tag(raw_tag)),
        "br" => Some("<br>".to_string()),
        _ => Some(format!("<{tag_name}>")),
    }
}

fn sanitize_link_tag(raw_tag: &str) -> String {
    let Some(href) = attribute_value(raw_tag, "href") else {
        return "<a>".to_string();
    };
    let href = href.trim();
    if !is_safe_editor_link_url(href) {
        return "<a>".to_string();
    }
    format!(
        "<a href=\"{}\" target=\"_blank\" rel=\"noreferrer\">",
        escape_html_attribute(href)
    )
}

fn sanitize_image_tag(raw_tag: &str) -> Option<String> {
    let attachment_id = attribute_value(raw_tag, "data-attachment-id")
        .filter(|id| !id.trim().is_empty())
        .or_else(|| {
            attribute_value(raw_tag, "src").and_then(|src| {
                src.trim()
                    .strip_prefix(MANAGED_ATTACHMENT_PROTOCOL)
                    .filter(|id| !id.trim().is_empty())
                    .map(ToOwned::to_owned)
            })
        });
    let alt = attribute_value(raw_tag, "alt").unwrap_or_default();
    if let Some(id) = attachment_id {
        return Some(managed_image_html(id.trim(), alt.trim()));
    }

    let source = attribute_value(raw_tag, "src")?;
    let source = source.trim();
    if !is_safe_editor_image_source(source) {
        return None;
    }
    Some(image_html(source, alt.trim()))
}

fn sanitize_input_tag(raw_tag: &str) -> Option<String> {
    let input_type = attribute_value(raw_tag, "type")?
        .trim()
        .to_ascii_lowercase();
    if input_type != "checkbox" {
        return None;
    }
    let checked = attribute_value(raw_tag, "checked").is_some()
        || raw_tag.to_ascii_lowercase().contains(" checked");
    Some(if checked {
        "<input type=\"checkbox\" checked />".to_string()
    } else {
        "<input type=\"checkbox\" />".to_string()
    })
}

fn sanitize_unordered_list_tag(raw_tag: &str) -> String {
    if attribute_value(raw_tag, "data-type").as_deref() == Some("taskList") {
        "<ul data-type=\"taskList\">".to_string()
    } else {
        "<ul>".to_string()
    }
}

fn sanitize_list_item_tag(raw_tag: &str) -> String {
    if attribute_value(raw_tag, "data-type").as_deref() != Some("taskItem") {
        return "<li>".to_string();
    }
    let checked = matches!(
        attribute_value(raw_tag, "data-checked").as_deref(),
        Some("true")
    );
    format!(
        "<li data-type=\"taskItem\" data-checked=\"{}\">",
        if checked { "true" } else { "false" }
    )
}

fn is_safe_editor_link_url(source: &str) -> bool {
    is_safe_url_with_protocols(source, &["http", "https", "mailto"])
}

fn is_safe_editor_image_source(source: &str) -> bool {
    source.starts_with(MANAGED_ATTACHMENT_PROTOCOL)
        || source.to_ascii_lowercase().starts_with("data:image/")
        || is_safe_url_with_protocols(source, &["http", "https"])
}

fn is_safe_url_with_protocols(source: &str, protocols: &[&str]) -> bool {
    let source = source.trim();
    if source.is_empty() || source.chars().any(|character| character.is_control()) {
        return false;
    }
    let protocol_end = source.find(':');
    let first_path_separator = source
        .find(|character| ['/', '?', '#'].contains(&character))
        .unwrap_or(source.len());
    let Some(protocol_end) = protocol_end.filter(|end| *end < first_path_separator) else {
        return true;
    };
    let protocol = source[..protocol_end].to_ascii_lowercase();
    protocols.contains(&protocol.as_str())
}

fn find_closing_tag_end(value: &str, start: usize, tag_name: &str) -> Option<usize> {
    let needle = format!("</{tag_name}");
    let relative_start = find_case_insensitive(&value[start..], &needle)?;
    let close_start = start + relative_start;
    let close_end = value[close_start..].find('>')?;
    Some(close_start + close_end + 1)
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
