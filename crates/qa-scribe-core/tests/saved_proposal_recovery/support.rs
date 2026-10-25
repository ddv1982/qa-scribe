use qa_scribe_core::{QaScribeError, Result, domain::*, services::SessionService};
use serde::Serialize;
use serde_json::{Value, json};

#[derive(Clone, Copy, Debug)]
pub(super) enum Kind {
    Finding,
    TestCases,
}

impl Kind {
    fn target(self) -> &'static str {
        match self {
            Self::Finding => "finding",
            Self::TestCases => "test_cases_draft",
        }
    }

    fn record_kind(self) -> &'static str {
        match self {
            Self::Finding => "bug",
            Self::TestCases => "testware",
        }
    }

    pub(super) fn create(self, service: &SessionService, session_id: &str) -> Value {
        let mut input = original_content();
        input["sessionId"] = json!(session_id);
        input["kind"] = json!(self.record_kind());
        match self {
            Self::Finding => serde_json::to_value(
                service
                    .create_finding(serde_json::from_value(input).unwrap())
                    .unwrap(),
            )
            .unwrap(),
            Self::TestCases => serde_json::to_value(
                service
                    .create_draft(serde_json::from_value(input).unwrap())
                    .unwrap(),
            )
            .unwrap(),
        }
    }

    pub(super) fn guard(self, record: &Value) -> RecordWriteGuard {
        match self {
            Self::Finding => {
                RecordWriteGuard::finding(&serde_json::from_value(record.clone()).unwrap())
            }
            Self::TestCases => {
                RecordWriteGuard::draft(&serde_json::from_value(record.clone()).unwrap())
            }
        }
    }

    pub(super) fn write(
        self,
        service: &SessionService,
        record: &Value,
        patch: Value,
        guard: RecordWriteGuard,
    ) -> Result<RecordWriteOutcome<Value>> {
        let id = record["id"].as_str().unwrap();
        match self {
            Self::Finding => service
                .update_finding(id, serde_json::from_value(patch).unwrap(), guard)
                .map(encoded_outcome),
            Self::TestCases => service
                .update_draft(id, serde_json::from_value(patch).unwrap(), guard)
                .map(encoded_outcome),
        }
    }

    pub(super) fn read(self, service: &SessionService, record: &Value) -> Value {
        let session = record["sessionId"].as_str().unwrap();
        let records = match self {
            Self::Finding => serde_json::to_value(service.list_findings(session).unwrap()).unwrap(),
            Self::TestCases => serde_json::to_value(service.list_drafts(session).unwrap()).unwrap(),
        };
        records
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["id"] == record["id"])
            .unwrap()
            .clone()
    }
}

fn encoded_outcome<T: Serialize>(outcome: RecordWriteOutcome<T>) -> RecordWriteOutcome<Value> {
    match outcome {
        RecordWriteOutcome::Saved { record } => RecordWriteOutcome::Saved {
            record: serde_json::to_value(record).unwrap(),
        },
        RecordWriteOutcome::Conflict { current } => RecordWriteOutcome::Conflict {
            current: serde_json::to_value(current).unwrap(),
        },
    }
}

fn scope(chat: &ChatState) -> ChatRevision {
    ChatRevision {
        session_id: chat.session_id.clone(),
        draft_id: chat.draft_id.clone(),
        expected_revision: chat.revision,
    }
}

fn document(text: &str) -> String {
    json!({"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":text}]},{"type":"image","attrs":{"src":"qa-scribe-attachment://retained-image","attachmentId":"retained-image","alt":"Retained evidence"}}]}}).to_string()
}

pub(super) fn content(title: &str, text: &str, metadata: &str) -> Value {
    json!({"title":title,"body":format!("<p>{text}</p><img src=\"qa-scribe-attachment://retained-image\" alt=\"Retained evidence\">"),"bodyJson":document(text),"bodyFormat":"tiptap_json","metadataJson":metadata})
}

pub(super) fn original_content() -> Value {
    content(
        "Original A",
        "Original body A",
        "{\"private\":true,\"source\":\"A\"}",
    )
}

pub(super) fn assert_content(row: &Value, expected: &Value, kind: Kind) {
    for field in ["title", "body", "bodyJson", "bodyFormat", "metadataJson"] {
        assert_eq!(row[field], expected[field], "{kind:?} {field}");
    }
    assert_eq!(row["kind"], kind.record_kind());
}

pub(super) struct Fixture {
    pub(super) service: SessionService,
    kind: Kind,
    pub(super) original: Value,
    pub(super) chat: ChatState,
    pub(super) guard: RecordWriteGuard,
}

