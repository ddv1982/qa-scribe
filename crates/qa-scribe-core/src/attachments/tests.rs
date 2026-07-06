use super::*;

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
