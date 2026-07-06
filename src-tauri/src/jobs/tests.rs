use super::{GenerationJobState, JobStore};

#[test]
fn job_store_tracks_active_lifecycle() {
    let store = JobStore::default();
    let (status, _) = store
        .insert_generation_job(
            "job-1".to_string(),
            "session-1".to_string(),
            "testware".to_string(),
        )
        .expect("job inserts");

    assert_eq!(status.state, GenerationJobState::Starting);
    assert_eq!(store.len(), 1);

    let status = store
        .mark_running("job-1", "run-1".to_string(), "Provider started")
        .expect("job starts");
    assert_eq!(status.state, GenerationJobState::Running);
    assert_eq!(status.ai_run_id.as_deref(), Some("run-1"));

    let status = store
        .update_partial("job-1", "partial")
        .expect("partial updates");
    assert_eq!(status.partial_text.as_deref(), Some("partial"));

    let status = store.complete("job-1").expect("job completes");
    assert_eq!(status.state, GenerationJobState::Completed);
    assert_eq!(store.len(), 0);
}

#[test]
fn active_jobs_lists_only_non_terminal_snapshots() {
    let store = JobStore::default();
    store
        .insert_generation_job(
            "job-active".to_string(),
            "session-1".to_string(),
            "testware".to_string(),
        )
        .expect("job inserts");
    store
        .insert_generation_job(
            "job-done".to_string(),
            "session-1".to_string(),
            "finding".to_string(),
        )
        .expect("job inserts");
    store.complete("job-done").expect("job completes");

    let active = store.active_jobs().expect("active jobs list");
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].job_id, "job-active");
    assert_eq!(active[0].state, GenerationJobState::Starting);
}

#[test]
fn cancellation_marks_job_cancelling_then_cancelled() {
    let store = JobStore::default();
    store
        .insert_generation_job(
            "job-1".to_string(),
            "session-1".to_string(),
            "summary".to_string(),
        )
        .expect("job inserts");

    let status = store.cancel("job-1").expect("job cancels");
    assert_eq!(status.state, GenerationJobState::Cancelling);
    assert_eq!(store.len(), 1);

    let status = store.mark_cancelled("job-1").expect("job marks cancelled");
    assert_eq!(status.state, GenerationJobState::Cancelled);
    assert_eq!(store.len(), 0);
}

#[test]
fn terminal_jobs_are_bounded_but_recent_status_is_available() {
    let store = JobStore::default();
    for index in 0..40 {
        let job_id = format!("job-{index}");
        store
            .insert_generation_job(
                job_id.clone(),
                "session-1".to_string(),
                "summary".to_string(),
            )
            .expect("job inserts");
        store.complete(&job_id).expect("job completes");
    }

    assert_eq!(store.len(), 0);
    assert!(store.status("job-0").is_err());
    let recent = store.status("job-39").expect("recent terminal job remains");
    assert_eq!(recent.state, GenerationJobState::Completed);
}
