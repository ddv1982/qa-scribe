//! Convert only newly submitted assistant Markdown into the existing editor schema.
//! HTML is derived from the same nodes as JSON; no raw provider HTML is trusted.
use crate::{Result, error::validation, generation::managed_attachment_protocol};
use pulldown_cmark::{Event, Options, Parser, Tag};
use serde_json::{Value, json};

mod html;
pub(crate) use html::to_html;
#[cfg(test)]
mod tests;

struct Frame<'a> {
    tag: Option<Tag<'a>>,
    nodes: Vec<Value>,
    checked: Option<bool>,
    /// An open `<u>` inline HTML tag, the one inline HTML form kept as a mark.
    underline: bool,
}

impl<'a> Frame<'a> {
    fn new(tag: Option<Tag<'a>>, underline: bool) -> Self {
        Self {
            tag,
            nodes: vec![],
            checked: None,
            underline,
        }
    }
}

/// Open Markdown elements the parser follows. Deeper input reads back as literal text, so the
/// recursive renderers stay within the thread stack. The Ask AI Notes projection keeps to it.
pub(crate) const MAX_NESTING: usize = 47;

/// Whether the parser reads `text` as Markdown, not as literal text for nesting too deep.
pub(crate) fn within_nesting(text: &str) -> bool {
    matches!(parse_events(text, None), Ok(Some(_)))
}

pub(crate) fn literal(text: &str) -> Vec<Value> {
    vec![node("paragraph", text_nodes(text))]
}

/// Assistant Markdown for display. Images become their alt text.
pub(crate) fn parse(text: &str) -> Vec<Value> {
    parse_inner(text, None).expect("display parsing places no images")
}

/// A rewrite of a record or the Note. A managed image (`![alt](qa-scribe-attachment://<id>)`)
/// becomes the `known` image node with that id, in place; an unknown id refuses the reply.
pub(crate) fn parse_with_images(text: &str, known: &[Value]) -> Result<Vec<Value>> {
    parse_inner(text, Some(known))
}

fn parse_inner(text: &str, images: Option<&[Value]>) -> Result<Vec<Value>> {
    Ok(parse_events(text, images)?.unwrap_or_else(|| literal(text)))
}

/// The editor nodes, or `None` when elements nest deeper than `MAX_NESTING`.
fn parse_events(text: &str, images: Option<&[Value]>) -> Result<Option<Vec<Value>>> {
    let options =
        Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS | Options::ENABLE_STRIKETHROUGH;
    let mut stack = vec![Frame::new(None, false)];
    for event in Parser::new_ext(text, options) {
        match event {
            Event::Start(tag) => {
                // The root frame is not an element, so `stack.len()` counts this one too.
                if stack.len() > MAX_NESTING {
                    return Ok(None);
                }
                stack.push(Frame::new(Some(tag), false));
            }
            Event::End(_) => {
                close_underline(&mut stack);
                let frame = stack.pop().expect("balanced Markdown parser events");
                let nodes = match (&frame.tag, images) {
                    (Some(Tag::Image { dest_url, .. }), Some(known))
                        if dest_url.starts_with(&managed_attachment_protocol()) =>
                    {
                        vec![known_image(known, dest_url)?]
                    }
                    _ => finish(frame),
                };
                stack.last_mut().unwrap().nodes.extend(nodes);
            }
            Event::TaskListMarker(checked) => {
                if let Some(item) = stack
                    .iter_mut()
                    .rev()
                    .find(|frame| matches!(frame.tag, Some(Tag::Item)))
                {
                    item.checked = Some(checked);
                }
            }
            Event::Text(value) if matches!(stack.last().unwrap().tag, Some(Tag::CodeBlock(_))) => {
                stack
                    .last_mut()
                    .unwrap()
                    .nodes
                    .push(json!({"type":"text", "text":value.as_ref()}));
            }
            Event::Code(value) => stack
                .last_mut()
                .unwrap()
                .nodes
                .push(json!({"type":"text", "text":value.as_ref(), "marks":[{"type":"code"}]})),
            Event::InlineHtml(value) if value.eq_ignore_ascii_case("<u>") => {
                if stack.len() > MAX_NESTING {
                    return Ok(None);
                }
                stack.push(Frame::new(None, true));
            }
            Event::InlineHtml(value)
                if value.eq_ignore_ascii_case("</u>") && stack.last().unwrap().underline =>
            {
                let mut frame = stack.pop().unwrap();
                mark(&mut frame.nodes, json!({"type":"underline"}));
                stack.last_mut().unwrap().nodes.extend(frame.nodes);
            }
            Event::Text(value) | Event::Html(value) | Event::InlineHtml(value) => {
                stack.last_mut().unwrap().nodes.extend(text_nodes(&value));
            }
            Event::SoftBreak | Event::HardBreak => stack
                .last_mut()
                .unwrap()
                .nodes
                .push(json!({"type":"hardBreak"})),
            Event::Rule => stack
                .last_mut()
                .unwrap()
                .nodes
                .push(json!({"type":"horizontalRule"})),
            _ => {}
        }
    }
    close_underline(&mut stack);
    let mut nodes = blocks(stack.pop().unwrap().nodes);
    merge_text(&mut nodes);
    Ok(Some(nodes))
}

