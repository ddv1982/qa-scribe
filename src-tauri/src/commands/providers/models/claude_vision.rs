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

pub(super) fn known_image_support(id: &str) -> Option<bool> {
    const MODELS: &[&str] = &[
        "sonnet",
        "opus",
        "haiku",
        "fable",
        "sonnet[1m]",
        "opus[1m]",
        "claude-sonnet-4-5",
        "claude-sonnet-4-5-20250929",
        "claude-sonnet-4-6",
        "claude-haiku-4-5",
        "claude-haiku-4-5-20251001",
        "claude-opus-4-5",
        "claude-opus-4-5-20251101",
        "claude-opus-4-6",
        "claude-opus-4-7",
        "claude-opus-4-8",
        "claude-opus-5-5",
        "claude-sonnet-5-5",
        "claude-haiku-5-5",
        "claude-fable-5-1",
    ];
    MODELS.contains(&id).then_some(true)
}
