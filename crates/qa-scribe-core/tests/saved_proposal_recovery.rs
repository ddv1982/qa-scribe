use qa_scribe_core::{QaScribeError, domain::*};
use serde_json::json;

#[path = "saved_proposal_recovery/support.rs"]
mod support;

use support::{
    Fixture, Kind, assert_conflict, assert_content, assert_readonly, content, original_content,
};

#[test]
fn unchanged_saved_proposal_recovers_after_public_submit_or_restart_without_history_writes() {
    for kind in [Kind::Finding, Kind::TestCases] {
        for archive in [false, true] {
            let fixture = Fixture::new(kind);
            let committed = fixture.save(original_content(), fixture.guard.clone());
            assert_content(&committed, &original_content(), kind);
            let saved = fixture.saved_chat();
            let expected_stage = match &fixture.chat.proposals[0].state {
                RefinementState::Staged { stage } => stage.clone(),
                _ => panic!("Staged"),
            };
            assert_eq!(
                saved.proposals[0].state,
                RefinementState::Saved {
                    stage: expected_stage
                }
            );
            let receipt = fixture.freeze(archive);
            if let Some(receipt) = &receipt {
                assert_eq!(fixture.saved_chat().submission.as_ref(), Some(receipt));
            }
            let history = fixture.history();
            fixture.forbid_history_writes();
            let repeated = fixture.save(original_content(), fixture.guard.clone());
            assert_content(&repeated, &original_content(), kind);
            assert_eq!(fixture.history(), history);
            let local = json!({"title":"Later retained L"});
            let retry = kind.write(
                &fixture.service,
                &fixture.original,
                local,
                fixture.guard.clone(),
            );
            let recovered = retry.expect("an exact Saved Proposal with unchanged canonical A must save L after submission or archival").into_saved().unwrap();
            let mut expected = original_content();
            expected["title"] = json!("Later retained L");
            assert_content(&recovered, &expected, kind);
            assert_eq!(kind.read(&fixture.service, &fixture.original), recovered);
            assert_eq!(fixture.history(), history);
            println!(
                "RECOVERED {kind:?} archive={archive} title={}",
                recovered["title"]
            );
        }
    }
}

#[test]
fn changed_commit_and_later_remote_write_keep_repeated_stale_saves_conflicting() {
    for kind in [Kind::Finding, Kind::TestCases] {
        for archive in [false, true] {
            let fixture = Fixture::new(kind);
            let b_content = content(
                "Committed B",
                "Committed body B",
                "{\"private\":true,\"source\":\"B\"}",
            );
            let committed = fixture.save(b_content.clone(), fixture.guard.clone());
            assert_content(&committed, &b_content, kind);
            fixture.freeze(archive);
            let history = fixture.history();
            fixture.forbid_history_writes();
            let local = content(
                "Retained L",
                "Local unsaved body L",
                "{\"private\":true,\"source\":\"L\"}",
            );
            for _ in 0..2 {
                assert_conflict(
                    kind.write(
                        &fixture.service,
                        &fixture.original,
                        local.clone(),
                        fixture.guard.clone(),
                    )
                    .unwrap(),
                    &committed,
                );
                assert_eq!(kind.read(&fixture.service, &fixture.original), committed);
            }
            let c_content = content(
                "Remote C",
                "Remote body C",
                "{\"private\":true,\"source\":\"C\"}",
            );
            let remote = fixture.save(c_content.clone(), kind.guard(&committed));
            assert_content(&remote, &c_content, kind);
            for _ in 0..2 {
                assert_conflict(
                    kind.write(
                        &fixture.service,
                        &fixture.original,
                        local.clone(),
                        fixture.guard.clone(),
                    )
                    .unwrap(),
                    &remote,
                );
                assert_eq!(kind.read(&fixture.service, &fixture.original), remote);
            }
            let editor = fixture.save(json!({"title":"Confirmed Editor D"}), kind.guard(&remote));
            let mut expected = c_content;
            expected["title"] = json!("Confirmed Editor D");
            assert_content(&editor, &expected, kind);
            assert_eq!(fixture.history(), history);
        }
    }
}

#[test]
fn saved_followup_uses_the_current_hash_and_content_aba_keeps_the_existing_contract() {
    for kind in [Kind::Finding, Kind::TestCases] {
        for archive in [false, true] {
            let fixture = Fixture::new(kind);
            let committed = fixture.save(
                content("Committed B", "Body B", "{\"source\":\"B\"}"),
                fixture.guard.clone(),
            );
            fixture.freeze(archive);
            let history = fixture.history();
            fixture.forbid_history_writes();
            let mut fresh = kind.guard(&committed);
            assert_ne!(
                fresh.expected_stored_base,
                fixture.guard.expected_stored_base
            );
            fresh.origin = fixture.guard.origin.clone();
            let followup = fixture.save(json!({"title":"Saved followup with fresh B"}), fresh);
            assert_eq!(followup["title"], "Saved followup with fresh B");
            let restored = fixture.save(original_content(), kind.guard(&followup));
            assert_eq!(
                kind.guard(&restored).expected_stored_base,
                fixture.guard.expected_stored_base
            );
            let recovered = fixture.save(
                json!({"title":"Allowed after content ABA"}),
                fixture.guard.clone(),
            );
            let mut expected = original_content();
            expected["title"] = json!("Allowed after content ABA");
            assert_content(&recovered, &expected, kind);
            assert_eq!(fixture.history(), history);
        }
    }
}

