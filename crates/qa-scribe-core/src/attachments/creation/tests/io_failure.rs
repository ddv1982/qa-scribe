use std::{
    cell::RefCell,
    fs::File,
    io::{self, Write},
    rc::Rc,
};

use super::*;
use crate::error::QaScribeError;

type WriteTemp = Box<dyn FnOnce(File, &[u8]) -> io::Result<()>>;
type RemoveTemp = Box<dyn FnOnce(&Path) -> io::Result<()>>;

thread_local! {
    static WRITE: RefCell<Option<WriteTemp>> = const { RefCell::new(None) };
    static REMOVE: RefCell<Option<RemoveTemp>> = const { RefCell::new(None) };
}

pub(in crate::attachments::creation) fn take_write() -> Option<WriteTemp> {
    WRITE.with_borrow_mut(Option::take)
}

pub(in crate::attachments::creation) fn take_remove() -> Option<RemoveTemp> {
    REMOVE.with_borrow_mut(Option::take)
}

struct Reset;
impl Drop for Reset {
    fn drop(&mut self) {
        WRITE.with_borrow_mut(|hook| *hook = None);
        REMOVE.with_borrow_mut(|hook| *hook = None);
    }
}

#[derive(Clone, Copy, Debug)]
enum Failure {
    PartialWrite,
    Sync,
}

impl Failure {
    fn code(self) -> i32 {
        match self {
            Self::PartialWrite => 28,
            Self::Sync => 5,
        }
    }
}

struct PartialWriter<'a> {
    file: &'a File,
    remaining: usize,
}
impl Write for PartialWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.remaining == 0 {
            return Err(io::Error::from_raw_os_error(28));
        }
        let written = self.file.write(&bytes[..bytes.len().min(self.remaining)])?;
        self.remaining -= written;
        Ok(written)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

fn fail_next_write(failure: Failure, cleanup_fails: bool) -> Reset {
    WRITE.with_borrow_mut(|hook| {
        assert!(hook.is_none());
        *hook = Some(Box::new(move |file, bytes| {
            let file = Rc::new(file);
            let closed = Rc::downgrade(&file);
            REMOVE.with_borrow_mut(|hook| {
                assert!(hook.is_none());
                *hook = Some(Box::new(move |path| {
                    assert!(
                        closed.upgrade().is_none(),
                        "close the owned file before unlink"
                    );
                    if cleanup_fails {
                        return Err(io::Error::new(
                            io::ErrorKind::PermissionDenied,
                            "injected unlink failure",
                        ));
                    }
                    fs::remove_file(path)
                }));
            });
            match failure {
                Failure::PartialWrite => {
                    let error = PartialWriter {
                        file: &file,
                        remaining: 2,
                    }
                    .write_all(bytes)
                    .unwrap_err();
                    assert_eq!(file.metadata()?.len(), 2);
                    Err(error)
                }
                Failure::Sync => {
                    (&*file).write_all(bytes)?;
                    assert_eq!(file.metadata()?.len(), bytes.len() as u64);
                    Err(io::Error::from_raw_os_error(failure.code()))
                }
            }
        }));
    });
    Reset
}

fn temporary(fixture: &Fixture, prepared: &PreparedCreation) -> PathBuf {
    use rusqlite::OptionalExtension;
    let owned: Option<String> = fixture
        .service
        .database()
        .connection()
        .query_row(
            "SELECT relative_path FROM creation_staging WHERE attachment_id = ?1",
            [&prepared.images[0].attachment_id],
            |row| row.get(0),
        )
        .optional()
        .unwrap();
    if let Some(owned) = owned {
        return fixture.root.join(owned).join("image.tmp");
    }
    fixture
        .root
        .join("attachments")
        .join(&fixture.session)
        .join(format!(".{}.tmp", prepared.images[0].attachment_id))
}

fn io_error(error: QaScribeError) -> io::Error {
    match error {
        QaScribeError::Io(error) => error,
        other => panic!("expected original I/O failure, got {other:?}"),
    }
}

fn zero_records(fixture: &Fixture) {
    assert_eq!(count(&fixture.service, "findings"), 0);
    assert_eq!(count(&fixture.service, "drafts"), 0);
    assert_eq!(count(&fixture.service, "attachments"), 0);
}

#[test]
fn partial_write_failure_cleans_new_temp_and_retry_commits_exactly_once() {
    retry_after_failure(Failure::PartialWrite);
}

#[test]
fn sync_failure_cleans_new_temp_and_retry_commits_exactly_once() {
    retry_after_failure(Failure::Sync);
}

