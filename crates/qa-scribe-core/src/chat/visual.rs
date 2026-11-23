use crate::{Result, domain::*, error::validation};
use serde_json::{Value, json};
use std::collections::HashSet;

pub(crate) const MANAGED_SOURCE: &str = "qa-scribe-attachment://";

pub(crate) fn validate(document: &Value, visual: &TestCaseVisual) -> Result<()> {
    if visual.caption.trim().is_empty()
        || visual.caption.chars().count() > 160
        || visual.caption.chars().any(char::is_control)
    {
        return Err(validation("Visual suggestions need a single-line caption"));
    }
    let (index, parent) = parent_path(&visual.target)?;
    let container = node(document, parent)?;
    let target = node(document, &visual.target)?;
    if !matches!(
        container["type"].as_str(),
        Some("doc" | "listItem" | "taskItem")
    ) || (visual.action.replaces() && image_id(target).is_none())
        || container["content"].get(index).is_none()
    {
        return Err(validation(
            "The visual placement does not match this test case",
        ));
    }
    match &visual.action {
        TestCaseVisualAction::Diagram { nodes, edges, .. } => validate_diagram(nodes, edges),
        TestCaseVisualAction::Annotate { source, edits, .. } => {
            validate_source(document, source)?;
            validate_edits(edits)
        }
        TestCaseVisualAction::Place { source, .. } => validate_source(document, source),
        TestCaseVisualAction::Move { source } => {
            if visual.target.starts_with(source) || image_id(node(document, source)?).is_none() {
                return Err(validation(
                    "Select a managed image and a different position",
                ));
            }
            Ok(())
        }
        TestCaseVisualAction::Caption => {
            if image_id(target).is_none() {
                return Err(validation("Select a managed image to caption"));
            }
            if target["attrs"]["alt"] == visual.caption {
                return Err(validation("The image already has this caption"));
            }
            Ok(())
        }
    }
}

fn validate_source(document: &Value, source: &VisualImageSource) -> Result<()> {
    match source {
        VisualImageSource::Record { path } if image_id(node(document, path)?).is_some() => Ok(()),
        VisualImageSource::Chat { index } if *index < 4 => Ok(()),
        _ => Err(validation("The requested source image is not available")),
    }
}

fn validate_diagram(nodes: &[DiagramNode], edges: &[DiagramEdge]) -> Result<()> {
    let mut positions = HashSet::new();
    let mut connections = HashSet::new();
    let valid_label = |label: &str, max| {
        !label.trim().is_empty()
            && label.chars().count() <= max
            && !label.chars().any(char::is_control)
    };
    if !(1..=12).contains(&nodes.len())
        || edges.len() > 20
        || nodes.iter().any(|node| {
            node.row > 5
                || node.column > 3
                || !valid_label(&node.label, 100)
                || !positions.insert((node.row, node.column))
        })
        || edges.iter().any(|edge| {
            edge.from == edge.to
                || usize::from(edge.from.max(edge.to)) >= nodes.len()
                || edge
                    .label
                    .as_ref()
                    .is_some_and(|label| !valid_label(label, 40))
                || !connections.insert((edge.from, edge.to))
        })
    {
        return Err(validation(
            "Diagram needs bounded labels, positions, and connections",
        ));
    }
    Ok(())
}

fn validate_edits(edits: &[ScreenshotEdit]) -> Result<()> {
    let valid_region = |region: &VisualRegion| {
        region.width > 0
            && region.height > 0
            && u32::from(region.x) + u32::from(region.width) <= 1000
            && u32::from(region.y) + u32::from(region.height) <= 1000
    };
    let mut crop = false;
    if edits.is_empty()
        || edits.len() > 12
        || edits.iter().any(|edit| match edit {
            ScreenshotEdit::Crop { region } => {
                std::mem::replace(&mut crop, true) || !valid_region(region)
            }
            ScreenshotEdit::Highlight { region } | ScreenshotEdit::Redact { region } => {
                !valid_region(region)
            }
            ScreenshotEdit::Arrow { from, to } => {
                from == to || from.iter().chain(to).any(|&n| n > 1000)
            }
        })
    {
        return Err(validation(
            "Screenshot edits must use valid source-image coordinates",
        ));
    }
    Ok(())
}

pub(crate) fn node<'a>(document: &'a Value, path: &[u32]) -> Result<&'a Value> {
    if path.len() > 8 {
        return Err(validation("Visual placement is too deeply nested"));
    }
    path.iter().try_fold(document, |current, &index| {
        current["content"]
            .get(index as usize)
            .ok_or_else(|| validation("Visual placement no longer exists"))
    })
}

