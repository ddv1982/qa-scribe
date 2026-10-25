use std::{env, path::PathBuf};

use qa_scribe_core::{domain::*, services::SessionService, storage::Database};
use rusqlite::params;
use serde_json::json;

fn scope(chat: &ChatState) -> ChatRevision {
    ChatRevision {
        session_id: chat.session_id.clone(),
        draft_id: chat.draft_id.clone(),
        expected_revision: chat.revision,
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if qa_scribe_core::storage::SCHEMA_VERSION != 18 {
        return Err("Generate schema 18 only from the recorded baseline checkout".into());
    }
    let root = PathBuf::from(
        env::args_os()
            .nth(1)
            .ok_or("expected a new UI performance fixture directory")?,
    );
    let marker: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("ui-perf-fixture.json"))?)?;
    assert_eq!(marker["schema"], "qa-scribe-ui-perf-fixture-v1");
    let service = SessionService::new(Database::open(root.join("qa-scribe.sqlite"))?)?;
    if env::args().nth(2).as_deref() == Some("--verify") {
        let main = service.load_chat("perf-session")?;
        assert_eq!(main.messages.len(), 100);
        assert_eq!(main.composer, "ISOLATION_ACTIVE_UNSENT_INPUT");
        assert_eq!(
            main.messages.iter().map(|m| m.images.len()).sum::<usize>(),
            4
        );
        let submitted = service.load_chat("isolation-submitted")?;
        assert_eq!(submitted.messages.len(), 10);
        assert_eq!(
            submitted.submission.as_ref().unwrap().note_id,
            "isolation-submitted-note"
        );
        let mixed = service.load_chat("isolation-mixed")?;
        assert_eq!(mixed.messages.len(), 10);
        assert_eq!(mixed.proposals.len(), 3);
        for proposal in &mixed.proposals {
            assert!(matches!(proposal.state, RefinementState::Staged { .. }));
            assert_eq!(
                service.resolve_refinement(RefinementRequest {
                    scope: scope(&mixed),
                    proposal_id: proposal.id.clone(),
                    action: RefinementAction::Stage
                })?,
                mixed
            );
        }
        service
            .database()
            .connection()
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
        println!("public core reopen and stage replay passed");
        return Ok(());
    }
    let timestamp = "2026-01-01T00:00:00Z";
    service.database().with_immediate_tx(|tx| {
        for index in 0..100 {
            let id = format!("isolation-history-{index:03}");
            tx.execute("INSERT INTO chat_drafts(id,session_id,mode,archived,composer,created_at) VALUES(?1,'perf-session','chat',1,?2,?3)", params![id, format!("Retained historical input {index:03}"), timestamp])?;
            for sequence in 0..10 {
                tx.execute("INSERT INTO chat_messages(id,draft_id,turn_id,sequence,role,text,status,created_at) VALUES(?1,?2,?3,?4,?5,?6,'completed',?7)", params![format!("{id}-message-{sequence:02}"), id, format!("{id}-turn-{}", sequence / 2), sequence, if sequence % 2 == 0 {"user"} else {"assistant"}, format!("HISTORY_{index:03}_{sequence:02}. Synthetic retained conversation evidence."), timestamp])?;
            }
        }
        for (id, title, messages) in [("submitted", "Isolation submitted Notes fixture", 10), ("mixed", "Isolation legacy mixed staged fixture", 4)] {
            let session = format!("isolation-{id}");
            tx.execute("INSERT INTO sessions(id,title,created_at,updated_at,last_opened_at) VALUES(?1,?2,?3,?3,?3)", params![session, title, timestamp])?;
            tx.execute("INSERT INTO entries(id,session_id,type,title,body,created_at,updated_at) VALUES(?1,?2,'note',?3,'<p>ISOLATION_NOTE_ORIGINAL</p>',?4,?4)", params![format!("{session}-note"), session, title, timestamp])?;
            tx.execute("INSERT INTO chat_drafts(id,session_id,mode,created_at) VALUES(?1,?2,'chat',?3)", params![format!("{session}-chat"), session, timestamp])?;
            for sequence in 0..messages {
                tx.execute("INSERT INTO chat_messages(id,draft_id,turn_id,sequence,role,text,status,created_at) VALUES(?1,?2,?3,?4,?5,?6,'completed',?7)", params![format!("{session}-message-{sequence:02}"), format!("{session}-chat"), format!("{session}-turn-{}", sequence / 2), sequence, if sequence % 2 == 0 {"user"} else {"assistant"}, format!("ISOLATION_{id}_{sequence:02}"), timestamp])?;
            }
        }
        let document = json!({"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Synthetic original record."}]}]}}).to_string();
        tx.execute("INSERT INTO findings(id,session_id,title,body,body_json,body_format,kind,created_at,updated_at) VALUES('isolation-mixed-finding','isolation-mixed','Legacy mixed finding','<p>Synthetic original record.</p>',?1,'tiptap_json','bug',?2,?2)", params![document, timestamp])?;
        tx.execute("INSERT INTO drafts(id,session_id,title,body,body_json,body_format,kind,created_at,updated_at) VALUES('isolation-mixed-tests','isolation-mixed','Legacy mixed test cases','<p>Synthetic original record.</p>',?1,'tiptap_json','testware',?2,?2)", params![document, timestamp])?;
        Ok(())
    })?;
    let submitted = service.load_chat("isolation-submitted")?;
    let note = service.get_or_create_note_entry("isolation-submitted")?;
    service.submit_chat(ChatSubmitRequest {
        scope: scope(&submitted),
        note_id: note.id,
        expected_note_body: note.body,
        expected_note_body_json: note.body_json,
        expected_note_body_format: note.body_format,
    })?;
    for index in 0..3 {
        let kind = if index == 2 {
            "test_cases_draft"
        } else {
            "finding"
        };
        let (record_id, title, document, record_kind) = if index == 2 {
            let record = service.list_drafts("isolation-mixed")?.remove(0);
            (
                record.id,
                record.title,
                record.body_json.unwrap(),
                "testware",
            )
        } else {
            let record = service.list_findings("isolation-mixed")?.remove(0);
            (record.id, record.title, record.body_json.unwrap(), "bug")
        };
        let target = serde_json::from_value(
            json!({"kind":kind,"snapshot":{"sessionId":"isolation-mixed","recordId":record_id,"title":title,"documentJson":document,"recordKind":record_kind,"metadataJson":null,"origin":"saved","localFingerprint":"","storedBaseToken":""}}),
        )?;
        let chat = service.load_chat("isolation-mixed")?;
        let chat = service.save_chat_composer(serde_json::from_value(json!({
            "scope": scope(&chat),
            "composer": format!("Synthetic legacy refinement {index}"),
            "mode": "chat",
            "attachmentIds": []
        }))?)?;
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
            .ok_or("missing user message")?;
        let contract = service
            .response_contract(&user.id)?
            .ok_or("missing contract")?;
        let chat = service.finish_chat_turn(ChatFinishRequest {
            scope: scope(&started.chat), turn_id: started.turn_id,
            assistant_text: json!({"version":contract.version(),"requestId":contract.request_id(),"markdown":format!("Synthetic legacy suggestion {index}."),"refinement":{"kind":kind,"title":format!("Legacy refined title {index}"),"bodyMarkdown":format!("Synthetic refined body {index}.")}}).to_string(),
        })?;
        let proposal = chat.proposals.last().ok_or("missing proposal")?;
        service.resolve_refinement(RefinementRequest {
            scope: scope(&chat),
            proposal_id: proposal.id.clone(),
            action: RefinementAction::Stage,
        })?;
    }
    let mixed = service.load_chat("isolation-mixed")?;
    assert_eq!(mixed.messages.len(), 10);
    assert_eq!(mixed.proposals.len(), 3);
    assert!(
        mixed
            .proposals
            .iter()
            .all(|p| matches!(p.state, RefinementState::Staged { .. }))
    );
    let main = service.load_chat("perf-session")?;
    service.save_chat_composer(serde_json::from_value(json!({
        "scope": scope(&main),
        "composer": "ISOLATION_ACTIVE_UNSENT_INPUT",
        "mode": "chat",
        "attachmentIds": []
    }))?)?;
    service
        .database()
        .connection()
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    println!(
        "{}",
        json!({"historicalConversations":100,"historicalMessagesEach":10,"mainActiveMessages":100,"submittedMessages":10,"mixedMessages":10,"stagedProposals":3,"competingFindingStages":2,"managedImages":4,"providerInvoked":false})
    );
    Ok(())
}
