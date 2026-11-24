//! Ask AI's view of the Session Note: editor HTML as the Markdown that `chat::markdown` reads
//! back, so a rewrite keeps heading levels, lists, marks, code, quotes, rules and each managed
//! image in place. Generate and Summarize keep the plain projection in `html_projection.rs`.
use super::html::{
    MANAGED_ATTACHMENT_PROTOCOL, attribute_value, decode_html_entities, find_case_insensitive,
    find_html_tag_end,
};
use super::html_projection::{project_html_to_prompt_text, redact_data_urls};

mod list;
mod table;
use list::list;
use table::table;

const VOID_TAGS: &[&str] = &["br", "hr", "img", "input"];
/// Elements nested deeper than the Markdown parser follows make the Note fall back to the plain
/// projection, so the recursive walk and drop of the tree stay within the thread stack.
const MAX_DEPTH: usize = crate::chat::markdown::MAX_NESTING;

enum Node {
    Element {
        name: String,
        tag: String,
        children: Vec<Node>,
    },
    Text(String),
}

pub fn project_html_to_prompt_markdown(value: &str) -> String {
    project_html_to_rewritable_markdown(value).unwrap_or_else(|| project_html_to_prompt_text(value))
}

/// The Markdown projection, or `None` when the Note nests deeper than the Markdown parser reads
/// back: Ask AI then sees the plain projection and may not rewrite the whole Note from it.
pub fn project_html_to_rewritable_markdown(value: &str) -> Option<String> {
    let markdown = blocks(&parse(value)?.iter().collect::<Vec<_>>()).join("\n\n");
    crate::chat::markdown::within_nesting(&markdown).then_some(markdown)
}

/// The element tree, or `None` when elements nest deeper than `MAX_DEPTH`.
fn parse(source: &str) -> Option<Vec<Node>> {
    // Each open element with its raw tag and children; the root has no name.
    let mut stack: Vec<(String, String, Vec<Node>)> = vec![(String::new(), String::new(), vec![])];
    let mut index = 0usize;
    while let Some(relative) = source[index..].find('<') {
        let start = index + relative;
        push_text(&mut stack, &source[index..start]);
        let Some(end) = find_html_tag_end(source, start + 1) else {
            push_text(&mut stack, &source[start..]);
            index = source.len();
            break;
        };
        let raw = source[start + 1..end].trim();
        index = end + 1;
        if raw.starts_with('!') || raw.starts_with('?') {
            continue;
        }
        let closing = raw.starts_with('/');
        let name: String = raw
            .trim_start_matches('/')
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_ascii_lowercase();
        if name.is_empty() {
            continue;
        }
        if closing {
            if let Some(position) = stack.iter().rposition(|(open, ..)| *open == name) {
                while stack.len() > position {
                    close(&mut stack);
                }
            }
        } else if name == "script" || name == "style" {
            if let Some(close_start) = find_case_insensitive(&source[index..], &format!("</{name}"))
            {
                index += close_start;
            }
        } else if VOID_TAGS.contains(&name.as_str()) {
            let element = Node::Element {
                name,
                tag: raw.to_string(),
                children: vec![],
            };
            stack.last_mut().unwrap().2.push(element);
        } else if stack.len() > MAX_DEPTH {
            return None;
        } else {
            stack.push((name, raw.to_string(), vec![]));
        }
    }
    push_text(&mut stack, &source[index..]);
    while stack.len() > 1 {
        close(&mut stack);
    }
    stack.pop().map(|(.., nodes)| nodes)
}

fn push_text(stack: &mut [(String, String, Vec<Node>)], text: &str) {
    if !text.is_empty() {
        let decoded = redact_data_urls(&decode_html_entities(text));
        stack.last_mut().unwrap().2.push(Node::Text(decoded));
    }
}

