use super::*;

#[tauri::command]
#[specta::specta]
pub async fn read_chat_clipboard_image_data_url(
    app: AppHandle,
) -> Result<Option<String>, CommandError> {
    attachment_task("Chat clipboard image read", move || {
        match app.clipboard().read_image() {
            Ok(image) => chat_clipboard_image_to_png_data_url(&image).map(Some),
            Err(error) if clipboard_image_is_unavailable(&error) => Ok(None),
            Err(error) => Err(CommandError::internal(format!(
                "Clipboard image could not be read: {error}"
            ))),
        }
    })
    .await
}

fn chat_clipboard_image_to_png_data_url(image: &Image<'_>) -> Result<String, CommandError> {
    use image::ImageEncoder;
    use qa_scribe_core::attachments::chat::{MAX_CHAT_IMAGE_BYTES, MAX_CHAT_IMAGE_PIXELS};
    let pixels = u64::from(image.width()) * u64::from(image.height());
    if pixels == 0 || pixels > MAX_CHAT_IMAGE_PIXELS {
        return Err(CommandError::validation(
            "Chat clipboard images must contain 1 to 40 million pixels",
        ));
    }
    if image.rgba().len() as u64 != pixels * 4 {
        return Err(CommandError::validation("Clipboard image data was invalid"));
    }
    struct BoundedPng(Vec<u8>);
    impl std::io::Write for BoundedPng {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if self.0.len().saturating_add(bytes.len()) > MAX_CHAT_IMAGE_BYTES {
                return Err(std::io::Error::other(
                    "Chat clipboard PNG must be at most 10 MiB",
                ));
            }
            self.0.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut png = BoundedPng(Vec::new());
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(
            image.rgba(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|error| {
            CommandError::validation(format!(
                "Chat clipboard PNG could not be encoded within 10 MiB: {error}"
            ))
        })?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(png.0)))
}

#[cfg(test)]
mod chat_clipboard_tests {
    use super::*;
    #[test]
    fn chat_clipboard_accepts_real_4k_rgba_and_keeps_unrelated_limit() {
        let pixels = vec![127; 3840 * 2160 * 4];
        let image = Image::new(&pixels, 3840, 2160);
        let data = chat_clipboard_image_to_png_data_url(&image).unwrap();
        let (_, bytes) = decode_image_data_url(&data).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap().to_rgba8();
        assert_eq!(decoded.dimensions(), (3840, 2160));
        assert_eq!(decoded.get_pixel(3839, 2159).0, [127; 4]);
        assert!(clipboard_image_to_png_data_url(&image).is_err());
    }
    #[test]
    fn chat_clipboard_rejects_over_pixel_limit_and_invalid_buffer_before_encode() {
        assert!(chat_clipboard_image_to_png_data_url(&Image::new(&[], 10_000, 4_001)).is_err());
        assert!(chat_clipboard_image_to_png_data_url(&Image::new(&[0; 4], 2, 2)).is_err());
    }
}