fn known_image(known: &[Value], source: &str) -> Result<Value> {
    let id = &source[managed_attachment_protocol().len()..];
    known
        .iter()
        .find(|node| node["attrs"]["attachmentId"] == id || node["attrs"]["src"] == source)
        .cloned()
        .ok_or_else(|| validation("The suggestion refers to an image that is not in this content"))
}

/// Images are blocks in the editor, so an image inside a paragraph, heading or flattened table
/// row splits it.
fn without_inline_images(kind: &str, attrs: Option<Value>, nodes: Vec<Value>) -> Vec<Value> {
    let mut result = vec![];
    let mut run = vec![];
    let flush = |run: &mut Vec<Value>, result: &mut Vec<Value>, last: bool| {
        let blank = run.iter().all(|n| {
            n["type"] == "hardBreak" || n["text"].as_str().is_some_and(|t| t.trim().is_empty())
        });
        if !blank || (last && result.is_empty()) {
            let mut block = node(kind, std::mem::take(run));
            if let Some(attrs) = &attrs {
                block["attrs"] = attrs.clone();
            }
            result.push(block);
        }
        run.clear();
    };
    for value in nodes {
        if value["type"] == "image" {
            flush(&mut run, &mut result, false);
            result.push(value);
        } else {
            run.push(value);
        }
    }
    flush(&mut run, &mut result, true);
    result
}

/// An `<u>` without its `</u>` before the enclosing element ends stays literal text.
fn close_underline(stack: &mut Vec<Frame<'_>>) {
    while stack.last().is_some_and(|frame| frame.underline) {
        let frame = stack.pop().unwrap();
        let parent = &mut stack.last_mut().unwrap().nodes;
        parent.push(json!({"type":"text","text":"<u>"}));
        parent.extend(frame.nodes);
    }
}

fn finish(mut frame: Frame<'_>) -> Vec<Value> {
    let tag = frame.tag.unwrap();
    match tag {
        Tag::Paragraph | Tag::HtmlBlock => without_inline_images("paragraph", None, frame.nodes),
        Tag::CodeBlock(_) => {
            let code: String = frame
                .nodes
                .iter()
                .filter_map(|node| node["text"].as_str())
                .collect();
            let code = code.strip_suffix('\n').unwrap_or(&code);
            let content = if code.is_empty() {
                vec![]
            } else {
                vec![json!({"type":"text","text":code})]
            };
            vec![json!({"type":"codeBlock", "attrs":{"language":null}, "content":content})]
        }
        Tag::BlockQuote(_) => {
            let mut children = blocks(frame.nodes);
            if children.is_empty() {
                children.push(node("paragraph", vec![]));
            }
            vec![node("blockquote", children)]
        }
        Tag::Heading { level, .. } => {
            without_inline_images("heading", Some(json!({"level":level as u8})), frame.nodes)
        }
        Tag::Strong | Tag::Emphasis | Tag::Strikethrough => {
            let kind = match tag {
                Tag::Strong => "bold",
                Tag::Emphasis => "italic",
                _ => "strike",
            };
            mark(&mut frame.nodes, json!({"type":kind}));
            frame.nodes
        }
        Tag::Link { dest_url, .. } => {
            if safe_url(&dest_url) {
                mark(
                    &mut frame.nodes,
                    json!({"type":"link", "attrs":{"href":dest_url.as_ref(), "target":"_blank", "rel":"noopener noreferrer"}}),
                );
            }
            frame.nodes
        }
        Tag::Item => {
            let children = blocks(frame.nodes);
            if let Some(checked) = frame.checked {
                // The current TaskItem extension disallows nested block lists.
                vec![
                    json!({"type":"taskItem", "attrs":{"checked":checked}, "content":task_item_content(children)}),
                ]
            } else {
                let mut children = children;
                if children.first().is_none_or(|n| n["type"] != "paragraph") {
                    children.insert(0, node("paragraph", vec![]));
                }
                vec![node("listItem", children)]
            }
        }
        Tag::List(start) => lists(frame.nodes, start),
        Tag::TableHead | Tag::TableRow => {
            // Each cell contributes a separator; remove only the final separator.
            if frame.nodes.last().is_some_and(|n| n["text"] == " | ") {
                frame.nodes.pop();
            }
            without_inline_images("paragraph", None, frame.nodes)
        }
        Tag::TableCell => {
            frame.nodes.push(json!({"type":"text","text":" | "}));
            frame.nodes
        }
        // Images become their alt-text children.
        _ => frame.nodes,
    }
}

