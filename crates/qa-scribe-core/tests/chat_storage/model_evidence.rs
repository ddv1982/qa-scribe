use super::*;
use qa_scribe_core::domain::ReportedModel;

#[test]
fn finish_retains_previously_recorded_report_and_both_completed_states() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let saved = save(&service, &service.load_chat(&id).unwrap(), "Q");
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&saved),
        })
        .unwrap();
    let run_id = run(&service, &id, &started.turn_id);
    let associated = associate(&service, &started, &run_id);
    assert_eq!(
        associated.messages[0].ai_run_id.as_deref(),
        Some(run_id.as_str())
    );
    service
        .record_running_ai_run_model_report(
            &run_id,
            Some(&ReportedModel::CodexThreadConfiguration {
                id: "reported-model".into(),
            }),
        )
        .unwrap();
    let done = service
        .finish_chat_turn_with_ai_run(
            ChatFinishRequest {
                scope: scope(&associated),
                turn_id: started.turn_id.clone(),
                assistant_text: "A".into(),
            },
            &run_id,
        )
        .unwrap();
    assert!(
        done.messages
            .iter()
            .all(|m| m.ai_run_id.as_deref() == Some(run_id.as_str()))
    );
    assert!(
        done.messages
            .iter()
            .all(|m| m.status == ChatTurnStatus::Completed)
    );
    assert_eq!(
        serde_json::to_value(&done).unwrap()["aiRuns"][0]["id"],
        run_id
    );
    let run = service.get_ai_run(&run_id).unwrap().unwrap();
    assert_eq!(run.status.as_str(), "completed");
    assert_eq!(
        run.model_selection,
        RunModelSelection::Recorded {
            requested: RequestedModel::Explicit {
                id: "requested-model".into()
            },
            reported: Some(ReportedModel::CodexThreadConfiguration {
                id: "reported-model".into()
            })
        }
    );
    assert_eq!(run.reasoning_effort.as_deref(), Some("high"));
    assert!(run.completed_at.is_some());
    validation(service.finish_chat_turn_with_ai_run(
        ChatFinishRequest {
            scope: scope(&done),
            turn_id: started.turn_id,
            assistant_text: "Duplicate A".into(),
        },
        &run_id,
    ));
    assert_eq!(service.load_chat(&id).unwrap(), done);
}

#[test]
fn chat_projects_each_linked_run_once_and_ignores_unrelated_corrupt_evidence() {
    let service = SessionService::in_memory().unwrap();
    let id = session(&service);
    let saved = save(&service, &service.load_chat(&id).unwrap(), "Question");
    let started = service
        .start_chat_turn(ChatStartRequest {
            scope: scope(&saved),
        })
        .unwrap();
    let linked = run(&service, &id, &started.turn_id);
    let associated = associate(&service, &started, &linked);
    let done = service
        .finish_chat_turn_with_ai_run(
            ChatFinishRequest {
                scope: scope(&associated),
                turn_id: started.turn_id,
                assistant_text: "Answer".into(),
            },
            &linked,
        )
        .unwrap();
    assert_eq!(done.messages.len(), 2);
    assert_eq!(done.ai_runs.len(), 1);
    assert_eq!(done.ai_runs[0].id, linked);
    assert_eq!(done.ai_runs[0].status.as_str(), "completed");
    let unrelated = run(&service, &id, "unrelated-generation");
    let connection = service.database().connection();
    connection
        .execute(
            "UPDATE ai_runs SET model_selection_json='invalid' WHERE id=?1",
            [&unrelated],
        )
        .unwrap();
    assert_eq!(service.load_chat(&id).unwrap(), done);
    let original: String = connection
        .query_row(
            "SELECT model_selection_json FROM ai_runs WHERE id=?1",
            [&linked],
            |r| r.get(0),
        )
        .unwrap();
    connection
        .execute(
            "UPDATE ai_runs SET model_selection_json='invalid' WHERE id=?1",
            [&linked],
        )
        .unwrap();
    assert!(
        service
            .load_chat(&id)
            .unwrap_err()
            .to_string()
            .contains("ai_run.model_selection_json")
    );
    connection
        .execute(
            "UPDATE ai_runs SET model_selection_json=?1 WHERE id=?2",
            rusqlite::params![original, linked],
        )
        .unwrap();
    let restarted = service
        .restart_chat(ChatRestartRequest {
            scope: scope(&done),
        })
        .unwrap();
    connection
        .execute(
            "UPDATE ai_runs SET model_selection_json='invalid' WHERE id=?1",
            [&linked],
        )
        .unwrap();
    assert_eq!(service.load_chat(&id).unwrap(), restarted);
    assert!(restarted.ai_runs.is_empty());
}