#[test]
fn saved_identity_mismatches_fail_even_with_the_correct_current_record_hash() {
    for kind in [Kind::Finding, Kind::TestCases] {
        for mismatch in [
            "other_record",
            "other_table",
            "other_session",
            "snapshot_session",
            "owning_chat_session",
            "missing_stage",
            "embedded_stage",
        ] {
            let fixture = Fixture::new(kind);
            fixture.save(original_content(), fixture.guard.clone());
            let mut target_kind = kind;
            let mut record = kind.read(&fixture.service, &fixture.original);
            match mismatch {
                "other_record" => record = kind.create(&fixture.service, &fixture.chat.session_id),
                "other_table" => {
                    target_kind = match kind {
                        Kind::Finding => Kind::TestCases,
                        Kind::TestCases => Kind::Finding,
                    };
                    record = target_kind.create(&fixture.service, &fixture.chat.session_id);
                }
                "other_session" => {
                    let session = fixture
                        .service
                        .create_session(SessionDraft {
                            title: "Other Session".into(),
                            ..Default::default()
                        })
                        .unwrap();
                    record = kind.create(&fixture.service, &session.id);
                }
                "snapshot_session" | "embedded_stage" => {
                    let mut proposal = fixture.saved_chat().proposals[0].clone();
                    if mismatch == "snapshot_session" {
                        match &mut proposal.target {
                            ChatTarget::Finding { snapshot }
                            | ChatTarget::TestCasesDraft { snapshot } => {
                                snapshot.session_id = "wrong snapshot Session".into()
                            }
                            _ => panic!("record target"),
                        }
                    } else if let RefinementState::Saved { stage } = &mut proposal.state {
                        stage.id = "wrong embedded stage".into();
                    }
                    fixture.replace_proposal(&proposal);
                }
                "missing_stage" => {
                    fixture
                        .service
                        .database()
                        .connection()
                        .execute(
                            "DELETE FROM chat_editor_stages WHERE id=?1",
                            [fixture.guard.stage_id().unwrap()],
                        )
                        .unwrap();
                }
                _ => {}
            }
            if mismatch == "owning_chat_session" {
                let session = fixture
                    .service
                    .create_session(SessionDraft {
                        title: "Wrong Chat owner".into(),
                        ..Default::default()
                    })
                    .unwrap();
                fixture
                    .service
                    .database()
                    .connection()
                    .execute(
                        "UPDATE chat_drafts SET session_id=?1 WHERE id=?2",
                        [&session.id, &fixture.chat.draft_id],
                    )
                    .unwrap();
                fixture.synthetic_readonly(true);
            } else {
                fixture.freeze(false);
            }
            let mut guard = target_kind.guard(&record);
            guard.origin = fixture.guard.origin.clone();
            assert_eq!(
                guard.expected_stored_base,
                target_kind
                    .guard(&target_kind.read(&fixture.service, &record))
                    .expected_stored_base
            );
            let history = fixture.history();
            fixture.forbid_history_writes();
            let result = target_kind.write(
                &fixture.service,
                &record,
                json!({"title":"Must not write"}),
                guard,
            );
            match mismatch {
                "missing_stage" => assert!(
                    matches!(
                        result,
                        Err(QaScribeError::Sqlite(rusqlite::Error::QueryReturnedNoRows))
                    ),
                    "{result:?}"
                ),
                "embedded_stage" => assert!(
                    matches!(result, Err(QaScribeError::Validation(ref message)) if message == "Proposal stage is no longer saveable"),
                    "{result:?}"
                ),
                _ => assert!(
                    matches!(result, Err(QaScribeError::Validation(ref message)) if message == "Stage belongs to another record"),
                    "{mismatch} {result:?}"
                ),
            }
            assert_eq!(target_kind.read(&fixture.service, &record), record);
            assert_eq!(fixture.history(), history);
        }
    }
}

