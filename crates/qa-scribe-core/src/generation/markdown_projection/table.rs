//! Tables in the Ask AI Notes projection: GFM pipe rows, one line per row.
use super::{Node, blocks, escape_line_start, inline, is_block, join_inline};

/// A GFM table: the first row is the header row and every row has as many cells as the widest.
pub(super) fn table(children: &[Node]) -> String {
    let mut rows = vec![];
    collect_rows(children, &mut rows);
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    if width == 0 {
        return String::new();
    }
    let line = |cells: &[String]| {
        let padded: Vec<&str> = (0..width)
            .map(|index| cells.get(index).map_or("", String::as_str))
            .collect();
        format!("| {} |", padded.join(" | "))
    };
    let mut lines = vec![line(&rows[0]), line(&vec!["---".to_string(); width])];
    lines.extend(rows[1..].iter().map(|row| line(row)));
    lines.join("\n")
}

fn collect_rows(nodes: &[Node], rows: &mut Vec<Vec<String>>) {
    for node in nodes {
        let Node::Element { name, children, .. } = node else {
            continue;
        };
        match name.as_str() {
            "tr" => rows.push(
                children
                    .iter()
                    .filter_map(|cell| match cell {
                        Node::Element { name, children, .. } if name == "th" || name == "td" => {
                            Some(table_cell(children))
                        }
                        _ => None,
                    })
                    .collect(),
            ),
            "thead" | "tbody" | "tfoot" => collect_rows(children, rows),
            _ => {}
        }
    }
}

/// A cell is one line: its line breaks are `<br>` and its pipes are escaped. A cell holds one
/// paragraph, whose every line break is kept, at its edges too, since the parser reads each `<br>`
/// in a cell back as a line break.
fn table_cell(children: &[Node]) -> String {
    let text = match children {
        [Node::Element { name, children, .. }] if name == "p" => cell_lines(children),
        _ if !children.iter().any(is_block) => cell_lines(children),
        _ => blocks(&children.iter().collect::<Vec<_>>()).join("\n"),
    };
    text.replace('|', "\\|").replace('\n', "<br>")
}

fn cell_lines(nodes: &[Node]) -> String {
    join_inline(nodes.iter().map(inline))
        .split('\n')
        .map(|line| escape_line_start(line.trim()))
        .collect::<Vec<_>>()
        .join("\n")
}
