//! Detects editor HTML that a model returned entity-escaped, so it can be decoded once.
use super::{EDITOR_HTML_TAGS, SELF_CLOSING_EDITOR_HTML_TAGS};

pub(super) fn should_decode_escaped_editor_html(value: &str) -> bool {
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
