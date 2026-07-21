use crate::{
    Result,
    domain::{
        BODY_FORMAT_MAX_LENGTH, Draft, Entry, Finding, validate_body_json, validate_body_text,
        validate_optional_text,
    },
};

pub(super) struct ExistingRichBody<'a> {
    pub body: &'a str,
    pub body_json: Option<&'a str>,
    pub body_format: Option<&'a str>,
}

macro_rules! existing_rich_body_from {
    ($record:ty) => {
        impl<'a> From<&'a $record> for ExistingRichBody<'a> {
            fn from(record: &'a $record) -> Self {
                Self {
                    body: &record.body,
                    body_json: record.body_json.as_deref(),
                    body_format: record.body_format.as_deref(),
                }
            }
        }
    };
}

existing_rich_body_from!(Entry);
existing_rich_body_from!(Draft);
existing_rich_body_from!(Finding);

pub(super) struct RichBodyPatch {
    pub body: Option<String>,
    pub body_json: Option<Option<String>>,
    pub body_format: Option<Option<String>>,
}

pub(super) struct ResolvedRichBody {
    pub body: String,
    pub body_json: Option<String>,
    pub body_format: Option<String>,
}

pub(super) fn resolve_rich_body_patch(
    body_label: &str,
    body_max_length: usize,
    existing: ExistingRichBody<'_>,
    patch: RichBodyPatch,
) -> Result<ResolvedRichBody> {
    let body = match patch.body {
        Some(body) => validate_body_text(body_label, &body, body_max_length)?,
        None => existing.body.to_string(),
    };
    let body_json = match patch.body_json {
        Some(body_json) => validate_body_json(body_json)?,
        None => existing.body_json.map(str::to_string),
    };
    let body_format_label = format!("{body_label} format");
    let body_format = match patch.body_format {
        Some(body_format) => {
            validate_optional_text(&body_format_label, body_format, BODY_FORMAT_MAX_LENGTH)?
        }
        None => existing.body_format.map(str::to_string),
    };

    Ok(ResolvedRichBody {
        body,
        body_json,
        body_format,
    })
}
