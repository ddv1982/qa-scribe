use super::*;

pub enum Record {
    Finding(Finding),
    TestCases(Draft),
}

impl Record {
    pub fn create(service: &SessionService, session_id: &str, kind: Kind) -> Self {
        match kind {
            Kind::Finding => Self::Finding(
                service
                    .create_finding(FindingDraft {
                        session_id: session_id.into(),
                        title: "Saved Finding".into(),
                        body: "Saved evidence".into(),
                        body_json: None,
                        body_format: None,
                        kind: FindingKind::Bug,
                        metadata_json: None,
                    })
                    .unwrap(),
            ),
            Kind::TestCases => Self::TestCases(
                service
                    .create_draft(DraftCreate {
                        session_id: session_id.into(),
                        title: "Saved Test cases".into(),
                        body: "Saved evidence".into(),
                        body_json: None,
                        body_format: None,
                        kind: DraftKind::Testware,
                        metadata_json: None,
                        ai_run_id: None,
                    })
                    .unwrap(),
            ),
        }
    }

    pub fn target(&self) -> ChatTarget {
        let (session_id, record_id, record_kind) = match self {
            Self::Finding(r) => (&r.session_id, &r.id, "bug"),
            Self::TestCases(r) => (&r.session_id, &r.id, "testware"),
        };
        let snapshot = RecordContextSnapshot {
            session_id: session_id.clone(), record_id: record_id.clone(), title: "Pinned unsaved title".into(),
            document_json: json!({"schemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Pinned unsaved evidence"}]}]}}).to_string(),
            metadata_json: Some("{\"synthetic\":true}".into()), record_kind: record_kind.into(),
            origin: RecordSnapshotOrigin::UnsavedEditor, local_fingerprint: String::new(), stored_base_token: String::new(),
        };
        match self {
            Self::Finding(_) => ChatTarget::Finding { snapshot },
            Self::TestCases(_) => ChatTarget::TestCasesDraft { snapshot },
        }
    }

    pub fn delete(&self, service: &SessionService) {
        match self {
            Self::Finding(r) => service.delete_finding(&r.id),
            Self::TestCases(r) => service.delete_draft(&r.id),
        }
        .unwrap();
    }

    pub fn assert_absent(&self, service: &SessionService) {
        let (table, id) = self.row();
        let count: i64 = service
            .database()
            .connection()
            .query_row(
                &format!("SELECT count(*) FROM {table} WHERE id = ?1"),
                [id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    pub fn row(&self) -> (&str, &str) {
        match self {
            Self::Finding(r) => ("findings", &r.id),
            Self::TestCases(r) => ("drafts", &r.id),
        }
    }

    pub fn save(&self, service: &SessionService) -> qa_scribe_core::Result<()> {
        match self {
            Self::Finding(r) => service
                .update_finding(
                    &r.id,
                    FindingPatch {
                        title: Some("Must not recreate".into()),
                        ..Default::default()
                    },
                    RecordWriteGuard::finding(r),
                )
                .map(|_| ()),
            Self::TestCases(r) => service
                .update_draft(
                    &r.id,
                    DraftPatch {
                        title: Some("Must not recreate".into()),
                        ..Default::default()
                    },
                    RecordWriteGuard::draft(r),
                )
                .map(|_| ()),
        }
    }
}