fn retry_after_failure(failure: Failure) {
    for kind in [CreationKind::Finding, CreationKind::Testware] {
        let fixture = Fixture::new();
        let (_, prepared) = fixture.prepare(kind, 1);
        let input = request(&prepared, kind);
        let _reset = fail_next_write(failure, false);
        let error = io_error(
            commit_creation_save(&fixture.service, &fixture.root, input.clone()).unwrap_err(),
        );
        assert_eq!(error.raw_os_error(), Some(failure.code()));
        zero_records(&fixture);
        let temp = temporary(&fixture, &prepared);
        eprintln!(
            "{kind:?} {failure:?}: original={error}; leftover={:?}; zero records and attachment rows",
            fs::read(&temp)
        );
        assert!(
            !temp.exists(),
            "newly owned temp must be removed after {failure:?}"
        );
        assert!(!path(&fixture.service, &fixture.root, 0).exists());
        assert!(
            REMOVE.with_borrow(|hook| hook.is_none()),
            "cleanup ran after file close"
        );
        let result = commit_creation_save(&fixture.service, &fixture.root, input.clone()).unwrap();
        assert!(matches!(result, CreationOutcome::Committed { .. }));
        assert_eq!(
            commit_creation_save(&fixture.service, &fixture.root, input).unwrap(),
            result
        );
        assert_eq!(
            abort_creation_save(&fixture.service, &fixture.root, "attempt").unwrap(),
            result
        );
        assert_eq!(
            count(&fixture.service, "findings") + count(&fixture.service, "drafts"),
            1
        );
        assert_eq!(count(&fixture.service, "attachments"), 1);
        assert_eq!(
            fs::read(path(&fixture.service, &fixture.root, 0)).unwrap(),
            b"image"
        );
    }
}

#[test]
fn returned_io_failures_allow_abort_and_startup_reconciliation_without_touching_other_files() {
    for kind in [CreationKind::Finding, CreationKind::Testware] {
        for failure in [Failure::PartialWrite, Failure::Sync] {
            for startup in [false, true] {
                let fixture = Fixture::new();
                let (_, prepared) = fixture.prepare(kind, 1);
                let parent = temporary(&fixture, &prepared)
                    .parent()
                    .unwrap()
                    .to_path_buf();
                fs::create_dir_all(&parent).unwrap();
                let unrelated = parent.join("unrelated.png");
                fs::write(&unrelated, b"retain").unwrap();
                let shared = import_managed_attachment_bytes(
                    &fixture.service,
                    &fixture.root,
                    &fixture.session,
                    None,
                    "borrowed.png".into(),
                    Some("image/png".into()),
                    b"borrowed".to_vec(),
                )
                .unwrap();
                let _reset = fail_next_write(failure, false);
                let error = io_error(
                    commit_creation_save(&fixture.service, &fixture.root, request(&prepared, kind))
                        .unwrap_err(),
                );
                assert_eq!(error.raw_os_error(), Some(failure.code()));
                assert_eq!(
                    count(&fixture.service, "findings") + count(&fixture.service, "drafts"),
                    0
                );
                if startup {
                    let reopened = open(&fixture.root);
                    assert_eq!(
                        reconcile_creation_saves(&reopened, &fixture.root)
                            .unwrap()
                            .pending_attempts,
                        0
                    );
                } else {
                    assert_eq!(
                        abort_creation_save(&fixture.service, &fixture.root, "attempt").unwrap(),
                        CreationOutcome::Aborted
                    );
                }
                assert_eq!(
                    abort_creation_save(&fixture.service, &fixture.root, "attempt").unwrap(),
                    CreationOutcome::Aborted
                );
                assert!(!temporary(&fixture, &prepared).exists());
                assert_eq!(count(&fixture.service, "attachments"), 1);
                assert_eq!(fs::read(unrelated).unwrap(), b"retain");
                assert_eq!(
                    fs::read(fixture.root.join(shared.relative_path)).unwrap(),
                    b"borrowed"
                );
            }
        }
    }
}

#[test]
fn cleanup_failure_reports_both_errors_and_retains_the_original_source() {
    for kind in [CreationKind::Finding, CreationKind::Testware] {
        for failure in [Failure::PartialWrite, Failure::Sync] {
            let fixture = Fixture::new();
            let (_, prepared) = fixture.prepare(kind, 1);
            let _reset = fail_next_write(failure, true);
            let error = io_error(
                commit_creation_save(&fixture.service, &fixture.root, request(&prepared, kind))
                    .unwrap_err(),
            );
            assert_eq!(
                error.kind(),
                io::Error::from_raw_os_error(failure.code()).kind()
            );
            let source = error
                .get_ref()
                .unwrap()
                .source()
                .unwrap()
                .downcast_ref::<io::Error>()
                .unwrap();
            assert_eq!(source.raw_os_error(), Some(failure.code()));
            assert!(error.to_string().contains(&source.to_string()));
            assert!(error.to_string().contains(
                "failed to remove newly created creation temp file: injected unlink failure"
            ));
            assert!(
                REMOVE.with_borrow(|hook| hook.is_none()),
                "cleanup attempted after file close"
            );
            let expected = match failure {
                Failure::PartialWrite => &b"im"[..],
                Failure::Sync => &b"image"[..],
            };
            assert_eq!(fs::read(temporary(&fixture, &prepared)).unwrap(), expected);
            zero_records(&fixture);
        }
    }
}