#[test]
fn unsaved_and_other_terminal_proposals_never_enter_saved_recovery() {
    for kind in [Kind::Finding, Kind::TestCases] {
        for state in ["offered", "dismissed", "undone", "abandoned", "reverted"] {
            for readonly in [None, Some(false), Some(true)] {
                let fixture = Fixture::new(kind);
                let mut proposal = fixture.chat.proposals[0].clone();
                let stage = match &proposal.state {
                    RefinementState::Staged { stage } => stage.clone(),
                    _ => panic!("Staged"),
                };
                proposal.state =
                    serde_json::from_value(json!({"kind":state,"stage":stage})).unwrap();
                fixture.replace_proposal(&proposal);
                if let Some(archive) = readonly {
                    fixture.freeze(archive);
                }
                let history = fixture.history();
                let result = kind.write(
                    &fixture.service,
                    &fixture.original,
                    json!({"title":"Must not apply"}),
                    fixture.guard.clone(),
                );
                if readonly.is_some() {
                    assert_readonly(result);
                } else {
                    assert!(
                        matches!(result, Err(QaScribeError::Validation(ref message)) if message == "Proposal stage is no longer saveable"),
                        "{state} {result:?}"
                    );
                }
                assert_eq!(
                    kind.read(&fixture.service, &fixture.original),
                    fixture.original
                );
                assert_eq!(fixture.history(), history);
            }
        }
        for archive in [false, true] {
            let fixture = Fixture::new(kind);
            fixture.synthetic_readonly(archive);
            let history = fixture.history();
            assert_readonly(kind.write(
                &fixture.service,
                &fixture.original,
                json!({"title":"Must not settle Staged"}),
                fixture.guard.clone(),
            ));
            assert_eq!(
                kind.read(&fixture.service, &fixture.original),
                fixture.original
            );
            assert_eq!(fixture.history(), history);
        }
    }
}

#[test]
fn saved_and_reverted_stage_compensation_stays_readonly_including_restored_replay() {
    for kind in [Kind::Finding, Kind::TestCases] {
        for archive in [false, true] {
            for reverted in [false, true] {
                for replay in [false, true] {
                    let fixture = Fixture::new(kind);
                    let committed = fixture.save(
                        content("Committed B", "Body B", "{\"source\":\"B\"}"),
                        fixture.guard.clone(),
                    );
                    let mut compensation = kind.guard(&committed);
                    compensation.origin = RecordWriteOrigin::Compensation {
                        stage_id: fixture.guard.stage_id().map(String::from),
                        restored_base: fixture.guard.expected_stored_base.clone(),
                    };
                    if reverted {
                        fixture.save(original_content(), compensation.clone());
                    } else if replay {
                        fixture.save(original_content(), kind.guard(&committed));
                    }
                    let current = kind.read(&fixture.service, &fixture.original);
                    if !replay {
                        compensation.expected_stored_base =
                            kind.guard(&current).expected_stored_base;
                    }
                    let chat = fixture.saved_chat();
                    assert_eq!(
                        matches!(chat.proposals[0].state, RefinementState::Reverted { .. }),
                        reverted
                    );
                    fixture.freeze(archive);
                    let history = fixture.history();
                    fixture.forbid_history_writes();
                    assert_readonly(kind.write(
                        &fixture.service,
                        &fixture.original,
                        original_content(),
                        compensation,
                    ));
                    assert_eq!(kind.read(&fixture.service, &fixture.original), current);
                    assert_eq!(fixture.history(), history);
                }
            }
        }
    }
}

#[test]
fn compensation_without_stage_keeps_restore_validation_replay_and_conflicts() {
    for kind in [Kind::Finding, Kind::TestCases] {
        for archive in [false, true] {
            let fixture = Fixture::new(kind);
            fixture.save(original_content(), fixture.guard.clone());
            fixture.freeze(archive);
            let history = fixture.history();
            fixture.forbid_history_writes();
            let committed =
                fixture.save(json!({"title":"Editor B"}), kind.guard(&fixture.original));
            let mut compensation = kind.guard(&committed);
            compensation.origin = RecordWriteOrigin::Compensation {
                stage_id: None,
                restored_base: fixture.guard.expected_stored_base.clone(),
            };
            let invalid = kind.write(
                &fixture.service,
                &fixture.original,
                json!({"title":"Wrong restoration"}),
                compensation.clone(),
            );
            assert!(
                matches!(invalid, Err(QaScribeError::Validation(ref message)) if message == "Compensation does not match its pinned restored record"),
                "{invalid:?}"
            );
            assert_eq!(kind.read(&fixture.service, &fixture.original), committed);
            let restored = fixture.save(original_content(), compensation.clone());
            assert_content(&restored, &original_content(), kind);
            assert_eq!(
                fixture.save(original_content(), compensation.clone()),
                restored
            );
            let remote = fixture.save(json!({"title":"Later remote C"}), kind.guard(&restored));
            assert_conflict(
                kind.write(
                    &fixture.service,
                    &fixture.original,
                    original_content(),
                    compensation,
                )
                .unwrap(),
                &remote,
            );
            assert_eq!(kind.read(&fixture.service, &fixture.original), remote);
            assert_eq!(fixture.history(), history);
        }
    }
}

#[test]
fn saved_readonly_recovery_keeps_ordinary_record_patch_validation() {
    for kind in [Kind::Finding, Kind::TestCases] {
        let fixture = Fixture::new(kind);
        let committed = fixture.save(original_content(), fixture.guard.clone());
        fixture.freeze(false);
        let history = fixture.history();
        fixture.forbid_history_writes();
        let invalid = kind.write(
            &fixture.service,
            &fixture.original,
            json!({"title":""}),
            fixture.guard.clone(),
        );
        assert!(
            matches!(invalid, Err(QaScribeError::Validation(ref message)) if message.contains("title")),
            "{invalid:?}"
        );
        assert_eq!(kind.read(&fixture.service, &fixture.original), committed);
        assert_eq!(fixture.history(), history);
    }
}
