//! Images keep their position when Ask AI rewrites a Finding or a Test cases draft. Each fake reply
//! refers to the images by the ids the provider prompt actually carried.
use super::{ChatInputMessage, ChatPromptRole, build_chat_input, response};
use crate::domain::*;
use serde_json::{Value, json};

fn image(id: &str, alt: &str) -> Value {
    json!({"type":"image","attrs":{"src":format!("qa-scribe-attachment://{id}"),"alt":alt,"title":null,"width":null,"height":null,"attachmentId":id,"visualSource":null}})
}

fn paragraph(text: &str) -> Value {
    json!({"type":"paragraph","content":[{"type":"text","text":text}]})
}

fn target(kind: RefinementRecordKind) -> ChatTarget {
    let document = json!({"schemaVersion":1,"doc":{"type":"doc","content":[
        paragraph("Intro"), image("att-a", "first.png"), paragraph("Middle"), image("att-b", "second.png"), paragraph("End"),
    ]}});
    let snapshot = RecordContextSnapshot {
        session_id: "session".into(),
        record_id: "record".into(),
        title: "Checkout".into(),
        document_json: document.to_string(),
        metadata_json: None,
        record_kind: "bug".into(),
        origin: RecordSnapshotOrigin::Saved,
        local_fingerprint: String::new(),
        stored_base_token: String::new(),
    };
    match kind {
        RefinementRecordKind::Finding => ChatTarget::Finding { snapshot },
        _ => ChatTarget::TestCasesDraft { snapshot },
    }
}

fn contract(record_kind: RefinementRecordKind) -> ChatResponseContract {
    ChatResponseContract::Current(ChatResponseContractV2 {
        version: 3,
        request_id: "request-1".into(),
        purpose: ChatResponsePurpose::Refinement { record_kind },
        note_source: None,
        local_edit: false,
    })
}

/// The managed image ids in the order the provider prompt lists them.
fn prompt_image_ids(target: &ChatTarget) -> Vec<String> {
    let message = ChatInputMessage {
        id: "m1".into(),
        role: ChatPromptRole::User,
        text: "Tighten the wording".into(),
        images: vec![],
        context: target.clone(),
    };
    let prompt = build_chat_input("", vec![message]).unwrap().text();
    let context = prompt
        .split("MESSAGE_CONTEXT_JSON\n")
        .nth(1)
        .and_then(|rest| rest.lines().next())
        .unwrap();
    let context: Value = serde_json::from_str(context).unwrap();
    let document: Value =
        serde_json::from_str(context["snapshot"]["documentJson"].as_str().unwrap()).unwrap();
    document["doc"]["content"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|node| node["attrs"]["attachmentId"].as_str().map(str::to_owned))
        .collect()
}

fn rewrite(kind: RefinementRecordKind, body: &str) -> crate::Result<Vec<Value>> {
    let target = target(kind);
    let patch = if kind == RefinementRecordKind::Finding {
        json!({"kind":"finding","bodyMarkdown":body})
    } else {
        json!({"kind":"test_cases_draft","bodyMarkdown":body})
    };
    let raw = json!({"version":3,"requestId":"request-1","markdown":"Reworded.","outcome":{"kind":"edit","patch":patch}}).to_string();
    let parsed = response::interpret(&raw, &contract(kind), &target, 0, &[])?;
    let (_, after) = parsed.values.unwrap();
    let document: Value = serde_json::from_str(&after.document_json).unwrap();
    Ok(document["doc"]["content"].as_array().unwrap().clone())
}

#[test]
fn a_rewrite_keeps_each_image_where_the_reply_puts_it() {
    for kind in [
        RefinementRecordKind::Finding,
        RefinementRecordKind::TestCasesDraft,
    ] {
        let ids = prompt_image_ids(&target(kind));
        assert_eq!(ids, ["att-a", "att-b"]);
        let body = format!(
            "**Intro** revised\n\n![second.png](qa-scribe-attachment://{})\n\nMiddle\n\n![first.png](qa-scribe-attachment://{})\n\nEnd",
            ids[1], ids[0]
        );
        let content = rewrite(kind, &body).unwrap();
        assert_eq!(
            content,
            vec![
                json!({"type":"paragraph","content":[{"type":"text","text":"Intro","marks":[{"type":"bold"}]},{"type":"text","text":" revised"}]}),
                image("att-b", "second.png"),
                paragraph("Middle"),
                image("att-a", "first.png"),
                paragraph("End"),
            ],
            "{kind:?}"
        );
    }
}

#[test]
fn an_image_the_reply_leaves_out_is_appended_once() {
    let body = "Intro\n\n![first.png](qa-scribe-attachment://att-a) and text\n\nEnd";
    let content = rewrite(RefinementRecordKind::Finding, body).unwrap();
    assert_eq!(
        content,
        vec![
            paragraph("Intro"),
            image("att-a", "first.png"),
            paragraph(" and text"),
            paragraph("End"),
            image("att-b", "second.png"),
        ]
    );
}

#[test]
fn a_reply_with_an_unknown_image_id_is_refused() {
    let body = "Intro\n\n![other.png](qa-scribe-attachment://att-x)";
    assert!(rewrite(RefinementRecordKind::Finding, body).is_err());
    assert!(rewrite(RefinementRecordKind::TestCasesDraft, body).is_err());
}