pub(crate) fn image_id(node: &Value) -> Option<&str> {
    if node["type"] != "image" {
        return None;
    }
    let id = node["attrs"]["attachmentId"].as_str()?;
    (node["attrs"]["src"].as_str()?.strip_prefix(MANAGED_SOURCE) == Some(id)).then_some(id)
}

fn parent_path(path: &[u32]) -> Result<(usize, &[u32])> {
    path.split_last()
        .map(|(&index, parent)| (index as usize, parent))
        .ok_or_else(|| validation("Choose a position in the test case"))
}

fn children_mut<'a>(mut doc: &'a mut Value, path: &[u32]) -> Result<&'a mut Vec<Value>> {
    for &index in path {
        doc = doc["content"]
            .get_mut(index as usize)
            .ok_or_else(|| validation("Visual placement no longer exists"))?;
    }
    doc["content"]
        .as_array_mut()
        .ok_or_else(|| validation("Visual placement is not a container"))
}

pub(crate) fn edit(
    doc: &mut Value,
    visual: &TestCaseVisual,
    asset_id: Option<&str>,
    source_id: Option<&str>,
) -> Result<()> {
    validate(doc, visual)?;
    let mut target = visual.target.clone();
    let mut image = match &visual.action {
        TestCaseVisualAction::Caption => node(doc, &target)?.clone(),
        TestCaseVisualAction::Place {
            source: VisualImageSource::Record { path },
            ..
        } => node(doc, path)?.clone(),
        TestCaseVisualAction::Move { source } => {
            let (index, parent) = parent_path(source)?;
            let image = children_mut(doc, parent)?.remove(index);
            if target.starts_with(parent) && target[parent.len()] > index as u32 {
                target[parent.len()] -= 1;
            }
            image
        }
        _ => {
            let id = asset_id
                .or(source_id)
                .ok_or_else(|| validation("Visual image is missing"))?;
            json!({"type":"image","attrs":{"attachmentId":id,"src":format!("{MANAGED_SOURCE}{id}")}})
        }
    };
    image["attrs"]["alt"] = json!(visual.caption);
    if visual.action.renders_png() {
        image["attrs"]["visualSource"] = match &visual.action {
            TestCaseVisualAction::Diagram { nodes, edges, .. } => {
                json!({"kind":"diagram","nodes":nodes,"edges":edges})
            }
            TestCaseVisualAction::Annotate { edits, .. } => {
                json!({"kind":"annotated_screenshot","sourceAttachmentId":source_id,"edits":edits})
            }
            _ => unreachable!(),
        };
    }
    let (index, parent) = parent_path(&target)?;
    let items = children_mut(doc, parent)?;
    if visual.action.replaces() {
        items[index] = image;
    } else {
        items.insert(index + 1, image);
    }
    Ok(())
}

pub(super) const INSTRUCTIONS: &str = r#"
For a requested Test Cases visual edit, use outcome kind edit with patch {"kind":"test_cases_visual","visual":{"target":[0],"caption":"Queue routing","action":{"kind":"diagram","replace":false,"nodes":[{"label":"Producer","row":0,"column":0},{"label":"Queue","row":1,"column":0}],"edges":[{"from":0,"to":1,"label":null}]}}}. Return one visual operation per suggestion. The app renders actual PNG previews and writes them only on Update; do not suggest ASCII or Mermaid for saved diagrams.
Paths index into the latest bound snapshot's documentJson, starting from doc.content, then into each node's content. They are zero-based. Insert immediately after the chosen node inside the intended test case, or after a paragraph inside its list item. Set replace:true only when the target is an image occurrence. For a follow-up diagram revision, use the existing image's attrs.visualSource nodes and edges and target that image with replace:true. Diagrams support at most 12 nodes in a grid with rows 0–5 and columns 0–3, 20 directed edges indexed by node order, single-line labels, and no URLs or markup. Prefer vertical layout for simple flows.
Other actions are {"kind":"place","replace":false,"source":{"kind":"chat","index":0}}, {"kind":"move","source":[3]}, and {"kind":"caption"} (target an image). Image sources are {"kind":"record","path":[3]} for a managed image in the bound snapshot or {"kind":"chat","index":0} for an image attached to this latest user message, numbered in attachment order. For screenshot changes use {"kind":"annotate","replace":false,"source":{"kind":"chat","index":0},"edits":[{"kind":"highlight","region":{"x":100,"y":200,"width":300,"height":100}}]}. Allowed edits are crop, highlight, redact (opaque), and arrow with from/to pairs. Coordinates are thousandths of original width and height. Only suggest coordinates when you can see the image. If the user asks to change record screenshot pixels, ask them to attach the image to chat so you can see it, and use the attached image as source. The original remains available. Ask for clarification if the source, steps, or placement are ambiguous.
"#;
