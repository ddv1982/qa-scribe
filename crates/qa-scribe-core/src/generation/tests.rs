use crate::domain::{AppSettings, EntryType};

use super::test_support::{test_attachment, test_entry};
use super::*;

#[path = "tests/images.rs"]
mod images;
#[path = "tests/prompt_and_projection.rs"]
mod prompt_and_projection;
#[path = "tests/response_parser.rs"]
mod response_parser;

/// A fixed marker for deterministic parser/prompt tests.
fn test_marker() -> OutputMarker {
    OutputMarker::from_tag_name("html_fragment_test1234")
}