impl Fixture {
    pub(super) fn new(kind: Kind) -> Self {
        let service = SessionService::in_memory().unwrap();
        let session = service
            .create_session(SessionDraft {
                title: "Saved Proposal recovery".into(),
                ..Default::default()
            })
            .unwrap();
        let original = kind.create(&service, &session.id);
        assert_content(&original, &original_content(), kind);
        let chat = service.load_chat(&session.id).unwrap();
        let chat = service
            .save_chat_composer(ChatComposerRequest {
                scope: scope(&chat),
                composer: "Refine".into(),
                mode: ChatMode::Chat,
                attachment_ids: vec![],
            })
            .unwrap();
        let target = serde_json::from_value(json!({"kind":kind.target(),"snapshot":{"sessionId":session.id,"recordId":original["id"],"title":"Original A","documentJson":document("Original body A"),"metadataJson":original["metadataJson"],"recordKind":kind.record_kind(),"origin":"saved","localFingerprint":"","storedBaseToken":""}})).unwrap();
        let started = service
            .start_chat_turn_with_response(
                ChatStartRequest {
                    scope: scope(&chat),
                },
                target,
                ChatRequestIntent::RefineRecord,
            )
            .unwrap();
        let contract = service
            .response_contract(&started.chat.messages[0].id)
            .unwrap()
            .unwrap();
        let chat = service.finish_chat_turn(ChatFinishRequest { scope:scope(&started.chat), turn_id:started.turn_id, assistant_text:json!({"version":contract.version(),"requestId":contract.request_id(),"markdown":"Suggested clearer result.","refinement":{"kind":kind.target(),"title":"Refined title","bodyMarkdown":"Refined result"}}).to_string() }).unwrap();
        let chat = service
            .resolve_refinement(RefinementRequest {
                scope: scope(&chat),
                proposal_id: chat.proposals[0].id.clone(),
                action: RefinementAction::Stage,
            })
            .unwrap();
        let mut guard = kind.guard(&original);
        guard.origin = match &chat.proposals[0].state {
            RefinementState::Staged { stage } => RecordWriteOrigin::Proposal {
                stage_id: stage.id.clone(),
            },
            state => panic!("expected Staged, got {state:?}"),
        };
        Self {
            service,
            kind,
            original,
            chat,
            guard,
        }
    }

    pub(super) fn save(&self, patch: Value, guard: RecordWriteGuard) -> Value {
        self.kind
            .write(&self.service, &self.original, patch, guard)
            .unwrap()
            .into_saved()
            .unwrap()
    }

    pub(super) fn saved_chat(&self) -> ChatState {
        self.service.load_chat(&self.chat.session_id).unwrap()
    }

    pub(super) fn freeze(&self, archive: bool) -> Option<ChatSubmissionReceipt> {
        let chat = self.saved_chat();
        if archive {
            let next = self
                .service
                .restart_chat(ChatRestartRequest {
                    scope: scope(&chat),
                })
                .unwrap();
            assert_ne!(next.draft_id, chat.draft_id);
            None
        } else {
            let note = self
                .service
                .get_or_create_note_entry(&chat.session_id)
                .unwrap();
            Some(
                self.service
                    .submit_chat(ChatSubmitRequest {
                        scope: scope(&chat),
                        note_id: note.id,
                        expected_note_body: note.body,
                        expected_note_body_json: note.body_json,
                        expected_note_body_format: note.body_format,
                    })
                    .unwrap(),
            )
        }
    }

    pub(super) fn history(&self) -> Value {
        let connection = self.service.database().connection();
        let mut history = serde_json::Map::new();
        for table in [
            "chat_drafts",
            "chat_refinements",
            "chat_editor_stages",
            "chat_messages",
            "chat_message_contexts",
            "chat_response_contracts",
            "chat_response_messages",
            "chat_answers",
            "entries",
        ] {
            let mut statement = connection
                .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
                .unwrap();
            let columns = statement.column_count();
            let rows: Vec<Vec<String>> = statement
                .query_map([], |row| {
                    (0..columns)
                        .map(|column| row.get_ref(column).map(|value| format!("{value:?}")))
                        .collect()
                })
                .unwrap()
                .map(|row| row.unwrap())
                .collect();
            history.insert(table.into(), json!(rows));
        }
        Value::Object(history)
    }

    pub(super) fn forbid_history_writes(&self) {
        for table in [
            "chat_drafts",
            "chat_refinements",
            "chat_editor_stages",
            "chat_messages",
            "entries",
        ] {
            for operation in ["INSERT", "UPDATE", "DELETE"] {
                self.service.database().connection().execute_batch(&format!("CREATE TRIGGER forbid_{table}_{operation} BEFORE {operation} ON {table} BEGIN SELECT RAISE(ABORT, 'Saved recovery must not write history'); END;")).unwrap();
            }
        }
    }

    pub(super) fn replace_proposal(&self, proposal: &RefinementProposal) {
        self.service
            .database()
            .connection()
            .execute(
                "UPDATE chat_refinements SET proposal_json=?1 WHERE id=?2",
                rusqlite::params![
                    serde_json::to_string(proposal).unwrap(),
                    self.chat.proposals[0].id
                ],
            )
            .unwrap();
    }

    pub(super) fn synthetic_readonly(&self, archive: bool) {
        let note = self
            .service
            .get_or_create_note_entry(&self.chat.session_id)
            .unwrap();
        self.service.database().connection().execute("UPDATE chat_drafts SET archived=?1,submitted_at=?2,submitted_note_id=?3 WHERE id=?4", rusqlite::params![archive, if archive {None} else {Some("synthetic")}, if archive {None} else {Some(note.id)}, self.chat.draft_id]).unwrap();
    }
}

pub(super) fn assert_conflict(outcome: RecordWriteOutcome<Value>, expected: &Value) {
    match outcome {
        RecordWriteOutcome::Conflict { current } => assert_eq!(&current, expected),
        RecordWriteOutcome::Saved { record } => {
            panic!("stale guard overwrote current row with {record}")
        }
    }
}

pub(super) fn assert_readonly(result: Result<RecordWriteOutcome<Value>>) {
    assert!(
        matches!(result, Err(QaScribeError::Validation(ref message)) if message == "Proposal conversation is read-only"),
        "{result:?}"
    );
}
