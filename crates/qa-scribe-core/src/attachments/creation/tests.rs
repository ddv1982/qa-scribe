use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Barrier},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use rusqlite::params;

use super::*;
use crate::{
    attachments::{hex_sha256, import_managed_attachment_bytes},
    services::SessionService,
    storage::Database,
};

struct Fixture {
    root: PathBuf,
    service: SessionService,
    session: String,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("uc1-creation-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let service = open(&root);
        let session = service
            .create_session(SessionDraft {
                title: "Creation boundary".into(),
                ..Default::default()
            })
            .unwrap()
            .id;
        Self {
            root,
            service,
            session,
        }
    }
    fn prepare(
        &self,
        kind: CreationKind,
        images: usize,
    ) -> (PrepareCreationSave, PreparedCreation) {
        let request = preparation(&self.session, kind, images);
        let prepared = self.service.prepare_creation_save(request.clone()).unwrap();
        (request, prepared)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
fn open(root: &Path) -> SessionService {
    SessionService::new(Database::open(root.join("db.sqlite")).unwrap()).unwrap()
}
fn preparation(session: &str, kind: CreationKind, images: usize) -> PrepareCreationSave {
    PrepareCreationSave {
        attempt_id: "attempt".into(),
        session_id: session.into(),
        kind,
        images: (0..images)
            .map(|index| CreationImageDescriptor {
                local_id: index.to_string(),
                filename: "evidence.png".into(),
                mime_type: "image/png".into(),
                size_bytes: 5,
                sha256: hex_sha256(b"image"),
            })
            .collect(),
    }
}
fn request(prepared: &PreparedCreation, kind: CreationKind) -> CommitCreationSave {
    let body = prepared
        .images
        .iter()
        .map(|image| {
            format!(
                "<img src=\"qa-scribe-attachment://{}\" data-attachment-id=\"{}\">",
                image.attachment_id, image.attachment_id
            )
        })
        .collect::<String>();
    let record = match kind {
        CreationKind::Finding => CreationRecordInput::Finding {
            title: "Finding".into(),
            body,
            body_json: None,
            body_format: None,
            metadata_json: None,
            finding_kind: FindingKind::Bug,
        },
        CreationKind::Testware => CreationRecordInput::Testware {
            title: "Test cases".into(),
            body,
            body_json: None,
            body_format: None,
            metadata_json: None,
        },
    };
    CommitCreationSave {
        attempt_id: prepared.attempt_id.clone(),
        record,
        images: prepared
            .images
            .iter()
            .map(|image| CreationImageInput {
                local_id: image.local_id.clone(),
                data_url: format!("data:image/png;base64,{}", STANDARD.encode(b"image")),
            })
            .collect(),
        shared_attachment_ids: vec![],
    }
}
fn count(service: &SessionService, table: &str) -> i64 {
    service
        .database()
        .connection()
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
}
fn path(service: &SessionService, root: &Path, index: usize) -> PathBuf {
    let value: String = service
        .database()
        .connection()
        .query_row(
            "SELECT relative_path FROM creation_attempt_images WHERE local_id = ?1",
            [index.to_string()],
            |row| row.get(0),
        )
        .unwrap();
    root.join(value)
}
fn title(record: &mut CreationRecordInput, value: &str) {
    match record {
        CreationRecordInput::Finding { title, .. }
        | CreationRecordInput::Testware { title, .. } => *title = value.into(),
    }
}

#[test]
fn reservation_is_stable_has_no_file_effect_and_zero_image_commit_is_idempotent() {
    let fixture = Fixture::new();
    assert_eq!(count(&fixture.service, "creation_attempts"), 0);
    for kind in [CreationKind::Finding, CreationKind::Testware] {
        let mut prep = preparation(&fixture.session, kind, 0);
        prep.attempt_id = format!("zero-{}", kind.as_str());
        let prepared = fixture.service.prepare_creation_save(prep.clone()).unwrap();
        assert_eq!(prepared.outcome, CreationOutcome::Preparing);
        assert_eq!(
            fixture.service.prepare_creation_save(prep).unwrap(),
            prepared
        );
        assert!(!fixture.root.join("attachments").exists());
        let request = request(&prepared, kind);
        let result =
            commit_creation_save(&fixture.service, &fixture.root, request.clone()).unwrap();
        assert_eq!(
            commit_creation_save(&fixture.service, &fixture.root, request).unwrap(),
            result
        );
        assert_eq!(
            abort_creation_save(&fixture.service, &fixture.root, &prepared.attempt_id).unwrap(),
            result
        );
    }
    assert_eq!(count(&fixture.service, "findings"), 1);
    assert_eq!(count(&fixture.service, "drafts"), 1);
    assert_eq!(count(&fixture.service, "attachments"), 0);
}

#[test]
fn owned_and_shared_images_commit_together_and_receipts_survive_both_record_deletions() {
    for kind in [CreationKind::Finding, CreationKind::Testware] {
        let fixture = Fixture::new();
        let shared = import_managed_attachment_bytes(
            &fixture.service,
            &fixture.root,
            &fixture.session,
            None,
            "note.png".into(),
            Some("image/png".into()),
            b"shared".to_vec(),
        )
        .unwrap();
        let (_, prepared) = fixture.prepare(kind, 2);
        let mut request = request(&prepared, kind);
        request.shared_attachment_ids.push(shared.id.clone());
        match &mut request.record {
            CreationRecordInput::Finding { body, .. }
            | CreationRecordInput::Testware { body, .. } => body.push_str(&format!(
                "<img src=\"qa-scribe-attachment://{}\">",
                shared.id
            )),
        }
        let result =
            commit_creation_save(&fixture.service, &fixture.root, request.clone()).unwrap();
        assert_eq!(count(&fixture.service, "attachments"), 3);
        let id = match result {
            CreationOutcome::Committed { record } => match *record {
                CreatedRecord::Finding(record) => {
                    fixture.service.delete_finding(&record.id).unwrap();
                    record.id
                }
                CreatedRecord::Testware(record) => {
                    fixture.service.delete_draft(&record.id).unwrap();
                    record.id
                }
            },
            other => panic!("Unexpected outcome {other:?}"),
        };
        let expected = CreationOutcome::CommittedDeleted { record_id: id };
        assert_eq!(
            commit_creation_save(&fixture.service, &fixture.root, request).unwrap(),
            expected
        );
        assert_eq!(
            abort_creation_save(&fixture.service, &fixture.root, "attempt").unwrap(),
            expected
        );
        assert_eq!(count(&fixture.service, "creation_attempts"), 1);
        assert_eq!(
            fs::read(fixture.root.join(shared.relative_path)).unwrap(),
            b"shared"
        );
    }
}

#[test]
fn preparation_and_committed_fingerprint_reject_changed_inputs_but_normalize_json() {
    let fixture = Fixture::new();
    let (prep, prepared) = fixture.prepare(CreationKind::Finding, 1);
    let mut changed = prep.clone();
    changed.images[0].filename = "other.png".into();
    assert!(fixture.service.prepare_creation_save(changed).is_err());
    let mut changed = prep.clone();
    changed.kind = CreationKind::Testware;
    assert!(fixture.service.prepare_creation_save(changed).is_err());
    let other = fixture
        .service
        .create_session(SessionDraft {
            title: "Other".into(),
            ..Default::default()
        })
        .unwrap();
    let mut changed = prep;
    changed.session_id = other.id;
    assert!(fixture.service.prepare_creation_save(changed).is_err());
    let mut request = request(&prepared, CreationKind::Finding);
    if let CreationRecordInput::Finding { metadata_json, .. } = &mut request.record {
        *metadata_json = Some("{\"z\":1,\"a\":2}".into());
    }
    let result = commit_creation_save(&fixture.service, &fixture.root, request.clone()).unwrap();
    if let CreationRecordInput::Finding { metadata_json, .. } = &mut request.record {
        *metadata_json = Some("{ \"a\": 2, \"z\":1 }".into());
    }
    assert_eq!(
        commit_creation_save(&fixture.service, &fixture.root, request.clone()).unwrap(),
        result
    );
    title(&mut request.record, "Different authored content");
    assert!(commit_creation_save(&fixture.service, &fixture.root, request).is_err());
    assert_eq!(count(&fixture.service, "findings"), 1);
    assert_eq!(count(&fixture.service, "creation_attempt_images"), 1);
}

#[test]
fn validation_rejects_invalid_compact_records_refs_and_image_bytes_before_files() {
    let fixture = Fixture::new();
    let (_, prepared) = fixture.prepare(CreationKind::Finding, 1);
    let valid = request(&prepared, CreationKind::Finding);
    let mut invalid = valid.clone();
    invalid.images[0].data_url = format!("data:image/png;base64,{}", STANDARD.encode(b"wrong"));
    assert!(commit_creation_save(&fixture.service, &fixture.root, invalid).is_err());
    let mut invalid = valid.clone();
    invalid.images.clear();
    assert!(commit_creation_save(&fixture.service, &fixture.root, invalid).is_err());
    let mut invalid = valid.clone();
    title(&mut invalid.record, &"x".repeat(161));
    assert!(commit_creation_save(&fixture.service, &fixture.root, invalid).is_err());
    let mut invalid = valid.clone();
    if let CreationRecordInput::Finding { body, .. } = &mut invalid.record {
        *body = "x".repeat(100_001);
    }
    assert!(commit_creation_save(&fixture.service, &fixture.root, invalid).is_err());
    let mut invalid = valid.clone();
    if let CreationRecordInput::Finding { body, .. } = &mut invalid.record {
        *body = "<img SRC='data&#58;image/png;base64,aW1hZ2U='>".into();
    }
    assert!(commit_creation_save(&fixture.service, &fixture.root, invalid).is_err());
    let mut invalid = valid.clone();
    if let CreationRecordInput::Finding { body_json, .. } = &mut invalid.record {
        *body_json = Some("{\"type\":\"doc\",\"content\":[]}".into());
    }
    assert!(commit_creation_save(&fixture.service, &fixture.root, invalid).is_err());
    let mut invalid = valid;
    invalid.shared_attachment_ids.push("missing".into());
    assert!(commit_creation_save(&fixture.service, &fixture.root, invalid).is_err());
    assert!(!fixture.root.join("attachments").exists());
    assert_eq!(count(&fixture.service, "findings"), 0);
}

#[test]
fn concurrent_prepares_and_commits_converge_on_one_record_and_mapping() {
    let fixture = Fixture::new();
    let barrier = Arc::new(Barrier::new(2));
    let workers: Vec<_> = (0..2)
        .map(|_| {
            let root = fixture.root.clone();
            let session = fixture.session.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let service = open(&root);
                barrier.wait();
                let prepared = service
                    .prepare_creation_save(preparation(&session, CreationKind::Finding, 1))
                    .unwrap();
                let result = commit_creation_save(
                    &service,
                    &root,
                    request(&prepared, CreationKind::Finding),
                )
                .unwrap();
                (prepared.images, result)
            })
        })
        .collect();
    let values: Vec<_> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect();
    assert_eq!(values[0], values[1]);
    assert_eq!(count(&fixture.service, "findings"), 1);
    assert_eq!(count(&fixture.service, "attachments"), 1);
}

