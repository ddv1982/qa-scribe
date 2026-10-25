use std::{fs, path::PathBuf};

use base64::{Engine, engine::general_purpose::STANDARD};
use qa_scribe_core::{
    attachments::{chat::import_chat_image_data_url, retry_attachment_cleanup},
    domain::*,
    services::SessionService,
    storage::{Database, SCHEMA_VERSION},
};

struct Fixture {
    service: SessionService,
    root: PathBuf,
    session: String,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("qa-chat-release-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let service =
            SessionService::new(Database::open(root.join("test.sqlite")).unwrap()).unwrap();
        let session = service
            .create_session(SessionDraft {
                title: "Release".into(),
                ..Default::default()
            })
            .unwrap()
            .id;
        Self {
            service,
            root,
            session,
        }
    }

    fn import(&self, chat: &ChatState) -> ChatState {
        import_chat_image_data_url(
            &self.service,
            &self.root,
            scope(chat),
            "pixel.png".into(),
            &png(),
        )
        .unwrap()
    }

    fn attachment(&self, chat: &ChatState) -> Attachment {
        self.service
            .get_attachment(&chat.composer_images.last().unwrap().attachment_id)
            .unwrap()
            .unwrap()
    }

    fn retry(&self) {
        assert_eq!(
            retry_attachment_cleanup(&self.service, &self.root)
                .unwrap()
                .pending_files,
            Some(0)
        );
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn png() -> String {
    format!(
        "data:image/png;base64,{}",
        STANDARD.encode(include_bytes!(
            "../../../e2e/fixtures/chat-image-pixels.png"
        ))
    )
}

fn scope(chat: &ChatState) -> ChatRevision {
    ChatRevision {
        session_id: chat.session_id.clone(),
        draft_id: chat.draft_id.clone(),
        expected_revision: chat.revision,
    }
}

fn request(chat: &ChatState, ids: Vec<String>) -> ChatComposerRequest {
    ChatComposerRequest {
        intent: qa_scribe_core::domain::ChatComposerIntent::Message,
        scope: scope(chat),
        composer: "preserved text".into(),
        mode: ChatMode::Chat,
        attachment_ids: ids,
    }
}

#[test]
fn repeated_import_remove_reclaims_only_released_rows_and_real_files_in_live_session() {
    let f = Fixture::new();
    let unrelated = qa_scribe_core::attachments::import_managed_attachment_bytes(
        &f.service,
        &f.root,
        &f.session,
        None,
        "other.txt".into(),
        None,
        b"unrelated".to_vec(),
    )
    .unwrap();
    let unknown = f
        .root
        .join("attachments")
        .join(&f.session)
        .join("unknown.txt");
    fs::write(&unknown, b"unknown").unwrap();
    let mut chat = f.service.load_chat(&f.session).unwrap();
    for _ in 0..8 {
        chat = f.import(&chat);
        let a = f.attachment(&chat);
        assert!(f.root.join(&a.relative_path).is_file());
        chat = f
            .service
            .save_chat_composer(request(&chat, vec![]))
            .unwrap();
        f.retry();
        let row = f.service.get_attachment(&a.id).unwrap();
        let file = f.root.join(&a.relative_path).exists();
        assert!(
            row.is_none() && !file,
            "released orphan remains: row={}, file={file}",
            row.is_some()
        );
        assert_eq!(chat.composer, "preserved text");
        assert_eq!(
            f.service.list_attachments(&f.session).unwrap(),
            vec![unrelated.clone()]
        );
    }
    assert!(f.service.get_session(&f.session).unwrap().is_some());
    assert_eq!(fs::read(unknown).unwrap(), b"unknown");
    assert_eq!(
        fs::read(f.root.join(unrelated.relative_path)).unwrap(),
        b"unrelated"
    );
}

fn pending(service: &SessionService) -> i64 {
    service
        .database()
        .connection()
        .query_row("SELECT count(*) FROM chat_image_cleanup", [], |row| {
            row.get(0)
        })
        .unwrap()
}

#[test]
fn rejected_or_failed_save_preserves_composer_ownership_row_and_pixels() {
    for trigger in [
        "CREATE TRIGGER reject_release BEFORE INSERT ON chat_image_cleanup BEGIN SELECT RAISE(ABORT, 'release failed'); END;",
        "CREATE TRIGGER reject_release BEFORE INSERT ON chat_image_cleanup BEGIN SELECT RAISE(IGNORE); END;",
        "CREATE TRIGGER reject_release BEFORE DELETE ON attachments BEGIN SELECT RAISE(ABORT, 'delete failed'); END;",
        "CREATE TRIGGER reject_release BEFORE DELETE ON attachments BEGIN SELECT RAISE(IGNORE); END;",
        "CREATE TRIGGER reject_release BEFORE UPDATE ON chat_drafts BEGIN SELECT RAISE(ABORT, 'save failed'); END;",
    ] {
        let f = Fixture::new();
        let chat = f.import(&f.service.load_chat(&f.session).unwrap());
        let a = f.attachment(&chat);
        f.service
            .database()
            .connection()
            .execute_batch(trigger)
            .unwrap();
        assert!(
            f.service
                .save_chat_composer(request(&chat, vec![]))
                .is_err()
        );
        assert_eq!(f.service.load_chat(&f.session).unwrap(), chat);
        assert_eq!(f.service.get_attachment(&a.id).unwrap(), Some(a.clone()));
        assert_eq!(pending(&f.service), 0);
        assert_eq!(
            fs::read(f.root.join(a.relative_path)).unwrap(),
            include_bytes!("../../../e2e/fixtures/chat-image-pixels.png")
        );
    }
    let f = Fixture::new();
    let old = f.service.load_chat(&f.session).unwrap();
    let chat = f.import(&old);
    for req in [
        request(&old, vec![]),
        request(&chat, vec!["unknown".into()]),
    ] {
        assert!(f.service.save_chat_composer(req).is_err());
        assert_eq!(f.service.load_chat(&f.session).unwrap(), chat);
        assert_eq!(pending(&f.service), 0);
    }
    assert!(f.root.join(f.attachment(&chat).relative_path).is_file());
}

#[test]
fn committed_release_reopens_before_unlink_and_after_unlink_before_ack() {
    for unlink in [false, true] {
        let mut f = Fixture::new();
        let chat = f.import(&f.service.load_chat(&f.session).unwrap());
        let a = f.attachment(&chat);
        f.service
            .save_chat_composer(request(&chat, vec![]))
            .unwrap();
        assert!(f.service.get_attachment(&a.id).unwrap().is_none());
        assert_eq!(pending(&f.service), 1);
        if unlink {
            fs::remove_file(f.root.join(&a.relative_path)).unwrap();
        }
        f.service = SessionService::in_memory().unwrap();
        f.service =
            SessionService::new(Database::open(f.root.join("test.sqlite")).unwrap()).unwrap();
        assert_eq!(pending(&f.service), 1);
        f.retry();
        f.retry();
        assert!(!f.root.join(a.relative_path).exists());
        assert!(f.service.get_session(&f.session).unwrap().is_some());
    }
}

#[test]
fn unlink_and_ack_failures_preserve_durable_intent_and_do_not_fail_committed_save() {
    for ack_failure in [false, true] {
        let mut f = Fixture::new();
        let chat = f.import(&f.service.load_chat(&f.session).unwrap());
        let a = f.attachment(&chat);
        let path = f.root.join(&a.relative_path);
        if ack_failure {
            f.service.database().connection().execute_batch("CREATE TRIGGER reject_ack BEFORE DELETE ON chat_image_cleanup BEGIN SELECT RAISE(ABORT, 'ack failed'); END;").unwrap();
        } else {
            fs::remove_file(&path).unwrap();
            fs::create_dir(&path).unwrap();
            fs::write(path.join("unknown"), b"keep").unwrap();
        }
        let saved = qa_scribe_core::attachments::chat_cleanup::save_chat_composer_with_cleanup(
            &f.service,
            &f.root,
            request(&chat, vec![]),
        )
        .unwrap();
        assert!(saved.composer_images.is_empty());
        assert_eq!(pending(&f.service), 1);
        assert!(f.service.get_attachment(&a.id).unwrap().is_none());
        if ack_failure {
            assert!(!path.exists());
        } else {
            assert_eq!(fs::read(path.join("unknown")).unwrap(), b"keep");
        }
        f.service = SessionService::in_memory().unwrap();
        f.service =
            SessionService::new(Database::open(f.root.join("test.sqlite")).unwrap()).unwrap();
        if ack_failure {
            f.service
                .database()
                .connection()
                .execute_batch("DROP TRIGGER reject_ack")
                .unwrap();
        } else {
            fs::remove_file(path.join("unknown")).unwrap();
            fs::remove_dir(&path).unwrap();
        }
        f.retry();
        assert!(!path.exists());
    }
}

#[test]
fn schema14_physical_upgrade_preserves_owners_and_does_not_backfill_arbitrary_orphans() {
    let f = Fixture::new();
    let path = f.root.join("legacy.sqlite");
    let c = rusqlite::Connection::open(&path).unwrap();
    c.execute_batch(include_str!("fixtures/schema_v14.sql"))
        .unwrap();
    c.execute_batch("INSERT INTO sessions (id,title,created_at,updated_at,last_opened_at) VALUES ('s','Keep','t','t','t');
        INSERT INTO attachments (id,session_id,filename,mime_type,size_bytes,sha256,relative_path,created_at) VALUES ('a','s','old.png','image/png',1,'hash','attachments/s/old.png','t');
        INSERT INTO chat_image_imports (relative_path,temp_path,session_id) VALUES ('attachments/s/pending.png','attachments/s/.pending.tmp','s');
        INSERT INTO attachment_cleanup (relative_path,session_id) VALUES ('attachments/deleted/old.png','deleted');
        INSERT INTO chat_drafts (id,session_id,revision,composer,created_at) VALUES ('d','s',7,'keep','t');
        INSERT INTO chat_composer_images (draft_id,attachment_id,ordinal) VALUES ('d','a',0);").unwrap();
    assert!(c.prepare("SELECT * FROM chat_image_cleanup").is_err());
    drop(c);
    for _ in 0..2 {
        let service = SessionService::new(Database::open(&path).unwrap()).unwrap();
        assert_eq!(
            service
                .database()
                .connection()
                .pragma_query_value(None, "user_version", |r| r.get::<_, i32>(0))
                .unwrap(),
            SCHEMA_VERSION
        );
        assert_eq!(pending(&service), 0);
        assert_eq!(service.load_chat("s").unwrap().revision, 7);
        assert_eq!(
            service.load_chat("s").unwrap().composer_images[0].attachment_id,
            "a"
        );
        assert_eq!(
            service
                .database()
                .connection()
                .query_row("SELECT count(*) FROM chat_image_imports", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            service
                .database()
                .connection()
                .query_row("SELECT count(*) FROM attachment_cleanup", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            service
                .database()
                .connection()
                .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
            0
        );
    }
}

#[path = "chat_image_cleanup/references.rs"]
mod references;
#[path = "chat_image_cleanup/safety.rs"]
mod safety;

#[test]
fn schema14_failed_upgrade_rolls_back_queue_and_version_and_future_is_untouched() {
    let f = Fixture::new();
    let path = f.root.join("legacy-failed.sqlite");
    let c = rusqlite::Connection::open(&path).unwrap();
    c.execute_batch(include_str!("fixtures/schema_v14.sql"))
        .unwrap();
    c.execute_batch("CREATE TABLE idx_attachments_relative_path (id TEXT);")
        .unwrap();
    let objects = |c: &rusqlite::Connection| {
        c.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name")
            .unwrap()
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    let before = objects(&c);
    drop(c);
    assert!(Database::open(&path).is_err());
    let c = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(objects(&c), before);
    assert_eq!(
        c.pragma_query_value(None, "user_version", |r| r.get::<_, i32>(0))
            .unwrap(),
        14
    );
    c.pragma_update(None, "user_version", SCHEMA_VERSION + 1)
        .unwrap();
    drop(c);
    let bytes = fs::read(&path).unwrap();
    assert!(matches!(
        Database::open(&path),
        Err(qa_scribe_core::QaScribeError::Validation(_))
    ));
    assert_eq!(fs::read(path).unwrap(), bytes);
}

#[test]
fn save_attempts_only_its_own_released_paths_before_bounded_global_retry() {
    let f = Fixture::new();
    let chat = f.import(&f.service.load_chat(&f.session).unwrap());
    let first = f.attachment(&chat);
    let chat = f
        .service
        .save_chat_composer(request(&chat, vec![]))
        .unwrap();
    let chat = f.import(&chat);
    let second = f.attachment(&chat);
    qa_scribe_core::attachments::chat_cleanup::save_chat_composer_with_cleanup(
        &f.service,
        &f.root,
        request(&chat, vec![]),
    )
    .unwrap();
    assert!(f.root.join(&first.relative_path).is_file());
    assert!(!f.root.join(second.relative_path).exists());
    assert_eq!(pending(&f.service), 1);
    f.retry();
    assert!(!f.root.join(first.relative_path).exists());
}
