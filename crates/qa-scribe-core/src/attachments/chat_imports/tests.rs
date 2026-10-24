use std::path::PathBuf;

use base64::{Engine, engine::general_purpose::STANDARD};

use super::*;
use crate::{
    attachments::chat::PreparedChatImageImport,
    domain::{ChatRevision, SessionDraft},
};

struct Fixture {
    service: SessionService,
    root: PathBuf,
    prepared: PreparedChatImageImport,
    path: String,
    temp: String,
    session: String,
}

impl Fixture {
    fn new() -> Self {
        let service = SessionService::in_memory().unwrap();
        let session = service
            .create_session(SessionDraft {
                title: "Recovery".into(),
                ..Default::default()
            })
            .unwrap()
            .id;
        let chat = service.load_chat(&session).unwrap();
        let scope = ChatRevision {
            session_id: session.clone(),
            draft_id: chat.draft_id,
            expected_revision: chat.revision,
        };
        let data = format!(
            "data:image/png;base64,{}",
            STANDARD.encode(include_bytes!(
                "../../../../../e2e/fixtures/chat-image-pixels.png"
            ))
        );
        let prepared = PreparedChatImageImport::decode(scope, "pixel.png".into(), &data).unwrap();
        prepared.reserve(&service).unwrap();
        let (path, temp) = service
            .database()
            .connection()
            .query_row(
                "SELECT relative_path, temp_path FROM chat_image_imports",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let root =
            std::env::temp_dir().join(format!("qa-import-recovery-{}", uuid::Uuid::new_v4()));
        Self {
            service,
            root,
            prepared,
            path,
            temp,
            session,
        }
    }

    fn pending(&self) -> i64 {
        self.service
            .database()
            .connection()
            .query_row("SELECT count(*) FROM chat_image_imports", [], |row| {
                row.get(0)
            })
            .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn compensation_never_removes_a_durably_owned_attachment_even_with_a_receipt() {
    let fixture = Fixture::new();
    fixture.prepared.write(&fixture.root).unwrap();
    let chat = fixture.prepared.commit(&fixture.service).unwrap();
    fixture.service.database().connection().execute(
        "INSERT INTO chat_image_imports (relative_path, temp_path, session_id) VALUES (?1, ?2, ?3)",
        params![fixture.path, fixture.temp, fixture.session],
    ).unwrap();
    fixture
        .prepared
        .recover(&fixture.service, &fixture.root)
        .unwrap();
    assert_eq!(fixture.pending(), 1);
    assert_eq!(
        recover_chat_image_imports(&fixture.service, &fixture.root).unwrap(),
        1
    );
    assert_eq!(fixture.service.load_chat(&fixture.session).unwrap(), chat);
    assert_eq!(
        std::fs::read(fixture.root.join(&fixture.path)).unwrap(),
        include_bytes!("../../../../../e2e/fixtures/chat-image-pixels.png")
    );
}

#[test]
fn failed_scoped_cleanup_keeps_receipt_for_startup_retry_without_removing_siblings() {
    let fixture = Fixture::new();
    fixture.prepared.write(&fixture.root).unwrap();
    let target = fixture.root.join(&fixture.path);
    std::fs::remove_file(&target).unwrap();
    std::fs::create_dir(&target).unwrap();
    let sibling = target.parent().unwrap().join("unknown.png");
    std::fs::write(&sibling, b"keep sibling").unwrap();
    fixture
        .prepared
        .recover(&fixture.service, &fixture.root)
        .unwrap();
    assert_eq!(fixture.pending(), 1);
    assert!(target.is_dir());
    std::fs::remove_dir(&target).unwrap();
    assert_eq!(
        recover_chat_image_imports(&fixture.service, &fixture.root).unwrap(),
        0
    );
    assert_eq!(std::fs::read(sibling).unwrap(), b"keep sibling");
    assert_eq!(
        fixture
            .service
            .list_attachments(&fixture.session)
            .unwrap()
            .len(),
        0
    );
}

#[cfg(unix)]
#[test]
fn writer_and_compensation_preserve_external_files_behind_symlinked_session_directory() {
    let fixture = Fixture::new();
    let external = fixture.root.join("external");
    std::fs::create_dir_all(&external).unwrap();
    std::fs::create_dir(fixture.root.join("attachments")).unwrap();
    let basename = Path::new(&fixture.path).file_name().unwrap();
    let external_file = external.join(basename);
    std::fs::write(&external_file, b"external pixels").unwrap();
    let session_dir = fixture.root.join("attachments").join(&fixture.session);
    std::os::unix::fs::symlink(&external, &session_dir).unwrap();
    assert!(fixture.prepared.write(&fixture.root).is_err());
    fixture
        .prepared
        .recover(&fixture.service, &fixture.root)
        .unwrap();
    assert_eq!(fixture.pending(), 1);
    assert_eq!(std::fs::read(&external_file).unwrap(), b"external pixels");
    std::fs::remove_file(session_dir).unwrap();
    assert_eq!(
        recover_chat_image_imports(&fixture.service, &fixture.root).unwrap(),
        0
    );
    assert_eq!(std::fs::read(external_file).unwrap(), b"external pixels");
}
