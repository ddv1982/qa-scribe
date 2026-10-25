use super::*;
use serde_json::json;

#[path = "retry_context_tests/ownership.rs"]
mod ownership;
#[path = "../../../../crates/qa-scribe-core/tests/chat_retry_context/records.rs"]
mod records;
#[path = "../../../../crates/qa-scribe-core/tests/chat_retry_context/support.rs"]
mod support;
use support::*;

fn request(chat: &ChatState) -> StartChatJobRequest {
    StartChatJobRequest {
        scope: scope(chat),
        intent: crate::commands::chat::ChatSendIntent::Retry,
        context: ChatTarget::Session,
        provider: AiProvider::CodexCli,
        model: "gpt-6.1".into(),
        reasoning_effort: None,
    }
}

fn deleted_retry(kind: Kind, terminal: Terminal) {
    let f = Fixture::new(kind, terminal);
    let retry = request(&f.chat);
    let immutable = pinned_rows(&f.service);
    let original = preparation::ChatPreparationSnapshot::capture(&f.service, &retry)
        .unwrap()
        .verify(&f.dir, retry.provider, || false)
        .unwrap()
        .input(f.chat.messages[0].id.clone())
        .unwrap();
    let contract = f
        .service
        .response_contract(&f.chat.messages[0].id)
        .unwrap()
        .unwrap();
    let expected = original
        .with_response_contract(&contract)
        .content_blocks(retry.provider);
    let pinned_contract = serde_json::to_value(&contract).unwrap();
    f.record.delete(&f.service);
    let prepared = lifecycle::prepare_with_images(&f.service, &retry, &f.dir).unwrap();
    f.assert_retried(&prepared.started.chat, true);
    assert_eq!(pinned_rows(&f.service), immutable);
    assert_ne!(prepared.ai_run.id, f.old_run.id);
    assert_eq!(
        prepared.started.chat.messages[0].ai_run_id.as_ref(),
        Some(&prepared.ai_run.id)
    );
    assert_eq!(prepared.input.content_blocks(retry.provider), expected);
    assert_eq!(
        serde_json::to_value(
            f.service
                .response_contract(&f.chat.messages[0].id)
                .unwrap()
                .unwrap()
        )
        .unwrap(),
        pinned_contract
    );
    f.record.assert_absent(&f.service);
    let completed = f.service.finish_chat_turn_with_ai_run(ChatFinishRequest {
        scope: scope(&prepared.started.chat), turn_id: prepared.started.turn_id,
        assistant_text: json!({"version":contract.version(),"requestId":contract.request_id(),"markdown":"Completed historical review"}).to_string(),
    }, &prepared.ai_run.id).unwrap();
    let composed = compose(&f.service, &completed, "Next Session question");
    let next = StartChatJobRequest {
        intent: crate::commands::chat::ChatSendIntent::Composer,
        ..request(&composed)
    };
    let prepared = lifecycle::prepare_with_images(&f.service, &next, &f.dir).unwrap();
    assert_eq!(prepared.started.chat.messages.len(), 3);
    assert_eq!(
        prepared.started.chat.messages[0].context,
        f.chat.messages[0].context
    );
    assert_eq!(
        prepared.started.chat.messages[0].images,
        f.chat.messages[0].images
    );
    assert_eq!(
        prepared.started.chat.messages[2].context,
        ChatTarget::Session
    );
    assert!(prepared.input.text().contains("Pinned unsaved evidence"));
    assert!(prepared.input.text().contains("Next Session question"));
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
fn source_deletion_after_verification_before_commit_preserves_the_retry() {
    for kind in [Kind::Finding, Kind::TestCases] {
        let f = Fixture::new(kind, Terminal::Failed);
        let retry = request(&f.chat);
        let immutable = pinned_rows(&f.service);
        let verified = preparation::ChatPreparationSnapshot::capture(&f.service, &retry)
            .unwrap()
            .verify(&f.dir, retry.provider, || false)
            .unwrap();
        f.record.delete(&f.service);
        let prepared = lifecycle::commit(&f.service, &retry, verified).unwrap();
        f.assert_retried(&prepared.started.chat, true);
        assert_eq!(pinned_rows(&f.service), immutable);
        assert_ne!(prepared.ai_run.id, f.old_run.id);
        assert_eq!(
            prepared.started.chat.messages[0].ai_run_id.as_ref(),
            Some(&prepared.ai_run.id)
        );
        f.record.assert_absent(&f.service);
    }
}
