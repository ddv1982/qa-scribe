use std::{env, path::PathBuf};

use qa_scribe_core::{domain::*, services::SessionService, storage::Database};
use serde_json::json;

fn scope(chat: &ChatState) -> ChatRevision {
    ChatRevision {
        session_id: chat.session_id.clone(),
        draft_id: chat.draft_id.clone(),
        expected_revision: chat.revision,
    }
}

fn document(text: &str) -> String {
    json!({"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":text}]}]}}).to_string()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(env::args_os().nth(1).ok_or(
        "usage: generate_ui_perf_refinement <existing-disposable-ui-perf-app-data-directory>",
    )?);
    let receipt_path = root.join("ui-perf-refinement.json");
    let main_marker = std::fs::read(root.join("ui-perf-fixture.json"))?;
    let marker: serde_json::Value = serde_json::from_slice(&main_marker)?;
    if marker["schema"] != "qa-scribe-ui-perf-fixture-v1"
        || !root.join("qa-scribe.sqlite").is_file()
        || receipt_path.exists()
    {
        return Err("requires a fresh main performance fixture without a companion receipt".into());
    }
    let service = SessionService::new(Database::open(root.join("qa-scribe.sqlite"))?)?;
    let companion_title = "Native refinement performance fixture";
    if service
        .list_sessions()?
        .iter()
        .any(|s| s.title == companion_title)
    {
        return Err(
            "companion Session already exists; generate a fresh disposable main fixture".into(),
        );
    }
    let main_chat = service.load_chat("perf-session")?;
    let main_findings = service.list_findings("perf-session")?;
    let main_session = service.get_session("perf-session")?;
    assert_eq!(main_chat.messages.len(), 100);
    assert_eq!(
        main_chat
            .messages
            .iter()
            .map(|m| m.images.len())
            .sum::<usize>(),
        4
    );
    let session = service.create_session(SessionDraft {
        title: companion_title.into(),
        ..Default::default()
    })?;
    service.database().connection().execute(
        "UPDATE sessions SET created_at='2025-12-31T00:00:00Z', updated_at='2025-12-31T00:00:00Z', last_opened_at='2025-12-31T00:00:00Z' WHERE id=?1",
        [&session.id],
    )?;
    let mut cases = Vec::new();
    for index in 0..20 {
        let before_title = format!("PERF R1 {index:02} delayed receipt after checkout");
        let after_title = format!("PERF R1 {index:02} checkout confirmation shows receipt");
        let before_text = format!(
            "Case {index:02}. Checkout confirmation appears before the receipt details. Complete an order and open confirmation. Expected order number and total appear immediately."
        );
        let after_text = format!(
            "Case {index:02}. After completing an order, confirmation shows the receipt immediately. Reopen confirmation and verify the order number and total are present."
        );
        let record = service.create_finding(FindingDraft {
            session_id: session.id.clone(),
            title: before_title.clone(),
            body: format!("<p>{before_text}</p>"),
            body_json: Some(document(&before_text)),
            body_format: Some("tiptap_json".into()),
            kind: FindingKind::Bug,
            metadata_json: None,
        })?;
        let target = ChatTarget::Finding {
            snapshot: RecordContextSnapshot {
                session_id: session.id.clone(),
                record_id: record.id.clone(),
                title: record.title.clone(),
                document_json: record.body_json.clone().ok_or("missing rich body")?,
                metadata_json: record.metadata_json.clone(),
                record_kind: "bug".into(),
                origin: RecordSnapshotOrigin::Saved,
                local_fingerprint: String::new(),
                stored_base_token: String::new(),
            },
        };
        let chat = service.load_chat(&session.id)?;
        let chat = service.save_chat_composer(ChatComposerRequest {
            scope: scope(&chat),
            composer: "Clarify the receipt expectation while retaining the reproduction steps."
                .into(),
            mode: ChatMode::Chat,
            attachment_ids: vec![],
        })?;
        let started = service.start_chat_turn_with_response(
            ChatStartRequest {
                scope: scope(&chat),
            },
            target,
            ChatRequestIntent::RefineRecord,
        )?;
        let user = started
            .chat
            .messages
            .iter()
            .find(|m| m.turn_id == started.turn_id && m.role == ChatRole::User)
            .ok_or("missing started user message")?;
        let contract = service
            .response_contract(&user.id)?
            .ok_or("missing V2 contract")?;
        assert!(matches!(&contract, ChatResponseContract::Current(_)));
        assert_eq!(contract.version(), 2);
        assert_eq!(contract.request_id(), user.id);
        assert!(matches!(
            contract.purpose(),
            ChatResponsePurpose::Refinement {
                record_kind: RefinementRecordKind::Finding
            }
        ));
        let context_bytes = serde_json::to_vec(&user.context)?.len();
        assert!(context_bytes < 32 * 1024);
        let request_id = contract.request_id().to_owned();
        let completed = service.finish_chat_turn(ChatFinishRequest {
            scope: scope(&started.chat),
            turn_id: started.turn_id.clone(),
            assistant_text: json!({"version":2,"requestId":request_id,"markdown":"Clarify when receipt details must be visible and what the tester verifies.","refinement":{"kind":"finding","title":after_title,"bodyMarkdown":after_text}}).to_string(),
        })?;
        let proposal = completed
            .proposals
            .iter()
            .find(|p| p.user_message_id == user.id)
            .ok_or("completed response did not produce a proposal")?;
        assert!(matches!(proposal.state, RefinementState::Offered));
        assert_eq!(proposal.before.title, before_title);
        assert_eq!(proposal.after.title, after_title);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&proposal.after.document_json)?,
            serde_json::from_str::<serde_json::Value>(&document(&after_text))?
        );
        cases.push(json!({"recordId":record.id,"proposalId":proposal.id,"requestId":request_id,"contractVersion":2,"contextBytes":context_bytes,"beforeTitle":before_title,"afterTitle":after_title,"beforeBodyText":before_text,"afterBodyText":after_text,"beforeRecord":record,"before":proposal.before,"after":proposal.after}));
    }
    let chat = service.load_chat(&session.id)?;
    assert_eq!(chat.messages.len(), 40);
    assert_eq!(chat.proposals.len(), 20);
    assert!(
        chat.messages
            .iter()
            .all(|m| m.status == ChatTurnStatus::Completed && m.ai_run_id.is_none())
    );
    assert!(
        chat.proposals
            .iter()
            .all(|p| matches!(p.state, RefinementState::Offered))
    );
    assert!(chat.ai_runs.is_empty());
    assert_eq!(service.load_chat("perf-session")?, main_chat);
    assert_eq!(service.list_findings("perf-session")?, main_findings);
    assert_eq!(service.get_session("perf-session")?, main_session);
    assert_eq!(
        std::fs::read(root.join("ui-perf-fixture.json"))?,
        main_marker
    );
    let violations: i64 = service.database().connection().query_row(
        "SELECT count(*) FROM pragma_foreign_key_check",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(violations, 0);
    service
        .database()
        .connection()
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    let receipt = json!({"schema":"qa-scribe-ui-perf-refinement-v1","sessionId":session.id,"sessionTitle":companion_title,"messages":40,"proposals":20,"images":0,"aiRuns":0,"providerInvoked":false,"mainFixtureUnchanged":true,"foreignKeyViolations":violations,"workload":"Twenty short realistic finding refinements in one companion Session. Separate from the shared 100-message, four-image, long-record workload. Not a 100 KB proposal benchmark.","cases":cases});
    std::fs::write(receipt_path, format!("{receipt}\n"))?;
    println!("{receipt}");
    Ok(())
}
