use std::{env, path::PathBuf};

use qa_scribe_core::{
    domain::{TEXT_BODY_MAX_LENGTH, validate_body_text},
    storage::Database,
};
use rusqlite::params;
use serde_json::json;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(
        env::args_os()
            .nth(1)
            .ok_or("usage: generate_ui_perf_fixture <new-app-data-directory>")?,
    );
    if root.exists() {
        return Err("fixture directory must not exist; use a new disposable directory".into());
    }
    std::fs::create_dir_all(root.join("attachments/perf-session"))?;
    let image = include_bytes!("../../../e2e/fixtures/chat-image-pixels.png");
    use sha2::{Digest, Sha256};
    let image_hash = format!("{:x}", Sha256::digest(image));
    let timestamp = "2026-01-01T00:00:00Z";
    let paragraph = "Deterministic rich record evidence. ".repeat(16);
    let mut nodes = vec![];
    let mut html = String::new();
    for index in 0..150 {
        let text = format!("Paragraph {index:03}. {paragraph}");
        html.push_str(&format!("<p>{text}</p>"));
        nodes.push(json!({"type":"paragraph", "content":[{"type":"text", "text":text}]}));
    }
    for index in 0..4 {
        let id = format!("perf-image-{index}");
        let src = format!("qa-scribe-attachment://{id}");
        html.push_str(&format!("<img src=\"{src}\" alt=\"Synthetic {index}\">"));
        nodes.push(json!({"type":"image", "attrs":{"src":src, "attachmentId":id, "alt":format!("Synthetic {index}")}}));
        std::fs::write(
            root.join(format!("attachments/perf-session/{id}.png")),
            image,
        )?;
    }
    html.push_str("<p>PERF_RECORD_END</p>");
    nodes.push(json!({"type":"paragraph", "content":[{"type":"text", "text":"PERF_RECORD_END"}]}));
    validate_body_text("Performance finding", &html, TEXT_BODY_MAX_LENGTH - 1024)?;
    let body_json = json!({"schemaVersion":1, "doc":{"type":"doc", "content":nodes}}).to_string();
    let database = Database::open(root.join("qa-scribe.sqlite"))?;
    database.with_immediate_tx(|tx| {
        tx.execute("INSERT INTO sessions(id,title,created_at,updated_at,last_opened_at) VALUES('perf-session','Native UI performance fixture',?1,?1,?1)", [timestamp])?;
        tx.execute("INSERT INTO entries(id,session_id,type,title,body,created_at,updated_at) VALUES('perf-note','perf-session','note','Performance Note','<p>PERF_NOTE_READY</p>',?1,?1)", [timestamp])?;
        tx.execute("INSERT INTO findings(id,session_id,title,body,body_json,body_format,kind,created_at,updated_at) VALUES('perf-finding','perf-session','Performance rich finding',?1,?2,'tiptap_json','bug',?3,?3)", params![html, body_json, timestamp])?;
        tx.execute("INSERT INTO chat_drafts(id,session_id,mode,created_at) VALUES('perf-chat','perf-session','write_note',?1)", [timestamp])?;
        for index in 0..100 {
            let role = if index % 2 == 0 { "user" } else { "assistant" };
            let text = format!("PERF_MESSAGE_{index:03}. {}", "Deterministic conversation evidence. ".repeat(12));
            tx.execute("INSERT INTO chat_messages(id,draft_id,turn_id,sequence,role,text,status,created_at) VALUES(?1,'perf-chat',?2,?3,?4,?5,?6,?7)", params![format!("perf-message-{index}"), format!("perf-turn-{}", index / 2), index, role, text, if index == 98 { "running" } else { "completed" }, timestamp])?;
        }
        for index in 0..4 {
            let id = format!("perf-image-{index}");
            tx.execute("INSERT INTO attachments(id,session_id,filename,mime_type,size_bytes,sha256,relative_path,created_at) VALUES(?1,'perf-session',?2,'image/png',?3,?4,?5,?6)", params![id, format!("synthetic-{index}.png"), image.len(), image_hash, format!("attachments/perf-session/{id}.png"), timestamp])?;
            tx.execute("INSERT INTO chat_message_images(message_id,attachment_id,ordinal) VALUES('perf-message-98',?1,?2)", params![id, index])?;
        }
        tx.execute("UPDATE chat_messages SET status='completed' WHERE id='perf-message-98'", [])?;
        Ok(())
    })?;
    let violations = database.connection().query_row(
        "SELECT count(*) FROM pragma_foreign_key_check",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if violations != 0 {
        return Err("fixture foreign-key violation".into());
    }
    database
        .connection()
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    let receipt = json!({"schema":"qa-scribe-ui-perf-fixture-v1", "sessionId":"perf-session", "findingId":"perf-finding", "messages":100, "images":4, "imageBytesEach":image.len(), "imageSha256":image_hash, "recordHtmlBytes":html.len(), "recordJsonBytes":body_json.len(), "foreignKeyViolations":violations});
    std::fs::write(root.join("ui-perf-fixture.json"), format!("{receipt}\n"))?;
    println!("{receipt}");
    Ok(())
}
