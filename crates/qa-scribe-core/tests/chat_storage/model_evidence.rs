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
