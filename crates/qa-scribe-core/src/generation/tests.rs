use crate::domain::{AppSettings, EntryType};

use super::test_support::{test_attachment, test_entry, test_session};
use super::*;

#[path = "tests/acceptance_criteria_prompt.rs"]
mod acceptance_criteria_prompt;
#[path = "tests/images.rs"]
mod images;
#[path = "tests/markdown_projection.rs"]
mod markdown_projection;
#[path = "tests/markdown_projection_tables.rs"]
mod markdown_projection_tables;
#[path = "tests/panels.rs"]
mod panels;
#[path = "tests/prompt_and_projection.rs"]
mod prompt_and_projection;
#[path = "tests/response_parser.rs"]
mod response_parser;
#[path = "tests/session_sheet_prompt.rs"]
mod session_sheet_prompt;
#[path = "tests/test_results_prompt.rs"]
mod test_results_prompt;

/// A fixed marker for deterministic parser/prompt tests.
fn test_marker() -> OutputMarker {
    OutputMarker::from_tag_name("html_fragment_test1234")
}
