use crate::jobs::{GenerationJobState, JobControl, JobStore};
use std::{
    sync::{Arc, mpsc},
    thread,
    time::Duration,
};

fn insert(store: &JobStore, id: &str, session: &str, action: &str) -> JobControl {
    store
        .insert_generation_job(id.into(), session.into(), action.into())
        .unwrap()
        .1
}

#[test]
fn session_delete_closes_admission_rejects_double_delete_and_reopens_on_drop() {
    let store = JobStore::default();
    let guard = store.begin_session_deletion("owned").unwrap();
    assert!(store.begin_session_deletion("owned").is_err());
    for action in ["chat", "testware", "finding"] {
        assert!(
            store
                .insert_generation_job(action.into(), "owned".into(), action.into())
                .is_err()
        );
    }
    insert(&store, "foreign", "foreign", "chat");
    drop(guard);
    insert(&store, "admitted-again", "owned", "chat");
    drop(store.begin_session_deletion("owned").unwrap());
}

#[test]
fn session_delete_cancels_all_owned_actions_and_active_states_not_foreign_jobs() {
    for action in ["chat", "testware", "finding"] {
        for state in [
            GenerationJobState::Starting,
            GenerationJobState::Running,
            GenerationJobState::Cancelling,
        ] {
            let store = JobStore::default();
            let owned = insert(&store, "owned", "session", action);
            let foreign = insert(&store, "foreign", "other", "chat");
            if state == GenerationJobState::Running {
                store
                    .mark_running("owned", "run".into(), "Running")
                    .unwrap();
            } else if state == GenerationJobState::Cancelling {
                store.cancel("owned").unwrap();
            }
            let guard = store.begin_session_deletion("session").unwrap();
            guard.cancel_jobs().unwrap();
            assert!(owned.is_cancelled());
            assert_eq!(
                store.status("owned").unwrap().state,
                GenerationJobState::Cancelling
            );
            assert!(!foreign.is_cancelled());
            assert_eq!(
                store.status("foreign").unwrap().state,
                GenerationJobState::Starting
            );
        }
    }
}

#[test]
fn session_delete_does_not_cancel_a_job_that_completed_before_snapshot() {
    let store = JobStore::default();
    let control = insert(&store, "done", "session", "chat");
    store.mark_running("done", "run".into(), "Running").unwrap();
    store.complete("done").unwrap();
    let guard = store.begin_session_deletion("session").unwrap();
    guard.cancel_jobs().unwrap();
    assert!(!control.is_cancelled());
    assert_eq!(
        store.status("done").unwrap().state,
        GenerationJobState::Completed
    );
}

#[test]
fn session_delete_serializes_with_finalization_without_holding_job_store_mutex() {
    let store = Arc::new(JobStore::default());
    let control = insert(&store, "job", "session", "chat");
    store.mark_running("job", "run".into(), "Running").unwrap();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let worker_store = Arc::clone(&store);
    let worker = thread::spawn(move || {
        control
            .run_if_not_cancelled(|| {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                worker_store.complete("job").unwrap();
            })
            .unwrap();
    });
    entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let delete_store = Arc::clone(&store);
    let (reserved_tx, reserved_rx) = mpsc::channel();
    let (done_tx, done_rx) = mpsc::channel();
    let deletion = thread::spawn(move || {
        let guard = delete_store.begin_session_deletion("session").unwrap();
        reserved_tx.send(()).unwrap();
        guard.cancel_jobs().unwrap();
        done_tx.send(()).unwrap();
    });
    // Always release the holder, including when the red stub panics.
    let reserved = reserved_rx.recv_timeout(Duration::from_secs(2));
    let waited = done_rx.recv_timeout(Duration::from_millis(50)).is_err();
    release_tx.send(()).unwrap();
    worker.join().unwrap();
    deletion.join().unwrap();
    reserved.unwrap();
    assert!(waited, "cancellation must serialize with the finalizer");
    assert_eq!(
        store.status("job").unwrap().state,
        GenerationJobState::Completed
    );
}

#[cfg(unix)]
#[test]
fn session_delete_kills_actual_provider_and_stops_descendant_heartbeat() {
    use std::{fs, process::Command, time::Instant};
    let store = JobStore::default();
    let control = insert(&store, "job", "session", "chat");
    let guard = store.begin_session_deletion("session").unwrap();
    let path = std::env::temp_dir().join(format!(
        "qa-scribe-delete-heartbeat-{}",
        uuid::Uuid::new_v4()
    ));
    let mut command = Command::new("sh");
    command.args([
        "-c",
        "(while :; do printf x >> \"$1\"; sleep 0.02; done) & wait",
        "sh",
    ]);
    command.arg(&path);
    crate::process_io::configure_process_group(&mut command);
    control.set_child(command.spawn().unwrap()).unwrap();
    let _cleanup = crate::jobs::TestChildCleanup(control.clone());
    let deadline = Instant::now() + Duration::from_secs(3);
    while fs::metadata(&path).map(|m| m.len()).unwrap_or(0) < 2 && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
    assert!(
        fs::metadata(&path).unwrap().len() >= 2,
        "descendant must actually run"
    );
    guard.cancel_jobs().unwrap();
    assert!(control.is_cancelled());
    let deadline = Instant::now() + Duration::from_secs(3);
    let exit = loop {
        if let Some(exit) = control.child_exit_status().unwrap() {
            break exit;
        }
        assert!(Instant::now() < deadline, "provider PID must actually exit");
        thread::sleep(Duration::from_millis(10));
    };
    assert!(!exit.success());
    thread::sleep(Duration::from_millis(100));
    let stopped_size = fs::metadata(&path).unwrap().len();
    thread::sleep(Duration::from_millis(150));
    assert_eq!(
        fs::metadata(&path).unwrap().len(),
        stopped_size,
        "descendant must stop writing"
    );
    fs::remove_file(path).unwrap();
}

#[test]
fn session_delete_admission_reopens_after_unwind() {
    let store = JobStore::default();
    let mut admitted = false;
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = store.begin_session_deletion("session").unwrap();
        admitted = true;
        panic!("injected deletion unwind");
    }));
    assert!(result.is_err());
    assert!(admitted);
    insert(&store, "after-unwind", "session", "chat");
    drop(store.begin_session_deletion("session").unwrap());
}
