//! Shared HTML utilities for the generation prompt/response pipeline.
//!
//! `prompt.rs`, `response.rs`, and `html_projection.rs` all need to scan
//! hand-rolled HTML fragments (attribute parsing, entity decoding,
//! case-insensitive search, attribute escaping). This module is the single
//! source of truth for that machinery so the three call sites stay in sync.

/// URI scheme used for `<img>` sources that point at a managed attachment
/// rather than an external URL or filesystem path.
pub(super) const MANAGED_ATTACHMENT_PROTOCOL: &str = "qa-scribe-attachment://";

/// [`MANAGED_ATTACHMENT_PROTOCOL`] as an owned `String`, for exporting as a
/// typed bindings constant (see `specta_bindings::builder`). The frontend's
/// `managedAttachmentProtocol` in `editor/editorHtml.ts` derives from this
/// instead of restating the literal, so the two can never drift.
pub fn managed_attachment_protocol() -> String {
    MANAGED_ATTACHMENT_PROTOCOL.to_string()
}

/// Advance `index` past any whitespace in `value`, returning the new index.
pub(super) fn skip_whitespace(value: &str, mut index: usize) -> usize {
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

/// Extract the value of `attribute` from a raw (already `<`/`>`-stripped)
/// tag body, e.g. `img src="foo.png" alt="bar"`. Attribute values are
/// entity-decoded (using the wide [`decode_html_entities`] decoder) before
/// being returned. Returns `None` if the attribute is not present.
///
/// Used by `html_projection.rs`, where maximal entity decoding is desired
/// when projecting HTML to plain prompt text. The response-repair path in
/// `response.rs` needs narrower decoding and uses
/// [`attribute_value_with_decoder`] with [`decode_basic_html_entities`]
/// instead.
pub(super) fn attribute_value(raw_tag: &str, attribute: &str) -> Option<String> {
    attribute_value_with_decoder(raw_tag, attribute, decode_html_entities)
}

/// Same as [`attribute_value`], but decodes the extracted value with the
/// given `decoder` instead of always using the wide entity set. This lets
/// callers that must not widen entity decoding (e.g. the response-repair
/// path, which historically only decoded six structural entities) reuse the
/// same attribute-parsing state machine without duplicating it.
pub(super) fn attribute_value_with_decoder(
    raw_tag: &str,
    attribute: &str,
    decoder: impl Fn(&str) -> String,
) -> Option<String> {
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
            return Some(decoder(&value));
        }
    }
    None
}

/// Decode HTML entities in `value` using the wide entity set: the standard
/// XML set (`amp`, `lt`, `gt`, `quot`, `apos`/`#39`), common typographic
/// entities (`nbsp`, `ndash`/`mdash`, `hellip`, curly quotes), and numeric
/// character references (`&#39;`, `&#x27;`). Unknown entities are left
/// untouched.
///
/// Used for projecting stored HTML into plain prompt text
/// (`html_projection.rs`), where maximal decoding is desirable: prompt text
/// is read-only material handed to the model, so turning `&mdash;` into `-`
/// or `&hellip;` into `...` only improves readability and there is no
/// stored-content fidelity to preserve.
///
/// Do **not** use this on the response-repair path (`response.rs`). That
/// path rewrites LLM output back into the editor's stored HTML, and widening
/// its entity decoding would silently alter stored content that pre-refactor
/// behavior left untouched (typographic entities, curly quotes, numeric
/// references). Use [`decode_basic_html_entities`] there instead.
pub(super) fn decode_html_entities(value: &str) -> String {
    decode_entities_with(value, decode_entity)
}

