use std::{
    sync::{Arc, Barrier, mpsc},
    thread,
    time::{Duration, Instant},
};

use super::{GenerationJobState, JobStore, JobStoreError, MAX_ACTIVE_GENERATION_JOBS};

fn mark_running(store: &JobStore, job_id: &str) {
    store
        .mark_running(job_id, format!("run-{job_id}"), "Provider started")
        .expect("job starts");
}

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
    mark_running(&store, "job-done");
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
        mark_running(&store, &job_id);
        store.complete(&job_id).expect("job completes");
    }

    assert_eq!(store.len(), 0);
    assert!(store.status("job-0").is_err());
    let recent = store.status("job-39").expect("recent terminal job remains");
    assert_eq!(recent.state, GenerationJobState::Completed);
}

#[test]
fn active_generation_jobs_are_bounded() {
    let store = JobStore::default();
    for index in 0..MAX_ACTIVE_GENERATION_JOBS {
        store
            .insert_generation_job(
                format!("job-{index}"),
                "session-1".to_string(),
                "summary".to_string(),
            )
            .expect("job under active limit inserts");
    }

    let error = store
        .insert_generation_job(
            "job-over-limit".to_string(),
            "session-1".to_string(),
            "summary".to_string(),
        )
        .err()
        .expect("job over active limit should be rejected");

    assert_eq!(error, JobStoreError::Capacity { limit: 3 });

    mark_running(&store, "job-0");
    store.complete("job-0").expect("one active job completes");
    store
        .insert_generation_job(
            "job-after-complete".to_string(),
            "session-1".to_string(),
            "summary".to_string(),
        )
        .expect("new job inserts after active slot opens");
}

#[test]
fn cancelling_job_cannot_return_to_running_or_complete() {
    let store = JobStore::default();
    store
        .insert_generation_job(
            "job-race".to_string(),
            "session-1".to_string(),
            "summary".to_string(),
        )
        .expect("job inserts");
    store.cancel("job-race").expect("cancellation is accepted");

    for error in [
        store
            .mark_running("job-race", "run-race".to_string(), "Provider started")
            .unwrap_err(),
        store.complete("job-race").unwrap_err(),
        store.fail("job-race", "late failure").unwrap_err(),
    ] {
        assert!(matches!(
            error,
            JobStoreError::InvalidTransition {
                from: GenerationJobState::Cancelling,
                ..
            }
        ));
    }
    assert_eq!(
        store.status("job-race").unwrap().state,
        GenerationJobState::Cancelling
    );
    store
        .update_progress("job-race", "late progress")
        .expect("late progress is ignored");
    store
        .update_partial("job-race", "late partial")
        .expect("late partial is ignored");
    let cancelling = store.status("job-race").unwrap();
    assert_eq!(cancelling.progress_message, "Cancelling generation");
    assert_eq!(cancelling.partial_text, None);
}

#[test]
fn accepted_cancellation_prevents_final_persistence_operation() {
    let store = JobStore::default();
    let (_, control) = store
        .insert_generation_job(
            "job-before-persist".to_string(),
            "session-1".to_string(),
            "summary".to_string(),
        )
        .expect("job inserts");
    mark_running(&store, "job-before-persist");
    store
        .cancel("job-before-persist")
        .expect("cancellation is accepted");
    let mut persisted = false;

    let result = control
        .run_if_not_cancelled(|| persisted = true)
        .expect("finalization gate is available");

    assert_eq!(result, None);
    assert!(!persisted, "accepted cancellation must skip persistence");
}

#[test]
fn cancellation_waiting_behind_persistence_is_not_accepted() {
    let store = Arc::new(JobStore::default());
    let (_, control) = store
        .insert_generation_job(
            "job-finalizing".to_string(),
            "session-1".to_string(),
            "summary".to_string(),
        )
        .expect("job inserts");
    mark_running(&store, "job-finalizing");
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let worker_store = Arc::clone(&store);
    let worker_entered = Arc::clone(&entered);
    let worker_release = Arc::clone(&release);
    let worker = thread::spawn(move || {
        control
            .run_if_not_cancelled(|| {
                worker_entered.wait();
                worker_release.wait();
                worker_store
                    .complete("job-finalizing")
                    .expect("finalizer completes job")
            })
            .expect("finalization lock is available")
            .expect("cancellation did not precede finalization")
    });
    entered.wait();
    let cancel_store = Arc::clone(&store);
    let (cancel_tx, cancel_rx) = mpsc::channel();
    let canceller = thread::spawn(move || {
        let _ = cancel_tx.send(cancel_store.cancel("job-finalizing"));
    });
    assert!(
        cancel_rx.recv_timeout(Duration::from_millis(50)).is_err(),
        "cancellation must wait while persistence owns the decision gate"
    );
    release.wait();

    assert_eq!(worker.join().unwrap().state, GenerationJobState::Completed);
    assert_eq!(
        cancel_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("cancellation returns after finalization")
            .expect("terminal status is returned")
            .state,
        GenerationJobState::Completed
    );
    canceller.join().unwrap();
}

