use super::*;

#[test]
fn attachment_read_consumes_only_the_limit_and_one_sentinel_from_a_growing_stream() {
    use std::{cell::Cell, rc::Rc};
    struct GrowingStream(Rc<Cell<u64>>);
    impl Read for GrowingStream {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            buffer.fill(b'x');
            self.0.set(self.0.get() + buffer.len() as u64);
            Ok(buffer.len())
        }
    }
    let consumed = Rc::new(Cell::new(0));
    let result = read_attachment_stream(GrowingStream(Rc::clone(&consumed)));
    assert!(
        result.is_err(),
        "unending input must be rejected, not fully drained"
    );
    assert_eq!(consumed.get(), MAX_ATTACHMENT_BYTES + 1);
}

#[test]
fn safe_filename_removes_path_control_characters() {
    assert_eq!(safe_filename("../screen shot.png"), "_screen_shot.png");
}

#[test]
fn safe_relative_path_rejects_parent_segments() {
    assert!(!is_safe_relative_path(Path::new(
        "attachments/../secret.txt"
    )));
    assert!(is_safe_relative_path(Path::new(
        "attachments/session/file.txt"
    )));
}

#[test]
fn clipboard_data_url_size_precheck_rejects_encoded_payloads_over_attachment_limit() {
    let max_encoded = max_base64_encoded_len(MAX_ATTACHMENT_BYTES);

    assert!(!base64_encoded_len_exceeds_decoded_limit(
        max_encoded,
        MAX_ATTACHMENT_BYTES
    ));
    assert!(base64_encoded_len_exceeds_decoded_limit(
        max_encoded + 4,
        MAX_ATTACHMENT_BYTES
    ));
}