#[test]
fn abort_and_commit_serialize_and_a_committed_receipt_wins_late_cancel() {
    let fixture = Fixture::new();
    let (_, prepared) = fixture.prepare(CreationKind::Finding, 1);
    let barrier = Arc::new(Barrier::new(2));
    let root = fixture.root.clone();
    let gate = barrier.clone();
    let worker = std::thread::spawn(move || {
        let service = open(&root);
        gate.wait();
        commit_creation_save(&service, &root, request(&prepared, CreationKind::Finding)).unwrap()
    });
    barrier.wait();
    let aborted = abort_creation_save(&fixture.service, &fixture.root, "attempt").unwrap();
    let committed = worker.join().unwrap();
    let final_outcome = abort_creation_save(&fixture.service, &fixture.root, "attempt").unwrap();
    match final_outcome {
        CreationOutcome::Aborted => {
            assert_eq!(count(&fixture.service, "findings"), 0);
            assert_eq!(aborted, CreationOutcome::Aborted);
            assert_eq!(committed, CreationOutcome::Aborted);
        }
        CreationOutcome::Committed { .. } => {
            assert_eq!(count(&fixture.service, "findings"), 1);
            assert_eq!(committed, aborted);
        }
        other => panic!("Unexpected race result {other:?}"),
    }
}

pub(super) fn cut(point: &str) {
    if std::env::var("UC1_CUT").as_deref() == Ok(point) {
        std::process::exit(93);
    }
}

#[test]
fn cut_worker() {
    let Ok(root) = std::env::var("UC1_CUT_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    let service = open(&root);
    let session: String = service
        .database()
        .connection()
        .query_row("SELECT id FROM sessions LIMIT 1", [], |row| row.get(0))
        .unwrap();
    let kind = if std::env::var("UC1_KIND").as_deref() == Ok("testware") {
        CreationKind::Testware
    } else {
        CreationKind::Finding
    };
    let prepared = service
        .prepare_creation_save(preparation(&session, kind, 2))
        .unwrap();
    cut("reserved");
    if std::env::var("UC1_CUT").as_deref() == Ok("unlink") {
        abort_creation_save(&service, &root, "attempt").unwrap();
        return;
    }
    commit_creation_save(&service, &root, request(&prepared, kind)).unwrap();
}

mod recovery;

mod safety;

mod limits;

mod process;

pub(super) mod io_failure;