/// Decode only the six structural HTML entities `&quot;`, `&#39;`, `&apos;`,
/// `&lt;`, `&gt;`, `&amp;` in `value`. All other entities (typographic
/// entities like `&nbsp;`/`&mdash;`/`&hellip;`, curly quotes, and numeric
/// character references) are left as literal text.
///
/// Used by the response-repair path (`response.rs`) when unescaping HTML
/// that an LLM returned double-escaped (e.g. `&lt;p&gt;`). That path writes
/// the result back into stored note content, so it must only undo the
/// structural escaping it is trying to repair — decoding typographic
/// entities here would rewrite characters the user (or a prior editor pass)
/// deliberately encoded, which is not this pass's job.
///
/// This is implemented as a sequential chain of exact substring replacements
/// (one per entity, in a fixed order), not as the scan-one-entity-at-a-time
/// loop that backs [`decode_html_entities`]. That is deliberate, not
/// laziness: on malformed input containing stray `&`/`;` characters (which
/// LLM output can and does produce), the two algorithms disagree — e.g. for
/// `"&lt;&amp&&amp;"`, chained `.replace()` calls only ever match an exact
/// `&amp;` substring and leave the dangling `&amp&` alone, while a
/// scan-to-next-`;` loop would swallow `&amp&&amp;` as a single (unknown,
/// left-untouched) entity candidate, dropping a `;` that `.replace()` would
/// have kept. This function must stay byte-identical to the pre-refactor
/// `decode_basic_html_entities`, so it keeps that exact replace-chain
/// behavior rather than being unified with the scanning implementation.
pub(super) fn decode_basic_html_entities(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// Shared scanning loop: find each `&...;` run in `value` and hand the inner
/// entity name to `lookup`, falling back to leaving the run untouched when
/// `lookup` returns `None`. Only [`decode_html_entities`] uses this — see
/// [`decode_basic_html_entities`]'s doc comment for why the repair-path
/// decoder deliberately does *not* share this loop.
fn decode_entities_with(value: &str, lookup: impl Fn(&str) -> Option<String>) -> String {
    let mut output = String::with_capacity(value.len());
    let mut index = 0usize;
    while let Some(relative_start) = value[index..].find('&') {
        let start = index + relative_start;
        output.push_str(&value[index..start]);
        let Some(relative_end) = value[start..].find(';') else {
            output.push_str(&value[start..]);
            return output;
        };
        let end = start + relative_end;
        if end - start > 32 {
            output.push('&');
            index = start + 1;
            continue;
        }
        let entity = &value[start + 1..end];
        match lookup(entity) {
            Some(decoded) => output.push_str(&decoded),
            None => output.push_str(&value[start..=end]),
        }
        index = end + 1;
    }
    output.push_str(&value[index..]);
    output
}

fn decode_entity(entity: &str) -> Option<String> {
    match entity {
        "amp" => Some("&".to_string()),
        "lt" => Some("<".to_string()),
        "gt" => Some(">".to_string()),
        "quot" => Some("\"".to_string()),
        "apos" | "#39" => Some("'".to_string()),
        "nbsp" => Some(" ".to_string()),
        "ndash" | "mdash" => Some("-".to_string()),
        "hellip" => Some("...".to_string()),
        "lsquo" | "rsquo" => Some("'".to_string()),
        "ldquo" | "rdquo" => Some("\"".to_string()),
        _ => decode_numeric_entity(entity),
    }
}

fn decode_numeric_entity(entity: &str) -> Option<String> {
    let number = if let Some(hex) = entity
        .strip_prefix("#x")
        .or_else(|| entity.strip_prefix("#X"))
    {
        u32::from_str_radix(hex, 16).ok()?
    } else {
        let decimal = entity.strip_prefix('#')?;
        decimal.parse::<u32>().ok()?
    };
    char::from_u32(number).map(|character| character.to_string())
}

/// Escape `&`, `"`, `<`, `>` for safe inclusion inside an HTML attribute
/// value.
pub(super) fn escape_html_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Case-insensitive substring search. Returns the byte offset of the first
/// match, if any, without allocating a lowercased copy of the remainder of
/// `haystack` for every candidate position.
///
/// `needle` is always an ASCII literal at every call site (`"data:"`,
/// `"<img"`, `"</script>"`/`"</style>"` tag names). Comparisons are done on
/// raw bytes via `eq_ignore_ascii_case`, never through `str` slicing, so a
/// candidate window is never rejected (or panicked on) for landing in the
/// middle of a multi-byte UTF-8 character in `haystack` — the byte-level
/// comparison simply reports "not equal" instead of panicking. This also
/// means an explicit `is_char_boundary` guard is unnecessary: an ASCII
/// needle byte (`< 0x80`) can only compare equal to a `haystack` byte that
/// is itself `< 0x80`, and every UTF-8 continuation byte is `>= 0x80`, so a
/// full match can never end (or start) inside a multi-byte character. Any
/// `Some(start)` returned is therefore guaranteed to be a valid char
/// boundary in the original `haystack`, preserving the contract relied on
/// by all three call sites that slice `haystack` at the returned offset.
pub(super) fn find_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    let haystack_bytes = haystack.as_bytes();
    let needle_bytes = needle.as_bytes();
    let needle_len = needle_bytes.len();
    if needle_len > haystack_bytes.len() {
        return None;
    }
    for start in 0..=haystack_bytes.len() - needle_len {
        if haystack_bytes[start..start + needle_len].eq_ignore_ascii_case(needle_bytes) {
            return Some(start);
        }
    }
    None
}

#[cfg(test)]
mod tests;
