use super::*;
#[path = "activity_support.rs"]
mod support;
use support::*;
#[path = "activity_controls.rs"]
mod controls;
#[path = "activity_proposals.rs"]
mod proposals;

fn image_case(kind: Kind) {
    let f = Fixture::new(kind);
    let a = f.save(&f.a, "Earlier input");
    let b = f.save(&f.b, "Other input");
    assert_eq!((a.last_active_order, b.last_active_order), (3, 4));
    let imported = f.import(&a).unwrap();
    assert_eq!(imported.composer, "Earlier input");
    assert_eq!(imported.revision, a.revision + 1);
    assert_eq!(imported.composer_images.len(), 1);
    assert_eq!(imported.composer_images[0].filename, "activity.png");
    assert_eq!(imported.composer_images[0].mime_type, "image/png");
    let attachment = f
        .service
        .get_attachment(&imported.composer_images[0].attachment_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        std::fs::read(f.root.0.join(&attachment.relative_path)).unwrap(),
        include_bytes!("../../../../e2e/fixtures/chat-image-pixels.png")
    );
    let saved = f.save(&imported, "Earlier input");
    assert_eq!(saved, imported);
    eprintln!(
        "{kind:?} image old={} other={} imported={} equal_save={} images={}",
        a.last_active_order,
        b.last_active_order,
        imported.last_active_order,
        saved.last_active_order,
        saved.composer_images.len()
    );
    assert_eq!(
        saved.last_active_order, 5,
        "successful image import must advance activity before an equal save"
    );
    f.history([&a.draft_id, &b.draft_id], [5, 4]);
}
#[test]
fn finding_image_import_advances_activity_before_equal_save() {
    image_case(Kind::Finding);
}
#[test]
fn test_cases_image_import_advances_activity_before_equal_save() {
    image_case(Kind::TestCases);
}

fn retry_case(kind: Kind) {
    let f = Fixture::new(kind);
    let failed = f.failed();
    let b = f.save(&f.b, "Other input");
    assert_eq!((failed.last_active_order, b.last_active_order), (4, 5));
    let retried = f
        .service
        .retry_chat_turn(ChatStartRequest {
            scope: scope(&failed),
        })
        .unwrap();
    assert_eq!(retried.chat.messages.len(), 1);
    assert_eq!(retried.chat.messages[0].id, failed.messages[0].id);
    assert_eq!(retried.chat.messages[0].text, "Retry this literal question");
    assert_eq!(retried.chat.messages[0].status, ChatTurnStatus::Running);
    assert_eq!(retried.chat.messages[0].error_message, None);
    assert_eq!(retried.chat.messages[0].turn_id, retried.turn_id);
    assert_ne!(retried.turn_id, failed.messages[0].turn_id);
    assert_eq!(retried.chat.revision, failed.revision + 1);
    eprintln!(
        "{kind:?} retry failed={} other={} retry={} status={:?}",
        failed.last_active_order,
        b.last_active_order,
        retried.chat.last_active_order,
        retried.chat.messages[0].status
    );
    assert_eq!(
        retried.chat.last_active_order, 6,
        "committed explicit Retry must advance activity"
    );
    f.history([&failed.draft_id, &b.draft_id], [6, 5]);
}
#[test]
fn finding_explicit_retry_advances_activity() {
    retry_case(Kind::Finding);
}
#[test]
fn test_cases_explicit_retry_advances_activity() {
    retry_case(Kind::TestCases);
}
