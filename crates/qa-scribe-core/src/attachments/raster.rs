//! Image data that QA Scribe stores or shows must be a raster format whose
//! bytes match its declared MIME type. SVG and other markup formats are
//! rejected because they can carry scripts.
use image::ImageFormat;

use crate::{Result, error::validation};

pub(crate) fn raster_image_format(mime_type: &str) -> Option<ImageFormat> {
    match mime_type {
        "image/png" => Some(ImageFormat::Png),
        "image/jpeg" => Some(ImageFormat::Jpeg),
        "image/webp" => Some(ImageFormat::WebP),
        "image/gif" => Some(ImageFormat::Gif),
        _ => None,
    }
}

/// True for a base64 `data:` URL that declares a supported raster MIME type.
pub fn is_raster_image_data_url(source: &str) -> bool {
    let lower = source.trim_start().to_ascii_lowercase();
    lower
        .strip_prefix("data:")
        .and_then(|rest| rest.split_once(";base64,"))
        .is_some_and(|(mime_type, _)| raster_image_format(mime_type).is_some())
}

pub(crate) fn ensure_raster_image(mime_type: &str, bytes: &[u8]) -> Result<()> {
    let expected = raster_image_format(mime_type)
        .ok_or_else(|| validation("Images must be PNG, JPEG, WebP or GIF"))?;
    match image::guess_format(bytes) {
        Ok(format) if format == expected => Ok(()),
        _ => Err(validation("Image MIME type does not match its pixels")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

    #[test]
    fn only_raster_data_urls_are_accepted() {
        assert!(is_raster_image_data_url("data:image/png;base64,AAAA"));
        assert!(is_raster_image_data_url("DATA:IMAGE/JPEG;BASE64,AAAA"));
        assert!(!is_raster_image_data_url("data:image/svg+xml;base64,AAAA"));
        assert!(!is_raster_image_data_url("data:image/png,AAAA"));
        assert!(!is_raster_image_data_url("https://example.com/a.png"));
    }

    #[test]
    fn raster_bytes_must_match_the_declared_type() {
        assert!(ensure_raster_image("image/png", PNG_MAGIC).is_ok());
        assert!(ensure_raster_image("image/jpeg", PNG_MAGIC).is_err());
        assert!(ensure_raster_image("image/svg+xml", b"<svg onload=alert(1)>").is_err());
        assert!(ensure_raster_image("image/png", b"<svg onload=alert(1)>").is_err());
    }
}
