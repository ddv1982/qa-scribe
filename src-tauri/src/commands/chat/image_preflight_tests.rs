use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use qa_scribe_core::{attachments::chat::import_chat_image_data_url, services::SessionService};

#[test]
fn copilot_image_rejection_preserves_durable_composer_and_creates_no_turn() {
    let service = SessionService::in_memory().unwrap();
    let session = service
        .create_session(SessionDraft {
            title: "Image admission".into(),
            ..Default::default()
        })
        .unwrap();
    let chat = service.load_chat(&session.id).unwrap();
    let dir = std::env::temp_dir().join(format!("qa-image-preflight-{}", uuid::Uuid::new_v4()));
    let bytes = include_bytes!("../../../../e2e/fixtures/chat-image-pixels.png");
    let before = import_chat_image_data_url(
        &service,
        &dir,
        lifecycle::scope(&chat),
        "pixels.png".into(),
        &format!("data:image/png;base64,{}", STANDARD.encode(bytes)),
    )
    .unwrap();
    let request = StartChatJobRequest {
        refine: false,
        context: ChatTarget::Session,
        scope: lifecycle::scope(&before),
        retry: false,
        provider: AiProvider::CopilotCli,
        model: "image-model".into(),
        reasoning_effort: None,
    };
    let state = AppState::new(service, dir.clone());
    let jobs = JobStore::default();
    let error = match prepare_chat_job(&state, &jobs, &request, "rejected-image-job") {
        Err(error) => error,
        Ok(_) => panic!("image admission must reject before preparation"),
    };
    assert_eq!(
        error.message,
        "Copilot Chat does not support image attachments yet. Choose another provider or start a text-only conversation. Your message and images are kept."
    );
    let after = state
        .with_service(|service| service.load_chat(&session.id))
        .unwrap();
    assert_eq!(after, before);
    let runs: i64 = state
        .with_service(|service| {
            Ok(service.database().connection().query_row(
                "SELECT count(*) FROM ai_runs",
                [],
                |row| row.get(0),
            )?)
        })
        .unwrap();
    assert_eq!(runs, 0);
    assert_eq!(
        jobs.status("rejected-image-job").unwrap().state,
        GenerationJobState::Failed
    );
    std::fs::remove_dir_all(dir).unwrap();
}
