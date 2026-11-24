//! Panels: the editor's callout blocks. In HTML a panel is `<aside data-panel="<kind>">`, and in
//! Markdown it is the GitHub alert of its kind, one to one, so Ask AI reads and writes it.

/// Each kind with its GitHub alert and the label the plain text forms use.
const KINDS: [(&str, &str, &str); 5] = [
    ("note", "NOTE", "Note"),
    ("info", "IMPORTANT", "Info"),
    ("success", "TIP", "Success"),
    ("warning", "WARNING", "Warning"),
    ("error", "CAUTION", "Error"),
];

/// `value` when it is a panel kind, otherwise `note`, so every panel has a known kind.
pub(crate) fn kind(value: &str) -> &'static str {
    entry(value).0
}

/// The GitHub alert of a panel kind, as written after `> [!`.
pub(crate) fn alert(value: &str) -> &'static str {
    entry(value).1
}

/// The panel kind's name, such as `Warning`.
pub(crate) fn label(value: &str) -> &'static str {
    entry(value).2
}

/// The panel kind of a GitHub alert.
pub(crate) fn from_alert(kind: pulldown_cmark::BlockQuoteKind) -> &'static str {
    use pulldown_cmark::BlockQuoteKind::{Caution, Important, Note, Tip, Warning};
    match kind {
        Note => "note",
        Important => "info",
        Tip => "success",
        Warning => "warning",
        Caution => "error",
    }
}

fn entry(value: &str) -> (&'static str, &'static str, &'static str) {
    KINDS
        .into_iter()
        .find(|(kind, ..)| *kind == value)
        .unwrap_or(KINDS[0])
}
