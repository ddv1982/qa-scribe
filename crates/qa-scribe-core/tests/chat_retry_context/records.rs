use super::support::*;
use qa_scribe_core::{QaScribeError, domain::*};
use serde_json::json;

#[test]
fn deleted_sources_still_reject_refinement_stage_and_guarded_save() {
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
        let kind = match kind {
            Kind::Finding => "finding",
            Kind::TestCases => "test_cases_draft",
        };
        let completed = f.service.finish_chat_turn(ChatFinishRequest {
            scope: scope(&retried.chat), turn_id: retried.turn_id,
            assistant_text: json!({"version":contract.version(),"requestId":contract.request_id(),"markdown":"Suggested change","refinement":{"kind":kind,"title":"Suggested title"}}).to_string(),
        }).unwrap();
        assert_eq!(completed.proposals.len(), 1);
        assert!(matches!(
            completed.proposals[0].state,
            RefinementState::Offered
        ));
        f.record.delete(&f.service);
        let before = rows(&f.service);
        let error = f
            .service
            .resolve_refinement(RefinementRequest {
                scope: scope(&completed),
                proposal_id: completed.proposals[0].id.clone(),
                action: RefinementAction::Stage,
            })
            .unwrap_err();
        assert!(matches!(error, QaScribeError::NotFound(_)));
        assert_eq!(
            f.service.load_chat(&completed.session_id).unwrap(),
            completed
        );
        assert_eq!(rows(&f.service), before);
        assert!(matches!(
            f.record.save(&f.service),
            Err(QaScribeError::NotFound(_))
        ));
        assert_eq!(rows(&f.service), before);
        f.record.assert_absent(&f.service);
    }
}
