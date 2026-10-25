use super::*;

fn changed_actions(kind: Kind) {
    for action in [
        RefinementAction::Stage,
        RefinementAction::Dismiss,
        RefinementAction::Undo,
        RefinementAction::Discard,
        RefinementAction::Abandon,
    ] {
        let f = Fixture::new(kind);
        let offered = f.offered(kind);
        let before = if matches!(action, RefinementAction::Stage | RefinementAction::Dismiss) {
            offered
        } else {
            f.action(&offered, RefinementAction::Stage).unwrap()
        };
        let b = f.other();
        let changed = f.action(&before, action).unwrap();
        let expected_order =
            if matches!(action, RefinementAction::Stage | RefinementAction::Dismiss) {
                6
            } else {
                7
            };
        assert_eq!(changed.proposals[0].before, before.proposals[0].before);
        assert_eq!(changed.proposals[0].after, before.proposals[0].after);
        assert_eq!(changed.messages, before.messages);
        assert_eq!(changed.revision, before.revision + 1);
        match (&changed.proposals[0].state, action) {
            (RefinementState::Staged { .. }, RefinementAction::Stage)
            | (RefinementState::Dismissed, RefinementAction::Dismiss)
            | (
                RefinementState::Undone { .. },
                RefinementAction::Undo | RefinementAction::Discard,
            )
            | (RefinementState::Abandoned { .. }, RefinementAction::Abandon) => (),
            other => panic!("Unexpected proposal state: {other:?}"),
        }
        eprintln!(
            "{kind:?} proposal {action:?} before={} other={} changed={}",
            before.last_active_order, b.last_active_order, changed.last_active_order
        );
        assert_eq!(
            changed.last_active_order, expected_order,
            "committed proposal state changes must advance activity"
        );
        f.history(
            [&changed.draft_id, &b.draft_id],
            [expected_order, expected_order - 1],
        );
    }
}
#[test]
fn finding_proposal_state_changes_advance_activity() {
    changed_actions(Kind::Finding);
}
#[test]
fn test_cases_proposal_state_changes_advance_activity() {
    changed_actions(Kind::TestCases);
}

#[test]
fn proposal_replays_rejections_and_failed_transactions_preserve_activity() {
    for kind in Kind::ALL {
        for action in [
            RefinementAction::Stage,
            RefinementAction::Undo,
            RefinementAction::Discard,
            RefinementAction::Abandon,
        ] {
            let f = Fixture::new(kind);
            let offered = f.offered(kind);
            let staged = f.action(&offered, RefinementAction::Stage).unwrap();
            let current = if matches!(action, RefinementAction::Stage) {
                staged
            } else {
                f.action(&staged, action).unwrap()
            };
            let b = f.other();
            let replay = f.action(&current, action).unwrap();
            assert_eq!(activity(&replay), activity(&current));
            assert_eq!(replay.proposals, current.proposals);
            assert_eq!(f.read(&b), b);
            assert!(f.action(&offered, RefinementAction::Dismiss).is_err());
            assert_eq!(f.read(&replay), replay);
            assert!(f.action(&replay, RefinementAction::Dismiss).is_err());
            assert_eq!(f.read(&replay), replay);
        }
        let f = Fixture::new(kind);
        let offered = f.offered(kind);
        let b = f.other();
        f.fail_activity();
        assert!(
            f.action(&offered, RefinementAction::Stage)
                .unwrap_err()
                .to_string()
                .contains("Injected activity failure")
        );
        assert_eq!(f.read(&offered), offered);
        assert_eq!(
            f.service
                .database()
                .connection()
                .query_row("SELECT count(*) FROM chat_editor_stages", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(f.read(&b), b);
        f.allow_activity();
    }
}

#[test]
fn record_save_settlement_is_not_a_chat_activity_producer() {
    for kind in Kind::ALL {
        let f = Fixture::new(kind);
        let offered = f.offered(kind);
        let staged = f.action(&offered, RefinementAction::Stage).unwrap();
        let RefinementState::Staged { stage } = &staged.proposals[0].state else {
            unreachable!()
        };
        let origin = RecordWriteOrigin::Proposal {
            stage_id: stage.id.clone(),
        };
        let b = f.other();
        match &f.record {
            ConversationRecord::Finding { record_id } => {
                let original = f
                    .service
                    .list_findings(&f.id)
                    .unwrap()
                    .into_iter()
                    .find(|r| r.id == *record_id)
                    .unwrap();
                let mut guard = RecordWriteGuard::finding(&original);
                guard.origin = origin;
                let saved = f
                    .service
                    .update_finding(
                        record_id,
                        FindingPatch {
                            title: Some("Refined title".into()),
                            ..Default::default()
                        },
                        guard,
                    )
                    .unwrap()
                    .into_saved()
                    .unwrap();
                assert_eq!(saved.title, "Refined title");
                assert_eq!(saved.body, "<p>Original</p>");
            }
            ConversationRecord::TestCasesDraft { record_id } => {
                let original = f
                    .service
                    .list_drafts(&f.id)
                    .unwrap()
                    .into_iter()
                    .find(|r| r.id == *record_id)
                    .unwrap();
                let mut guard = RecordWriteGuard::draft(&original);
                guard.origin = origin;
                let saved = f
                    .service
                    .update_draft(
                        record_id,
                        DraftPatch {
                            title: Some("Refined title".into()),
                            ..Default::default()
                        },
                        guard,
                    )
                    .unwrap()
                    .into_saved()
                    .unwrap();
                assert_eq!(saved.title, "Refined title");
                assert_eq!(saved.body, "<p>Original</p>");
            }
        }
        let settled = f.read(&staged);
        assert!(matches!(
            settled.proposals[0].state,
            RefinementState::Saved { .. }
        ));
        assert_eq!(activity(&settled), activity(&staged));
        assert_eq!(f.read(&b), b);
    }
}
