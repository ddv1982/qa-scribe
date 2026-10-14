use super::*;
use crate::jobs::{GenerationJobState, JobStore};
use qa_scribe_core::{attachments::import_managed_attachment, services::SessionService};
use std::{
    fs,
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

fn setup() -> (AppState, String, std::path::PathBuf) {
    let root =
        std::env::temp_dir().join(format!("qa-scribe-delete-command-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let service = SessionService::in_memory().unwrap();
    let session = service
        .create_session(SessionDraft {
            title: "Deletion boundary".into(),
            ..Default::default()
        })
        .unwrap();
    (AppState::new(service, root.clone()), session.id, root)
}

#[test]
fn session_delete_public_boundary_cancels_owned_jobs_and_deletes_rows_not_foreign_jobs() {
    let (state, id, root) = setup();
    let jobs = JobStore::default();
    let (_, owned) = jobs
        .insert_generation_job("chat".into(), id.clone(), "chat".into())
        .unwrap();
    let (_, generation) = jobs
        .insert_generation_job("generation".into(), id.clone(), "testware".into())
        .unwrap();
    let (_, foreign) = jobs
        .insert_generation_job("foreign".into(), "other".into(), "finding".into())
        .unwrap();
    delete_session_with_jobs(&state, &jobs, &id).unwrap();
    assert!(owned.is_cancelled());
    assert!(generation.is_cancelled());
    assert!(!foreign.is_cancelled());
    assert!(
        state
            .with_service(|s| s.get_session(&id))
            .unwrap()
            .is_none()
    );
    assert_eq!(
        jobs.status("chat").unwrap().state,
        GenerationJobState::Cancelling
    );
    // Admission is temporary even after successful durable deletion.
    drop(jobs.begin_session_deletion(&id).unwrap());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn session_delete_failed_database_cascade_retains_evidence_and_releases_admission() {
    let (state, id, root) = setup();
    let source = root.join("evidence.txt");
    fs::write(&source, "retained evidence").unwrap();
    state.with_service(|service| {
        import_managed_attachment(service, &root, &id, None, &source)?;
        service.database().connection().execute_batch(
            "CREATE TRIGGER reject_session_delete BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'injected delete failure'); END;"
        )?;
        Ok(())
    }).unwrap();
    let evidence_dir = root.join("attachments").join(&id);
    let evidence = fs::read_dir(&evidence_dir)
        .unwrap()
        .map(|p| p.unwrap().path())
        .collect::<Vec<_>>();
    assert!(!evidence.is_empty());
    let jobs = JobStore::default();
    let (_, control) = jobs
        .insert_generation_job("chat".into(), id.clone(), "chat".into())
        .unwrap();
    assert!(delete_session_with_jobs(&state, &jobs, &id).is_err());
    assert!(control.is_cancelled());
    assert!(
        state
            .with_service(|s| s.get_session(&id))
            .unwrap()
            .is_some()
    );
    for file in evidence {
        assert_eq!(fs::read_to_string(file).unwrap(), "retained evidence");
    }
    jobs.insert_generation_job("after-failure".into(), id.clone(), "chat".into())
        .unwrap();
    drop(jobs.begin_session_deletion(&id).unwrap());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn session_delete_cancels_before_service_lock_and_keeps_admission_while_waiting_for_cascade() {
    let (state, id, root) = setup();
    let state = Arc::new(state);
    let jobs = Arc::new(JobStore::default());
    let (_, control) = jobs
        .insert_generation_job("chat".into(), id.clone(), "chat".into())
        .unwrap();
    let worker = state
        .with_service(|_| {
            let delete_state = Arc::clone(&state);
            let delete_jobs = Arc::clone(&jobs);
            let delete_id = id.clone();
            let worker = thread::spawn(move || {
                delete_session_with_jobs(&delete_state, &delete_jobs, &delete_id)
            });
            let deadline = Instant::now() + Duration::from_secs(2);
            while !control.is_cancelled() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(5));
            }
            let cancelled = control.is_cancelled();
            let blocked = jobs
                .insert_generation_job("escaping-chat".into(), id.clone(), "chat".into())
                .is_err();
            let double_delete_blocked = jobs.begin_session_deletion(&id).is_err();
            Ok((worker, cancelled, blocked, double_delete_blocked))
        })
        .unwrap();
    let (worker, cancelled, blocked, double_delete_blocked) = worker;
    worker.join().unwrap().unwrap();
    assert!(cancelled, "must cancel without owning the service mutex");
    assert!(
        blocked,
        "admission must remain closed through the durable cascade"
    );
    assert!(double_delete_blocked);
    jobs.insert_generation_job("after-delete".into(), id, "chat".into())
        .unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn session_delete_public_boundary_terminates_real_provider_process() {
    let (state, id, root) = setup();
    let jobs = JobStore::default();
    let (_, control) = jobs
        .insert_generation_job("process".into(), id.clone(), "chat".into())
        .unwrap();
    let mut command = std::process::Command::new("sh");
    command.args(["-c", "sleep 30"]);
    crate::process_io::configure_process_group(&mut command);
    control.set_child(command.spawn().unwrap()).unwrap();
    let _cleanup = crate::jobs::TestChildCleanup(control.clone());
    assert!(control.child_exit_status().unwrap().is_none());
    delete_session_with_jobs(&state, &jobs, &id).unwrap();
    assert!(control.is_cancelled());
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(exit) = control.child_exit_status().unwrap() {
            assert!(!exit.success());
            break;
        }
        assert!(
            Instant::now() < deadline,
            "deletion must actually terminate the provider PID"
        );
        thread::sleep(Duration::from_millis(10));
    }
    assert!(
        state
            .with_service(|s| s.get_session(&id))
            .unwrap()
            .is_none()
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn session_delete_cancellation_error_preserves_session_and_reopens_admission() {
    let (state, id, root) = setup();
    let jobs = JobStore::default();
    let (_, control) = jobs
        .insert_generation_job("poisoned-gate".into(), id.clone(), "chat".into())
        .unwrap();
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = control.run_if_not_cancelled(|| panic!("injected finalization poison"));
    }));
    assert!(delete_session_with_jobs(&state, &jobs, &id).is_err());
    assert!(
        state
            .with_service(|s| s.get_session(&id))
            .unwrap()
            .is_some()
    );
    jobs.insert_generation_job("after-cancel-error".into(), id.clone(), "chat".into())
        .unwrap();
    drop(jobs.begin_session_deletion(&id).unwrap());
    fs::remove_dir_all(root).unwrap();
}