fn close(stack: &mut Vec<(String, String, Vec<Node>)>) {
    let (name, tag, children) = stack.pop().unwrap();
    stack.last_mut().unwrap().2.push(Node::Element {
        name,
        tag,
        children,
    });
}

fn is_block(node: &Node) -> bool {
    matches!(node, Node::Element { name, .. } if matches!(name.as_str(),
        "p" | "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "ul" | "ol" | "li" | "pre"
            | "blockquote" | "hr" | "img" | "table" | "section" | "article"))
}

/// Block-level Markdown, one entry per block. Loose inline content becomes a paragraph.
fn blocks(nodes: &[&Node]) -> Vec<String> {
    kinded_blocks(nodes)
        .into_iter()
        .map(|(block, _)| block)
        .collect()
}

/// Each block with whether it is a list that stays tight under a list item: CommonMark reads an
/// ordered list starting past 1 right after a line as that line's text, and a bare marker (an
/// item starting with a divider) turns that line into a heading.
fn kinded_blocks(nodes: &[&Node]) -> Vec<(String, bool)> {
    let mut result = vec![];
    let mut inline_run: Vec<&Node> = vec![];
    let flush = |run: &mut Vec<&Node>, result: &mut Vec<(String, bool)>| {
        let text = paragraph(run.iter().copied());
        if !text.is_empty() {
            result.push((text, false));
        }
        run.clear();
    };
    for &node in nodes {
        if !is_block(node) {
            inline_run.push(node);
            continue;
        }
        flush(&mut inline_run, &mut result);
        let Node::Element {
            name,
            tag,
            children,
        } = node
        else {
            continue;
        };
        let block = match name.as_str() {
            "ul" | "ol" => list(name, tag, children),
            "pre" => code_block(children),
            "blockquote" => quote(children),
            "hr" => "---".into(),
            "table" => table(children),
            "img" => image(tag),
            heading if heading.starts_with('h') => heading_line(heading, children),
            "p" => paragraph(children.iter()),
            _ => blocks(&children.iter().collect::<Vec<_>>()).join("\n\n"),
        };
        if !block.is_empty() {
            let bare_marker = block.lines().next().is_some_and(|line| !line.contains(' '));
            let tight = !bare_marker && (name == "ul" || (name == "ol" && list::start(tag) == 1));
            result.push((block, tight));
        }
    }
    flush(&mut inline_run, &mut result);
    result
}

/// Inline content with HTML white space collapsed outside code spans and each line trimmed.
fn paragraph<'a>(nodes: impl Iterator<Item = &'a Node>) -> String {
    join_inline(nodes.map(inline))
        .split('\n')
        .map(|line| escape_line_start(line.trim()))
        .collect::<Vec<_>>()
        .join("\n")
        .trim_matches('\n')
        .to_string()
}

/// A heading on its one ATX line: a hard break reads as a space, so the whole heading stays the
/// case title, and a line start opens no block there. A trailing `#` run after a space, or as the
/// whole text, would close the heading, so its first `#` is escaped.
fn heading_line(name: &str, children: &[Node]) -> String {
    let marker = "#".repeat(name[1..].parse::<usize>().unwrap_or(2));
    let text = join_inline(children.iter().map(inline))
        .split('\n')
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let body = text.trim_end_matches('#');
    if text.is_empty() {
        String::new()
    } else if body.len() < text.len() && (body.is_empty() || body.ends_with(' ')) {
        format!("{marker} {body}\\{}", &text[body.len()..])
    } else {
        format!("{marker} {text}")
    }
}

