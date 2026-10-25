use super::*;
use qa_scribe_core::QaScribeError;

#[test]
fn fresh_missing_foreign_and_wrong_kind_preparation_retains_input_and_images() {
    for kind in [Kind::Finding, Kind::TestCases] {
        for case in ["missing", "foreign_snapshot", "foreign_live", "wrong_kind"] {
            if case == "wrong_kind" && matches!(kind, Kind::Finding) {
                continue;
            }
            let f = Fixture::new(kind, Terminal::Failed);
            let fresh = f
                .service
                .restart_chat(ChatRestartRequest {
                    scope: scope(&f.chat),
                })
                .unwrap();
            let fresh = attach_image(&f.service, &f.dir, &fresh);
            let fresh = compose(&f.service, &fresh, "Fresh input retained");
            let mut context = f.record.target();
            match case {
                "missing" => f.record.delete(&f.service),
                "wrong_kind" => {
                    f.service
                        .database()
                        .connection()
                        .execute(
                            "UPDATE drafts SET kind = 'session_report' WHERE id = ?1",
                            [f.record.row().1],
                        )
                        .unwrap();
                }
                _ => {
                    let foreign = session(&f.service);
                    let (table, id) = f.record.row();
                    f.service
                        .database()
                        .connection()
                        .execute(
                            &format!("UPDATE {table} SET session_id = ?1 WHERE id = ?2"),
                            rusqlite::params![foreign, id],
                        )
                        .unwrap();
                    if case == "foreign_snapshot" {
                        match &mut context {
                            ChatTarget::Finding { snapshot }
                            | ChatTarget::TestCasesDraft { snapshot } => {
                                snapshot.session_id = foreign
                            }
                            _ => unreachable!(),
                        }
                    }
                }
            }
            let before = rows(&f.service);
            let request = StartChatJobRequest {
                intent: crate::commands::chat::ChatSendIntent::Composer,
                context,
                ..request(&fresh)
            };
            let error = match lifecycle::prepare_with_images(&f.service, &request, &f.dir) {
                Err(e) => e,
                Ok(_) => panic!("Invalid fresh context accepted"),
            };
            if case == "missing" {
                assert!(matches!(error, QaScribeError::NotFound(_)));
            } else {
                assert!(matches!(error, QaScribeError::Validation(_)));
            }
            assert_eq!(f.service.load_chat(&fresh.session_id).unwrap(), fresh);
            assert_eq!(rows(&f.service), before);
        }
    }
}

#[test]
fn persisted_foreign_snapshot_still_rejects_preparation_without_a_source() {
    for kind in [Kind::Finding, Kind::TestCases] {
        let (service, chat) = forged_snapshot(kind);
        let before = rows(&service);
        let error = match preparation::ChatPreparationSnapshot::capture(&service, &request(&chat)) {
            Err(e) => e,
            Ok(_) => panic!("Foreign snapshot accepted"),
        };
        assert!(
            matches!(error, QaScribeError::Validation(s) if s == "Record context must belong to the chat Session")
        );
        assert_eq!(service.load_chat(&chat.session_id).unwrap(), chat);
        assert_eq!(rows(&service), before);
    }
}

#[test]
fn present_replacement_rows_keep_preparation_owner_and_kind_boundaries() {
    for kind in [Kind::Finding, Kind::TestCases] {
        for (foreign, wrong_kind) in [(false, false), (true, false), (false, true)] {
            if wrong_kind && matches!(kind, Kind::Finding) {
                continue;
            }
            let f = Fixture::new(kind, Terminal::Failed);
            replace_source(&f, foreign, wrong_kind);
            let before = rows(&f.service);
            let result = lifecycle::prepare_with_images(&f.service, &request(&f.chat), &f.dir);
            if foreign || wrong_kind {
                let error = match result {
                    Err(e) => e,
                    Ok(_) => panic!("Invalid live replacement accepted"),
                };
                let expected = if foreign {
                    "Record context must belong to the chat Session"
                } else {
                    "Only Test cases drafts can be used as record context"
                };
                assert!(matches!(error, QaScribeError::Validation(s) if s == expected));
                assert_eq!(rows(&f.service), before);
            } else {
                let prepared = result.unwrap();
                assert_eq!(
                    prepared.started.chat.messages[0].context,
                    f.chat.messages[0].context
                );
                assert!(
                    !prepared
                        .input
                        .text()
                        .contains("Replacement title must not replay")
                );
            }
        }
    }
}

#[test]
fn preparation_propagates_sql_errors_without_mutation() {
    for kind in [Kind::Finding, Kind::TestCases] {
        let f = Fixture::new(kind, Terminal::Failed);
        f.service
            .database()
            .connection()
            .execute_batch(&format!("DROP TABLE {}", f.record.row().0))
            .unwrap();
        let before = rows(&f.service);
        let result = preparation::ChatPreparationSnapshot::capture(&f.service, &request(&f.chat));
        assert!(matches!(result, Err(QaScribeError::Sqlite(_))));
        assert_eq!(rows(&f.service), before);
    }
}
