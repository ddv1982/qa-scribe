use super::support::*;
use qa_scribe_core::{QaScribeError, domain::*};
use serde_json::json;

#[test]
fn fresh_missing_foreign_and_wrong_kind_contexts_retain_composer_and_images() {
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
            let error = f
                .service
                .start_chat_turn_with_context(
                    ChatStartRequest {
                        scope: scope(&fresh),
                    },
                    context,
                )
                .unwrap_err();
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
fn persisted_foreign_snapshot_is_rejected_even_after_its_source_is_deleted() {
    for kind in [Kind::Finding, Kind::TestCases] {
        let (service, chat) = forged_snapshot(kind);
        let before = rows(&service);
        let error = service
            .retry_chat_turn(ChatStartRequest {
                scope: scope(&chat),
            })
            .unwrap_err();
        assert!(
            matches!(error, QaScribeError::Validation(s) if s == "Record context must belong to the chat Session")
        );
        assert_eq!(service.load_chat(&chat.session_id).unwrap(), chat);
        assert_eq!(rows(&service), before);
    }
}

#[test]
fn present_replacement_rows_keep_live_owner_and_test_cases_kind_boundaries() {
    for kind in [Kind::Finding, Kind::TestCases] {
        for (foreign, wrong_kind) in [(false, false), (true, false), (false, true)] {
            if wrong_kind && matches!(kind, Kind::Finding) {
                continue;
            }
            let f = Fixture::new(kind, Terminal::Failed);
            replace_source(&f, foreign, wrong_kind);
            let before = rows(&f.service);
            let result = f.service.retry_chat_turn(ChatStartRequest {
                scope: scope(&f.chat),
            });
            if foreign || wrong_kind {
                let error = result.unwrap_err();
                let expected = if foreign {
                    "Record context must belong to the chat Session"
                } else {
                    "Only Test cases drafts can be used as record context"
                };
                assert!(matches!(error, QaScribeError::Validation(s) if s == expected));
                assert_eq!(rows(&f.service), before);
            } else {
                let retried = result.unwrap();
                assert_eq!(retried.chat.messages[0].context, f.chat.messages[0].context);
                assert_eq!(
                    retried.chat.messages[0].context.snapshot().unwrap().title,
                    "Pinned unsaved title"
                );
            }
        }
    }
}

#[test]
fn retry_propagates_sql_errors_instead_of_treating_them_as_missing_sources() {
    for kind in [Kind::Finding, Kind::TestCases] {
        let f = Fixture::new(kind, Terminal::Failed);
        let (table, _) = f.record.row();
        f.service
            .database()
            .connection()
            .execute_batch(&format!("DROP TABLE {table}"))
            .unwrap();
        let before = rows(&f.service);
        let error = f
            .service
            .retry_chat_turn(ChatStartRequest {
                scope: scope(&f.chat),
            })
            .unwrap_err();
        assert!(matches!(error, QaScribeError::Sqlite(_)));
        assert_eq!(rows(&f.service), before);
    }
}

#[test]
fn deleted_question_context_remains_strict_for_new_choice_and_typed_replies() {
    for kind in [Kind::Finding, Kind::TestCases] {
        let f = Fixture::new(kind, Terminal::Failed);
        let retried = f
            .service
            .retry_chat_turn(ChatStartRequest {
                scope: scope(&f.chat),
            })
            .unwrap();
        let contract = f
            .service
            .response_contract(&retried.chat.messages[0].id)
            .unwrap()
            .unwrap();
        let completed = f.service.finish_chat_turn(ChatFinishRequest {
            scope: scope(&retried.chat), turn_id: retried.turn_id,
            assistant_text: json!({"version":contract.version(),"requestId":contract.request_id(),"markdown":"Choose","question":{"prompt":"Which?","choices":["First","Second"]}}).to_string(),
        }).unwrap();
        let assistant = completed.messages.last().unwrap();
        assert!(assistant.response.as_ref().unwrap().question.is_some());
        f.record.delete(&f.service);
        let before = rows(&f.service);
        let choice = f.service.start_chat_turn_with_response(
            ChatStartRequest {
                scope: scope(&completed),
            },
            f.record.target(),
            ChatRequestIntent::QuestionReply {
                assistant_message_id: assistant.id.clone(),
                text: "First".into(),
            },
        );
        assert!(matches!(choice, Err(QaScribeError::NotFound(_))));
        assert_eq!(rows(&f.service), before);
        let typed = compose(&f.service, &completed, "First");
        let before = rows(&f.service);
        assert!(matches!(
            f.service.start_chat_turn_with_context(
                ChatStartRequest {
                    scope: scope(&typed)
                },
                f.record.target()
            ),
            Err(QaScribeError::NotFound(_))
        ));
        assert_eq!(rows(&f.service), before);
    }
}