#[test]
fn preexisting_mismatched_temp_or_final_is_never_removed_by_stage_or_recovery() {
    for kind in [CreationKind::Finding, CreationKind::Testware] {
        for at_temp in [false, true] {
            for bytes in [&b"im"[..], &b"other"[..]] {
                let fixture = Fixture::new();
                let (_, prepared) = fixture.prepare(kind, 1);
                let target = if at_temp {
                    temporary(&fixture, &prepared)
                } else {
                    path(&fixture.service, &fixture.root, 0)
                };
                fs::create_dir_all(target.parent().unwrap()).unwrap();
                fs::write(&target, bytes).unwrap();
                let _reset = fail_next_write(Failure::PartialWrite, false);
                assert!(matches!(
                    commit_creation_save(&fixture.service, &fixture.root, request(&prepared, kind)),
                    Err(QaScribeError::Validation(_))
                ));
                assert!(abort_creation_save(&fixture.service, &fixture.root, "attempt").is_err());
                assert_eq!(
                    reconcile_creation_saves(&fixture.service, &fixture.root)
                        .unwrap()
                        .pending_attempts,
                    1
                );
                assert_eq!(fs::read(&target).unwrap(), bytes);
                assert!(
                    WRITE.with_borrow(|hook| hook.is_some()),
                    "preexisting file never enters owned-write branch"
                );
                assert!(REMOVE.with_borrow(|hook| hook.is_none()));
                zero_records(&fixture);
            }
        }
    }
}

#[test]
fn a_valid_preexisting_temp_is_reused_without_opening_or_cleaning_it() {
    for kind in [CreationKind::Finding, CreationKind::Testware] {
        let fixture = Fixture::new();
        let (_, prepared) = fixture.prepare(kind, 1);
        let temp = temporary(&fixture, &prepared);
        fs::create_dir_all(temp.parent().unwrap()).unwrap();
        fs::write(&temp, b"image").unwrap();
        let _reset = fail_next_write(Failure::PartialWrite, false);
        assert!(matches!(
            commit_creation_save(&fixture.service, &fixture.root, request(&prepared, kind))
                .unwrap(),
            CreationOutcome::Committed { .. }
        ));
        assert!(WRITE.with_borrow(|hook| hook.is_some()));
        assert!(REMOVE.with_borrow(|hook| hook.is_none()));
        assert!(!temp.exists());
        assert_eq!(
            fs::read(path(&fixture.service, &fixture.root, 0)).unwrap(),
            b"image"
        );
        assert_eq!(count(&fixture.service, "attachments"), 1);
    }
}

#[cfg(unix)]
#[test]
fn a_complete_owned_staging_image_is_reused_without_rewriting() {
    for kind in [CreationKind::Finding, CreationKind::Testware] {
        let fixture = Fixture::new();
        let status = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "attachments::creation::tests::cut_worker",
                "--nocapture",
            ])
            .env("UC1_CUT_ROOT", &fixture.root)
            .env("UC1_CUT", "temp")
            .env("UC1_KIND", kind.as_str())
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(93));
        let prepared = fixture
            .service
            .prepare_creation_save(preparation(&fixture.session, kind, 2))
            .unwrap();
        assert_eq!(fs::read(temporary(&fixture, &prepared)).unwrap(), b"image");
        let second_legacy = fixture
            .root
            .join("attachments")
            .join(&fixture.session)
            .join(format!(".{}.tmp", prepared.images[1].attachment_id));
        fs::write(&second_legacy, b"image").unwrap();
        let _reset = fail_next_write(Failure::PartialWrite, false);
        let result =
            commit_creation_save(&fixture.service, &fixture.root, request(&prepared, kind))
                .unwrap();
        assert!(matches!(result, CreationOutcome::Committed { .. }));
        assert!(
            WRITE.with_borrow(|hook| hook.is_some()),
            "neither verified legacy nor complete owned temp enters write branch"
        );
        assert!(REMOVE.with_borrow(|hook| hook.is_none()));
        assert_eq!(count(&fixture.service, "creation_staging"), 0);
        assert_eq!(count(&fixture.service, "attachments"), 2);
        assert_eq!(
            count(&fixture.service, "findings") + count(&fixture.service, "drafts"),
            1
        );
    }
}
