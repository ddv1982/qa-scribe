use super::chat::*;
use std::io::Cursor;

#[test]
fn supported_formats_decode_and_mime_mismatch_corruption_and_pixel_bombs_fail() {
    for (mime, format) in [
        ("image/png", image::ImageFormat::Png),
        ("image/jpeg", image::ImageFormat::Jpeg),
        ("image/gif", image::ImageFormat::Gif),
        ("image/webp", image::ImageFormat::WebP),
    ] {
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(2, 1, image::Rgb([255, 0, 0])))
            .write_to(&mut bytes, format)
            .unwrap();
        assert_eq!(validate_chat_image(mime, bytes.get_ref()).unwrap(), (2, 1));
        assert!(validate_chat_image("image/png", b"corrupt").is_err());
        if mime != "image/png" {
            assert!(validate_chat_image("image/png", bytes.get_ref()).is_err());
        }
    }
    let mut gif=b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x01\x4c\x00\x3b".to_vec();
    gif[6..10].fill(0xff);
    assert!(
        validate_chat_image("image/gif", &gif)
            .unwrap_err()
            .to_string()
            .contains("40 million pixels")
    );
    assert!(
        validate_chat_image("image/png", &vec![0; MAX_CHAT_IMAGE_BYTES + 1])
            .unwrap_err()
            .to_string()
            .contains("10 MiB")
    );
}
