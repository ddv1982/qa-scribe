//! Convert only newly submitted assistant Markdown into the existing editor schema.
//! HTML is derived from the same nodes as JSON; no raw provider HTML is trusted.
use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag};
use serde_json::{Value, json};

mod html;
pub(crate) use html::to_html;

struct Frame<'a> {
    tag: Option<Tag<'a>>,
    nodes: Vec<Value>,
    checked: Option<bool>,
}

pub(crate) fn literal(text: &str) -> Vec<Value> {
    vec![node("paragraph", text_nodes(text))]
}

pub(crate) fn parse(text: &str) -> Vec<Value> {
    let options =
        Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS | Options::ENABLE_STRIKETHROUGH;
    let mut stack = vec![Frame {
        tag: None,
        nodes: vec![],
        checked: None,
    }];
    for event in Parser::new_ext(text, options) {
        match event {
            Event::Start(tag) => {
                // Deep input remains readable rather than overflowing recursive renderers.
                if stack.len() >= 48 {
                    return literal(text);
                }
                stack.push(Frame {
                    tag: Some(tag),
                    nodes: vec![],
                    checked: None,
                });
            }
            Event::End(_) => {
                let frame = stack.pop().expect("balanced Markdown parser events");
                stack.last_mut().unwrap().nodes.extend(finish(frame));
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
            Event::Text(value)
            | Event::Code(value)
            | Event::Html(value)
            | Event::InlineHtml(value) => {
                stack.last_mut().unwrap().nodes.extend(text_nodes(&value));
            }
            Event::SoftBreak | Event::HardBreak => stack
                .last_mut()
                .unwrap()
                .nodes
                .push(json!({"type":"hardBreak"})),
            Event::Rule => stack.last_mut().unwrap().nodes.extend(literal("---")),
            _ => {}
        }
    }
    blocks(stack.pop().unwrap().nodes)
}

fn finish(mut frame: Frame<'_>) -> Vec<Value> {
    let tag = frame.tag.unwrap();
    match tag {
        Tag::Paragraph | Tag::CodeBlock(_) | Tag::HtmlBlock => vec![node("paragraph", frame.nodes)],
        Tag::Heading { level, .. } => {
            let level = if matches!(level, HeadingLevel::H1 | HeadingLevel::H2) {
                2
            } else {
                3
            };
            vec![json!({"type":"heading", "attrs":{"level":level}, "content":frame.nodes})]
        }
        Tag::Strong | Tag::Emphasis => {
            let kind = if matches!(tag, Tag::Strong) {
                "bold"
            } else {
                "italic"
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
                    json!({"type":"taskItem", "attrs":{"checked":checked}, "content":paragraphs(children)}),
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
            vec![node("paragraph", frame.nodes)]
        }
        Tag::TableCell => {
            frame.nodes.push(json!({"type":"text","text":" | "}));
            frame.nodes
        }
        // Quotes keep paragraph boundaries; images become their alt-text children.
        // Strikethrough loses only its unsupported mark, never its text.
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

fn mark(nodes: &mut [Value], value: Value) {
    for node in nodes {
        if node["type"] == "text" {
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

fn paragraphs(nodes: Vec<Value>) -> Vec<Value> {
    let mut result = vec![];
    for value in nodes {
        let children = value["content"].as_array().cloned().unwrap_or_default();
        if matches!(value["type"].as_str(), Some("paragraph" | "heading")) {
            result.push(node("paragraph", children));
        } else {
            result.extend(paragraphs(children));
        }
    }
    if result.is_empty() {
        result.push(node("paragraph", vec![]));
    }
    result
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
