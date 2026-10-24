use crate::commands::providers::ProviderDescriptor;

impl ProviderDescriptor {
    pub(in crate::commands) fn validate_image_model(&self, selection: &str) -> Result<(), String> {
        let selection = selection.trim();
        let model = if selection.is_empty()
            || selection.eq_ignore_ascii_case("default")
            || selection.eq_ignore_ascii_case("auto")
        {
            self.default_snapshot.model.value.as_deref()
        } else {
            Some(selection)
        };
        let models = &self.catalog_snapshot.models;
        let vision = model
            .and_then(|id| {
                models.iter().find(|model| model.id == id).or_else(|| {
                    models
                        .iter()
                        .find(|model| model.resolved_model.as_deref() == Some(id))
                })
            })
            .and_then(|model| model.capabilities.vision);
        match vision {
            Some(true) => Ok(()),
            Some(false) => Err("The selected model does not support images. Choose a model with image support; your composer is retained.".into()),
            None => Err("Image support for the selected model is unknown. Choose a model with confirmed image support; your composer is retained.".into()),
        }
    }
}
