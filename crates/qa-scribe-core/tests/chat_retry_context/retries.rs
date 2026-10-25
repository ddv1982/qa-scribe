use super::support::*;
use qa_scribe_core::domain::*;
use serde_json::json;

fn deleted_retry(kind: Kind, terminal: Terminal) {
    let f = Fixture::new(kind, terminal);
    let user = &f.chat.messages[0];
    let immutable = pinned_rows(&f.service);
    let contract = f.service.response_contract(&user.id).unwrap().unwrap();
    let pinned = serde_json::to_value(&contract).unwrap();
    let context: String = f
        .service
        .database()
        .connection()
        .query_row(
            "SELECT context_json FROM chat_message_contexts WHERE message_id = ?1",
            [&user.id],
            |r| r.get(0),
        )
        .unwrap();
    f.record.delete(&f.service);
    assert_eq!(f.service.load_chat(&f.chat.session_id).unwrap(), f.chat);
    let retried = f
        .service
        .retry_chat_turn(ChatStartRequest {
            scope: scope(&f.chat),
        })
        .unwrap();
    f.assert_retried(&retried.chat, false);
    assert_eq!(pinned_rows(&f.service), immutable);
    f.record.assert_absent(&f.service);
    assert_eq!(
        serde_json::to_value(f.service.response_contract(&user.id).unwrap().unwrap()).unwrap(),
        pinned
    );
    let stored: String = f
        .service
        .database()
        .connection()
        .query_row(
            "SELECT context_json FROM chat_message_contexts WHERE message_id = ?1",
            [&user.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored, context);
    let completed = f.service.finish_chat_turn(ChatFinishRequest {
        scope: scope(&retried.chat), turn_id: retried.turn_id,
        assistant_text: json!({"version":contract.version(),"requestId":contract.request_id(),"markdown":"Completed historical review"}).to_string(),
    }).unwrap();
    assert_eq!(completed.messages[0].status, ChatTurnStatus::Completed);
    let composed = compose(&f.service, &completed, "Next Session question");
    let next = f
        .service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&composed),
        })
        .unwrap();
    assert_eq!(next.chat.messages.len(), 3);
    assert_eq!(next.chat.messages[0].context, user.context);
    assert_eq!(next.chat.messages[0].images, user.images);
    assert_eq!(next.chat.messages[2].context, ChatTarget::Session);
    f.record.assert_absent(&f.service);
}

macro_rules! retry_cases {
    ($($name:ident: $kind:ident, $terminal:ident;)*) => {$ (
        #[test]
        fn $name() { deleted_retry(Kind::$kind, Terminal::$terminal); }
    )*};
}
retry_cases! {
    deleted_finding_failed: Finding, Failed;
    deleted_finding_cancelled: Finding, Cancelled;
    deleted_finding_interrupted: Finding, Interrupted;
    deleted_test_cases_failed: TestCases, Failed;
    deleted_test_cases_cancelled: TestCases, Cancelled;
    deleted_test_cases_interrupted: TestCases, Interrupted;
}

#[test]
fn missing_source_does_not_bypass_scope_revision_composer_or_archive_guards() {
    for kind in [Kind::Finding, Kind::TestCases] {
        let f = Fixture::new(kind, Terminal::Failed);
        f.record.delete(&f.service);
        let foreign = session(&f.service);
        let mut wrong = scope(&f.chat);
        wrong.session_id = foreign;
        let before = rows(&f.service);
        assert!(
            f.service
                .retry_chat_turn(ChatStartRequest { scope: wrong })
                .is_err()
        );
        let mut stale = scope(&f.chat);
        stale.expected_revision -= 1;
        assert!(
            f.service
                .retry_chat_turn(ChatStartRequest { scope: stale })
                .is_err()
        );
        assert_eq!(rows(&f.service), before);
        let composed = compose(&f.service, &f.chat, "Retain my unsent input");
        let before = rows(&f.service);
        assert!(
            f.service
                .retry_chat_turn(ChatStartRequest {
                    scope: scope(&composed)
                })
                .is_err()
        );
        assert_eq!(f.service.load_chat(&composed.session_id).unwrap(), composed);
        assert_eq!(rows(&f.service), before);
        let cleared = compose(&f.service, &composed, "");
        f.service
            .restart_chat(ChatRestartRequest {
                scope: scope(&cleared),
            })
            .unwrap();
        let before = rows(&f.service);
        assert!(
            f.service
                .retry_chat_turn(ChatStartRequest {
                    scope: scope(&cleared)
                })
                .is_err()
        );
        assert_eq!(rows(&f.service), before);
    }
}