fn inline(node: &Node) -> String {
    let (name, tag, children) = match node {
        Node::Text(text) => return escape_text(&collapse_whitespace(text)),
        Node::Element {
            name,
            tag,
            children,
        } => (name.as_str(), tag, children),
    };
    let content = join_inline(children.iter().map(inline));
    // Delimiters go inside an underline that covers all the content: within a word, a delimiter
    // next to `<` neither opens nor closes. Text escapes its `<`, so a `<u>` here is the mark.
    let wrap = |marker: &str| {
        outside_spaces(&content, |inner| {
            match inner
                .strip_prefix("<u>")
                .and_then(|rest| rest.strip_suffix("</u>"))
            {
                Some(underlined) if !underlined.contains("</u>") => {
                    format!("<u>{marker}{underlined}{marker}</u>")
                }
                _ => format!("{marker}{inner}{marker}"),
            }
        })
    };
    match name {
        "br" => "\n".into(),
        "img" => image(tag),
        "strong" | "b" => wrap("**"),
        "em" | "i" => wrap("*"),
        "s" => wrap("~~"),
        "code" => code_span(&raw_text(children).replace(['\n', '\r', '\t'], " ")),
        "u" => outside_spaces(&content, |inner| format!("<u>{inner}</u>")),
        "a" => match attribute_value(tag, "href").map(|href| href.trim().to_string()) {
            Some(href) if safe_link(&href) && !content.trim().is_empty() => {
                format!("[{content}]({})", link_destination(&href))
            }
            _ => content,
        },
        _ => content,
    }
}

/// HTML white space: each run of it reads as one space.
fn collapse_whitespace(text: &str) -> String {
    let mut collapsed = String::with_capacity(text.len());
    for character in text.chars() {
        if !character.is_whitespace() {
            collapsed.push(character);
        } else if !collapsed.ends_with(' ') {
            collapsed.push(' ');
        }
    }
    collapsed
}

/// Joins inline Markdown with one space where two pieces meet at spaces. A code span starts and
/// ends with a backtick, so its spaces are never touched. Text escapes its own `[`, so a piece
/// starting with one opens a link, and a literal `!` before it would make that an image.
fn join_inline(pieces: impl Iterator<Item = String>) -> String {
    let mut joined = String::new();
    for piece in pieces {
        if piece.starts_with('[') && joined.ends_with('!') {
            joined.insert(joined.len() - 1, '\\');
        }
        let piece = if joined.ends_with(' ') {
            piece.trim_start_matches(' ')
        } else {
            &piece
        };
        joined.push_str(piece);
    }
    joined
}

