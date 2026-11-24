//! Lists in the Ask AI Notes projection: each item's blocks at its content column.
use super::{BlockKind, Node, attribute_value, kinded_blocks};

pub(super) fn start(tag: &str) -> i64 {
    attribute_value(tag, "start")
        .and_then(|value| value.trim().parse::<i64>().ok())
        .unwrap_or(1)
}

pub(super) fn list(name: &str, tag: &str, children: &[Node]) -> String {
    let start = start(tag);
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
        for (index, (block, kind)) in kinded_blocks(&unwrap_item(item)).iter().enumerate() {
            // A nested list stays tight under its item where it can; other blocks get a blank
            // line. A divider first goes on the line after the marker, as `- ---` is a divider.
            let separator = match (index, kind) {
                (0, _) if block == "---" => "\n",
                (0, _) => "",
                (_, BlockKind::InterruptingList) => "\n",
                _ => "\n\n",
            };
            text.push_str(separator);
            text.push_str(&indent_lines(
                block,
                if separator.is_empty() { "" } else { &indent },
                &indent,
            ));
        }
        let marker = if text.starts_with('\n') {
            marker.trim_end()
        } else {
            &marker
        };
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