fn node(kind: &str, content: Vec<Value>) -> Value {
    json!({"type":kind, "content":content})
}

fn text_nodes(text: &str) -> Vec<Value> {
    let mut nodes = vec![];
    for (index, line) in text.split('\n').enumerate() {
        if index > 0 {
            nodes.push(json!({"type":"hardBreak"}));
        }
        if !line.is_empty() {
            nodes.push(json!({"type":"text", "text":line}));
        }
    }
    nodes
}

/// The editor's code mark excludes every other mark, so code text takes no further mark.
fn mark(nodes: &mut [Value], value: Value) {
    for node in nodes {
        let is_code = node["marks"]
            .as_array()
            .is_some_and(|marks| marks.iter().any(|mark| mark["type"] == "code"));
        if node["type"] == "text" && !is_code {
            if node.get("marks").is_none() {
                node["marks"] = json!([]);
            }
            node["marks"].as_array_mut().unwrap().push(value.clone());
        }
    }
}

fn safe_url(source: &str) -> bool {
    !source.chars().any(|c| c.is_ascii_control() || c == ' ')
        && url::Url::parse(source)
            .is_ok_and(|url| matches!(url.scheme(), "http" | "https" | "mailto"))
}

// Tight-list text events do not have paragraph start/end events.
fn blocks(nodes: Vec<Value>) -> Vec<Value> {
    let mut result = vec![];
    let mut inline = vec![];
    for value in nodes {
        if matches!(value["type"].as_str(), Some("text" | "hardBreak")) {
            inline.push(value);
        } else {
            if !inline.is_empty() {
                result.push(node("paragraph", std::mem::take(&mut inline)));
            }
            result.push(value);
        }
    }
    if !inline.is_empty() {
        result.push(node("paragraph", inline));
    }
    result
}

/// A task item's content: `paragraph (paragraph | image)*`, in document order.
fn task_item_content(nodes: Vec<Value>) -> Vec<Value> {
    let mut result = vec![];
    paragraphs_and_images(nodes, &mut result);
    if result.first().is_none_or(|n| n["type"] != "paragraph") {
        result.insert(0, node("paragraph", vec![]));
    }
    result
}

fn paragraphs_and_images(nodes: Vec<Value>, result: &mut Vec<Value>) {
    for value in nodes {
        match value["type"].as_str() {
            Some("image") => result.push(value),
            Some("paragraph" | "heading") => {
                let children = value["content"].as_array().cloned().unwrap_or_default();
                result.push(node("paragraph", children));
            }
            // A task item holds no code block, so its text stays as lines of a paragraph.
            Some("codeBlock") => {
                let code: String = value["content"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|child| child["text"].as_str())
                    .collect();
                result.push(node("paragraph", text_nodes(&code)));
            }
            _ => {
                let children = value["content"].as_array().cloned().unwrap_or_default();
                paragraphs_and_images(children, result);
            }
        }
    }
}

fn lists(items: Vec<Value>, start: Option<u64>) -> Vec<Value> {
    let mut result = vec![];
    for (offset, item) in items.into_iter().enumerate() {
        let kind = if item["type"] == "taskItem" {
            "taskList"
        } else if start.is_some() {
            "orderedList"
        } else {
            "bulletList"
        };
        if result.last().is_none_or(|n: &Value| n["type"] != kind) {
            let mut list = node(kind, vec![]);
            if let Some(start) = start.filter(|_| kind == "orderedList") {
                list["attrs"] = json!({"start":start.saturating_add(offset as u64)});
            }
            result.push(list);
        }
        result.last_mut().unwrap()["content"]
            .as_array_mut()
            .unwrap()
            .push(item);
    }
    result
}

/// Adjacent text with the same marks is one text node, as in the editor's own documents.
fn merge_text(nodes: &mut Vec<Value>) {
    let mut merged: Vec<Value> = Vec::with_capacity(nodes.len());
    for mut value in nodes.drain(..) {
        if let Some(children) = value.get_mut("content").and_then(Value::as_array_mut) {
            merge_text(children);
        }
        if let Some(previous) = merged.last_mut()
            && previous["type"] == "text"
            && value["type"] == "text"
            && previous.get("marks") == value.get("marks")
        {
            let text = format!(
                "{}{}",
                previous["text"].as_str().unwrap_or_default(),
                value["text"].as_str().unwrap_or_default()
            );
            previous["text"] = Value::String(text);
            continue;
        }
        merged.push(value);
    }
    *nodes = merged;
}

pub(super) fn escape(text: &str) -> String {
    let mut escaped = String::new();
    for character in text.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(character),
        }
    }
    escaped
}