/// Backslash-escapes the characters that would start inline Markdown, so literal text in the
/// Note reads back as the same text. Line starts are handled by `escape_line_start`.
fn escape_text(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut escaped = String::with_capacity(text.len());
    for (index, &character) in chars.iter().enumerate() {
        let escape = match character {
            '\\' | '`' | '*' | '[' | ']' | '<' | '~' | '|' => true,
            // `_` between two letters or digits never opens or closes emphasis.
            '_' => {
                !(index > 0
                    && chars[index - 1].is_alphanumeric()
                    && chars
                        .get(index + 1)
                        .is_some_and(|next| next.is_alphanumeric()))
            }
            '&' => {
                let name = chars[index + 1..]
                    .iter()
                    .take_while(|next| next.is_ascii_alphanumeric() || **next == '#')
                    .count();
                name > 0 && chars.get(index + 1 + name) == Some(&';')
            }
            _ => false,
        };
        if escape {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

/// Escapes a line start that would open a block: heading, quote, list item, rule or setext
/// underline. Inline escaping already covers `*`, `_`, backticks, `~` and `|`.
fn escape_line_start(line: &str) -> String {
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    let mut rest = line[digits..].chars();
    let marker = rest.next();
    let spaced = rest.next().is_none_or(char::is_whitespace);
    let escape_at = match marker {
        Some('.' | ')') if digits > 0 && spaced => Some(digits),
        Some('#' | '>' | '=') if digits == 0 => Some(0),
        Some('-' | '+') if digits == 0 && (spaced || line[1..].starts_with('-')) => Some(0),
        _ => None,
    };
    match escape_at {
        Some(at) => format!("{}\\{}", &line[..at], &line[at..]),
        None => line.to_string(),
    }
}

/// Wraps the content without its edge white space, which stays outside the delimiters: a
/// delimiter next to a space does not open or close emphasis or strikethrough. White space
/// alone stays unwrapped.
fn outside_spaces(content: &str, wrap: impl Fn(&str) -> String) -> String {
    let inner = content.trim();
    if inner.is_empty() {
        return content.to_string();
    }
    let start = content.len() - content.trim_start().len();
    let end = content.trim_end().len();
    format!("{}{}{}", &content[..start], wrap(inner), &content[end..])
}

/// A code span whose backtick fence is longer than any backtick run inside it, padded with a
/// space when the code starts or ends with a backtick, or with a space while holding more than
/// spaces, since CommonMark strips one space each side then.
fn code_span(code: &str) -> String {
    let longest = code
        .split(|character| character != '`')
        .map(str::len)
        .max()
        .unwrap_or(0);
    let fence = "`".repeat(longest + 1);
    let spaced = code.starts_with(' ') && code.ends_with(' ') && !code.trim_matches(' ').is_empty();
    let pad = if code.starts_with('`') || code.ends_with('`') || spaced {
        " "
    } else {
        ""
    };
    format!("{fence}{pad}{code}{pad}{fence}")
}

/// White space is percent-encoded, as a browser reads it, since the parser links no URL with a
/// space. A destination with parentheses, angle brackets or backslashes goes in angle brackets,
/// where `<`, `>` and `\` are escaped; `&` is escaped in both forms so no entity is decoded.
fn link_destination(href: &str) -> String {
    let bracketed = href.contains(|c: char| "()<>\\".contains(c));
    let mut escaped = String::with_capacity(href.len() + 2);
    if bracketed {
        escaped.push('<');
    }
    for character in href.chars() {
        if character.is_ascii_whitespace() {
            escaped.push_str(&format!("%{:02X}", character as u32));
            continue;
        }
        if character == '&' || (bracketed && "<>\\".contains(character)) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    if bracketed {
        escaped.push('>');
    }
    escaped
}

fn safe_link(href: &str) -> bool {
    let lower = href.to_ascii_lowercase();
    ["http://", "https://", "mailto:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme))
}

fn code_block(children: &[Node]) -> String {
    // The parser drops only the line end before the closing fence, so trailing newlines stay.
    let code = raw_text(children);
    let mut fence = "```".to_string();
    while code.contains(&fence) {
        fence.push('`');
    }
    format!("{fence}\n{code}\n{fence}")
}

fn raw_text(nodes: &[Node]) -> String {
    nodes
        .iter()
        .map(|node| match node {
            Node::Text(text) => text.clone(),
            Node::Element { name, .. } if name == "br" => "\n".into(),
            Node::Element { children, .. } => raw_text(children),
        })
        .collect()
}

fn quote(children: &[Node]) -> String {
    blocks(&children.iter().collect::<Vec<_>>())
        .join("\n\n")
        .split('\n')
        .map(|line| {
            if line.is_empty() {
                ">".to_string()
            } else {
                format!("> {line}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn image(tag: &str) -> String {
    let alt = attribute_value(tag, "alt")
        .map(|alt| alt.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|alt| !alt.is_empty());
    let source = attribute_value(tag, "src").unwrap_or_default();
    let managed = attribute_value(tag, "data-attachment-id")
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .or_else(|| {
            source
                .trim()
                .strip_prefix(MANAGED_ATTACHMENT_PROTOCOL)
                .map(str::to_string)
        });
    if let Some(id) = managed {
        let alt = alt.unwrap_or_else(|| "Attached image".into());
        return format!(
            "![{}]({MANAGED_ATTACHMENT_PROTOCOL}{id})",
            alt.replace('[', "(").replace(']', ")")
        );
    }
    match alt {
        Some(alt) if !source.trim().to_ascii_lowercase().starts_with("data:") => {
            format!("[Image: {alt}]")
        }
        _ => "[Image]".into(),
    }
}
