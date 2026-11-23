//! Ask AI's view of the Session Note: editor HTML as the Markdown that `chat::markdown` reads
//! back, so a rewrite keeps heading levels, lists, marks, code, quotes, rules and each managed
//! image in place. Generate and Summarize keep the plain projection in `html_projection.rs`.
use super::html::{
    MANAGED_ATTACHMENT_PROTOCOL, attribute_value, decode_html_entities, find_case_insensitive,
    find_html_tag_end,
};
use super::html_projection::redact_data_urls;

const VOID_TAGS: &[&str] = &["br", "hr", "img", "input"];

enum Node {
    Element {
        name: String,
        tag: String,
        children: Vec<Node>,
    },
    Text(String),
}

pub fn project_html_to_prompt_markdown(value: &str) -> String {
    blocks(&parse(value).iter().collect::<Vec<_>>()).join("\n\n")
}

fn parse(source: &str) -> Vec<Node> {
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
        } else {
            stack.push((name, raw.to_string(), vec![]));
        }
    }
    push_text(&mut stack, &source[index..]);
    while stack.len() > 1 {
        close(&mut stack);
    }
    stack.pop().unwrap().2
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
            | "blockquote" | "hr" | "img" | "section" | "article"))
}

/// Block-level Markdown, one entry per block. Loose inline content becomes a paragraph.
fn blocks(nodes: &[&Node]) -> Vec<String> {
    kinded_blocks(nodes)
        .into_iter()
        .map(|(block, _)| block)
        .collect()
}

/// Each block with whether it is a list, which stays tight under a list item.
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
            "img" => image(tag),
            heading if heading.starts_with('h') => {
                let level = heading[1..].parse::<usize>().unwrap_or(2);
                let text = paragraph(children.iter());
                if text.is_empty() {
                    String::new()
                } else {
                    format!("{} {text}", "#".repeat(level))
                }
            }
            "p" => paragraph(children.iter()),
            _ => blocks(&children.iter().collect::<Vec<_>>()).join("\n\n"),
        };
        if !block.is_empty() {
            result.push((block, matches!(name.as_str(), "ul" | "ol")));
        }
    }
    flush(&mut inline_run, &mut result);
    result
}

/// Inline content with HTML white space collapsed and each line trimmed.
fn paragraph<'a>(nodes: impl Iterator<Item = &'a Node>) -> String {
    let text: String = nodes.map(inline).collect();
    text.split('\n')
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join("\n")
        .trim_matches('\n')
        .to_string()
}

fn inline(node: &Node) -> String {
    let (name, tag, children) = match node {
        Node::Text(text) => return text.replace(['\n', '\r', '\t'], " "),
        Node::Element {
            name,
            tag,
            children,
        } => (name.as_str(), tag, children),
    };
    let content: String = children.iter().map(inline).collect();
    let wrap = |marker: &str| {
        if content.trim().is_empty() {
            content.clone()
        } else {
            format!("{marker}{content}{marker}")
        }
    };
    match name {
        "br" => "\n".into(),
        "img" => image(tag),
        "strong" | "b" => wrap("**"),
        "em" | "i" => wrap("*"),
        "s" => wrap("~~"),
        "code" => wrap("`"),
        "u" if !content.trim().is_empty() => format!("<u>{content}</u>"),
        "a" => match attribute_value(tag, "href").map(|href| href.trim().to_string()) {
            Some(href) if safe_link(&href) && !content.trim().is_empty() => {
                format!("[{content}]({href})")
            }
            _ => content,
        },
        _ => content,
    }
}

fn safe_link(href: &str) -> bool {
    let lower = href.to_ascii_lowercase();
    ["http://", "https://", "mailto:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme))
}

fn list(name: &str, tag: &str, children: &[Node]) -> String {
    let start = attribute_value(tag, "start")
        .and_then(|value| value.trim().parse::<i64>().ok())
        .unwrap_or(1);
    let mut items = vec![];
    for child in children {
        let Node::Element {
            name: child_name,
            children: item,
            ..
        } = child
        else {
            continue;
        };
        if child_name != "li" {
            continue;
        }
        let marker = if let Some(checked) = checkbox(item) {
            format!("- [{}] ", if checked { "x" } else { " " })
        } else if name == "ol" {
            format!("{}. ", start + items.len() as i64)
        } else {
            "- ".into()
        };
        let indent = " ".repeat(if name == "ol" { marker.len() } else { 2 });
        let mut text = String::new();
        for (index, (block, is_list)) in kinded_blocks(&unwrap_item(item)).iter().enumerate() {
            // A nested list stays tight under its item; further paragraphs get a blank line.
            let separator = match (index, is_list) {
                (0, _) => "",
                (_, true) => "\n",
                _ => "\n\n",
            };
            text.push_str(separator);
            text.push_str(&indent_lines(
                block,
                if index == 0 { "" } else { &indent },
                &indent,
            ));
        }
        items.push(format!("{marker}{text}").trim_end().to_string());
    }
    items.join("\n")
}

fn checkbox(item: &[Node]) -> Option<bool> {
    item.iter().find_map(|node| match node {
        Node::Element { name, tag, .. } if name == "input" => {
            Some(attribute_value(tag, "checked").is_some())
        }
        Node::Element { name, children, .. } if name == "label" => checkbox(children),
        _ => None,
    })
}

/// A task item's checkbox wrappers carry no content, and its `div` only wraps paragraphs.
fn unwrap_item(item: &[Node]) -> Vec<&Node> {
    let mut nodes = vec![];
    for node in item {
        match node {
            Node::Element { name, .. } if name == "input" || name == "label" => {}
            Node::Element { name, children, .. } if name == "div" => {
                nodes.extend(unwrap_item(children))
            }
            other => nodes.push(other),
        }
    }
    nodes
}

fn indent_lines(block: &str, first: &str, rest: &str) -> String {
    block
        .split('\n')
        .enumerate()
        .map(|(index, line)| match (index, line.is_empty()) {
            (_, true) => String::new(),
            (0, false) => format!("{first}{line}"),
            _ => format!("{rest}{line}"),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn code_block(children: &[Node]) -> String {
    let code = raw_text(children);
    let code = code.trim_end_matches('\n');
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