#[test]
fn shutdown_accepts_cancellation_for_starting_and_running_jobs() {
    let store = JobStore::default();
    let (_, starting_control) = store
        .insert_generation_job(
            "job-starting".to_string(),
            "session-1".to_string(),
            "summary".to_string(),
        )
        .expect("starting job inserts");
    let (_, running_control) = store
        .insert_generation_job(
            "job-running".to_string(),
            "session-1".to_string(),
            "summary".to_string(),
        )
        .expect("running job inserts");
    mark_running(&store, "job-running");

    store.kill_all_children();

    for (job_id, control) in [
        ("job-starting", starting_control),
        ("job-running", running_control),
    ] {
        assert!(control.is_cancelled());
        assert_eq!(
            store.status(job_id).unwrap().state,
            GenerationJobState::Cancelling
        );
    }
}

#[cfg(unix)]
#[test]
fn shutdown_broadcasts_cancellation_and_kills_children_before_finalization_waits() {
    let store = Arc::new(JobStore::default());
    let mut controls = Vec::new();
    for job_id in ["job-a", "job-b", "job-c"] {
        let (_, control) = store
            .insert_generation_job(
                job_id.to_string(),
                "session-1".to_string(),
                "summary".to_string(),
            )
            .expect("job inserts");
        mark_running(&store, job_id);
        controls.push(control);
    }

    let mut command = std::process::Command::new("sh");
    command.args(["-c", "sleep 30"]);
    crate::process_io::configure_process_group(&mut command);
    controls[2]
        .set_child(command.spawn().expect("test child starts"))
        .expect("test child registers");

    let release = Arc::new(Barrier::new(controls.len() + 1));
    let (entered_tx, entered_rx) = mpsc::channel();
    let holders = controls
        .iter()
        .cloned()
        .map(|control| {
            let release = Arc::clone(&release);
            let entered_tx = entered_tx.clone();
            thread::spawn(move || {
                control
                    .run_if_not_cancelled(|| {
                        entered_tx.send(()).expect("holder reports entry");
                        release.wait();
                    })
                    .expect("finalization gate remains available")
            })
        })
        .collect::<Vec<_>>();
    drop(entered_tx);
    for _ in &controls {
        entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("every finalization gate is held");
    }

    let shutdown_store = Arc::clone(&store);
    let (shutdown_tx, shutdown_rx) = mpsc::channel();
    let shutdown = thread::spawn(move || {
        shutdown_store.kill_all_children();
        let _ = shutdown_tx.send(());
    });

    let deadline = Instant::now() + Duration::from_secs(1);
    while !controls.iter().all(|control| control.is_cancelled()) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(5));
    }
    let all_cancelled = controls.iter().all(|control| control.is_cancelled());
    let shutdown_waited = shutdown_rx.recv_timeout(Duration::from_millis(50)).is_err();

    let mut child = controls[2]
        .take_child()
        .expect("child lock remains available")
        .expect("test child remains registered");
    let deadline = Instant::now() + Duration::from_secs(1);
    let child_killed = loop {
        if child
            .try_wait()
            .expect("child status is readable")
            .is_some()
        {
            break true;
        }
        if Instant::now() >= deadline {
            break false;
        }
        thread::sleep(Duration::from_millis(5));
    };
    if !child_killed {
        crate::process_io::kill_child_group(&mut child);
        let _ = child.wait();
    }

    release.wait();
    for holder in holders {
        holder.join().expect("finalization holder exits");
    }
    if shutdown_waited {
        shutdown_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("shutdown finishes after finalization gates release");
    }
    shutdown.join().expect("shutdown exits");

    assert!(all_cancelled, "shutdown must broadcast before waiting");
    assert!(
        child_killed,
        "shutdown must kill registered provider children"
    );
    assert!(
        shutdown_waited,
        "status reconciliation should still serialize"
    );
    for job_id in ["job-a", "job-b", "job-c"] {
        assert_eq!(
            store.status(job_id).unwrap().state,
            GenerationJobState::Cancelling
        );
    }
}
