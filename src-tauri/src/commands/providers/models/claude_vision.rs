use super::{
    CLAUDE_PRESET_MODELS, ProviderModelDescriptor, environment_model, normalize_models,
    preset_models, provider_default_model,
};

pub(super) fn static_models() -> Vec<ProviderModelDescriptor> {
    let mut models = vec![provider_default_model()];
    if let Some(model) = environment_model("ANTHROPIC_MODEL") {
        models.push(model);
    }
    models.extend(preset_models(&CLAUDE_PRESET_MODELS));
    for model in &mut models {
        model.capabilities.vision = known_image_support(&model.id);
    }
    normalize_models(models)
}

pub(super) fn image_support(
    model: &serde_json::Value,
    id: &str,
    resolved_model: Option<&str>,
) -> Option<bool> {
    let modalities = model
        .get("inputModalities")
        .and_then(serde_json::Value::as_array)
        .and_then(|modalities| {
            modalities
                .iter()
                .map(serde_json::Value::as_str)
                .collect::<Option<Vec<_>>>()
        })
        .map(|modalities| modalities.contains(&"image"));
    [
        model
            .pointer("/capabilities/image_input/supported")
            .and_then(serde_json::Value::as_bool),
        model.get("vision").and_then(serde_json::Value::as_bool),
        model
            .get("supportsVision")
            .and_then(serde_json::Value::as_bool),
        modalities,
    ]
    .into_iter()
    .flatten()
    .reduce(|left, right| left && right)
    .or_else(|| known_image_support(resolved_model.unwrap_or(id)))
}

/// Claude ids with confirmed image input. Unknown and future ids stay
/// unknown, so image prompts fail closed until a release lists them.
pub(super) fn known_image_support(id: &str) -> Option<bool> {
    // Dated snapshots are listed one by one; undated ids match by family.
    const DATED_MODELS: &[&str] = &[
        "claude-sonnet-4-5-20250929",
        "claude-haiku-4-5-20251001",
        "claude-opus-4-5-20251101",
    ];
    const FAMILIES: &[&str] = &["sonnet", "opus", "haiku", "fable"];
    let id = id.strip_suffix("[1m]").unwrap_or(id);
    if FAMILIES.contains(&id) || DATED_MODELS.contains(&id) {
        return Some(true);
    }
    let rest = id.strip_prefix("claude-")?;
    let (family, version) = rest.split_once('-')?;
    if !FAMILIES.contains(&family) {
        return None;
    }
    let mut parts = version.split('-');
    let major_known = matches!(parts.next(), Some("4" | "5"));
    let minor_known = parts
        .next()
        .is_none_or(|minor| minor.len() == 1 && minor.as_bytes()[0].is_ascii_digit());
    (major_known && minor_known && parts.next().is_none()).then_some(true)
}
