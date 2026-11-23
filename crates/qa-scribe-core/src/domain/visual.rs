use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TestCaseVisual {
    /// Zero-based path through the snapshot's doc.content arrays.
    pub target: Vec<u32>,
    pub caption: String,
    pub action: TestCaseVisualAction,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum TestCaseVisualAction {
    Diagram {
        replace: bool,
        nodes: Vec<DiagramNode>,
        edges: Vec<DiagramEdge>,
    },
    Place {
        replace: bool,
        source: VisualImageSource,
    },
    Move {
        source: Vec<u32>,
    },
    Caption,
    Annotate {
        replace: bool,
        source: VisualImageSource,
        edits: Vec<ScreenshotEdit>,
    },
}

impl TestCaseVisualAction {
    pub fn renders_png(&self) -> bool {
        matches!(self, Self::Diagram { .. } | Self::Annotate { .. })
    }

    pub fn source(&self) -> Option<&VisualImageSource> {
        match self {
            Self::Place { source, .. } | Self::Annotate { source, .. } => Some(source),
            _ => None,
        }
    }

    pub fn replaces(&self) -> bool {
        match self {
            Self::Diagram { replace, .. }
            | Self::Place { replace, .. }
            | Self::Annotate { replace, .. } => *replace,
            Self::Caption => true,
            Self::Move { .. } => false,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum VisualImageSource {
    Record { path: Vec<u32> },
    Chat { index: u32 },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct DiagramNode {
    pub label: String,
    pub row: u8,
    pub column: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct DiagramEdge {
    pub from: u8,
    pub to: u8,
    pub label: Option<String>,
}

/// Coordinates are thousandths of the natural source image dimensions.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(deny_unknown_fields)]
pub struct VisualRegion {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ScreenshotEdit {
    Crop { region: VisualRegion },
    Highlight { region: VisualRegion },
    Redact { region: VisualRegion },
    Arrow { from: [u16; 2], to: [u16; 2] },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyVisualRefinementRequest {
    pub reference: super::ChatRef,
    pub proposal_id: String,
    pub image_data_url: Option<String>,
    pub undo: bool,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VisualReviewSources {
    pub source: Option<String>,
    pub replaced: Option<String>,
}
