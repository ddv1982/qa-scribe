use super::escape;
use serde_json::Value;

pub(crate) fn to_html(nodes: &[Value]) -> String {
    nodes.iter().map(render).collect()
}

fn render(node: &Value) -> String {
    if node["type"] == "text" {
        let mut text = escape(node["text"].as_str().unwrap_or_default());
        for mark in node["marks"].as_array().into_iter().flatten() {
            text = match mark["type"].as_str() {
                Some("bold") => format!("<strong>{text}</strong>"),
                Some("italic") => format!("<em>{text}</em>"),
                Some("strike") => format!("<s>{text}</s>"),
                Some("code") => format!("<code>{text}</code>"),
                Some("underline") => format!("<u>{text}</u>"),
                Some("link") => format!(
                    "<a href=\"{}\" target=\"_blank\" rel=\"noopener noreferrer\">{text}</a>",
                    escape(mark["attrs"]["href"].as_str().unwrap_or_default())
                ),
                _ => text,
            };
        }
        return text;
    }
    if node["type"] == "hardBreak" {
        return "<br>".into();
    }
    if node["type"] == "image" {
        return format!(
            "<img src=\"{}\" data-attachment-id=\"{}\" alt=\"{}\">",
            escape(node["attrs"]["src"].as_str().unwrap_or_default()),
            escape(node["attrs"]["attachmentId"].as_str().unwrap_or_default()),
            escape(node["attrs"]["alt"].as_str().unwrap_or_default())
        );
    }
    let content = to_html(
        node["content"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default(),
    );
    match node["type"].as_str() {
        Some("heading") => {
            let level = node["attrs"]["level"].as_u64().unwrap_or(2).clamp(1, 6);
            format!("<h{level}>{content}</h{level}>")
        }
        Some("codeBlock") => format!("<pre><code>{content}</code></pre>"),
        Some("blockquote") => format!("<blockquote>{content}</blockquote>"),
        Some("panel") => format!(
            "<aside data-panel=\"{}\">{content}</aside>",
            crate::generation::panel::kind(node["attrs"]["kind"].as_str().unwrap_or_default())
        ),
        Some("horizontalRule") => "<hr>".into(),
        Some("bulletList") => format!("<ul>{content}</ul>"),
        Some("orderedList") => format!(
            "<ol start=\"{}\">{content}</ol>",
            node["attrs"]["start"].as_u64().unwrap_or(1)
        ),
        Some("taskList") => format!("<ul data-type=\"taskList\">{content}</ul>"),
        Some("listItem") => format!("<li>{content}</li>"),
        Some("taskItem") => {
            let checked = node["attrs"]["checked"] == true;
            format!(
                "<li data-type=\"taskItem\" data-checked=\"{checked}\"><label><input type=\"checkbox\"{}><span></span></label><div>{content}</div></li>",
                if checked { " checked=\"checked\"" } else { "" }
            )
        }
        Some("table") => format!("<table><tbody>{content}</tbody></table>"),
        Some("tableRow") => format!("<tr>{content}</tr>"),
        Some("tableHeader") => format!("<th>{content}</th>"),
        Some("tableCell") => format!("<td>{content}</td>"),
        _ => format!("<p>{content}</p>"),
    }
}
