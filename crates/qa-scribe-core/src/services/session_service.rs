use chrono::{SecondsFormat, Utc};
use rusqlite::{OptionalExtension, params};
use uuid::Uuid;

use crate::{
    QaScribeError, Result,
    domain::{
        AiRun, AiRunCreate, AppSettings, Attachment, AttachmentDraft, DRAFT_BODY_MAX_LENGTH, Draft,
        DraftCreate, DraftPatch, Entry, EntryDraft, EntryPatch, EvidenceLink, EvidenceLinkDraft,
        Finding, FindingDraft, GenerationContext, Session, SessionDraft, SessionPatch,
        TEXT_BODY_MAX_LENGTH, validate_metadata_json, validate_optional_text,
        validate_required_text,
    },
    error::validation,
    storage::Database,
};

use super::session_rows::{
    map_ai_run, map_attachment, map_draft, map_entry, map_evidence_link, map_finding, map_session,
};

const APPLICATION_SETTINGS_KEY: &str = "application";

pub struct SessionService {
    database: Database,
}

impl SessionService {
    pub fn new(database: Database) -> Self {
        Self { database }
    }

    pub fn in_memory() -> Result<Self> {
        Ok(Self::new(Database::in_memory()?))
    }

    pub fn database(&self) -> &Database {
        &self.database
    }

    pub fn get_settings(&self) -> Result<AppSettings> {
        let value_json: Option<String> = self
            .database
            .connection()
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = ?1",
                [APPLICATION_SETTINGS_KEY],
                |row| row.get(0),
            )
            .optional()?;

        match value_json {
            Some(value) => serde_json::from_str(&value)
                .map_err(|_| validation("stored app settings are invalid")),
            None => Ok(AppSettings::default()),
        }
    }

    pub fn update_settings(&self, settings: AppSettings) -> Result<AppSettings> {
        if settings.schema_version != 1 {
            return Err(validation("unsupported app settings schema version"));
        }
        let prompt = validate_required_text(
            "generation system prompt",
            &settings.generation_system_prompt,
            8_000,
        )?;
        let model = validate_required_text("selected AI model", &settings.selected_ai_model, 240)?;
        let testware_template =
            validate_required_text("testware template", &settings.testware_template, 12_000)?;
        let finding_template =
            validate_required_text("finding template", &settings.finding_template, 12_000)?;
        let note_summary_template = validate_required_text(
            "note summary template",
            &settings.note_summary_template,
            12_000,
        )?;
        let next = AppSettings {
            generation_system_prompt: prompt,
            selected_ai_model: model,
            testware_template,
            finding_template,
            note_summary_template,
            ..settings
        };
        let now = now();
        let value_json = serde_json::to_string(&next)
            .map_err(|_| validation("app settings could not serialize"))?;

        self.database.connection().execute(
            "INSERT INTO app_settings (key, value_json, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
            params![APPLICATION_SETTINGS_KEY, value_json, now],
        )?;

        Ok(next)
    }

    pub fn create_session(&self, draft: SessionDraft) -> Result<Session> {
        let id = new_id();
        let now = now();
        let title = validate_required_text("Session title", &draft.title, 160)?;
        let session_context =
            validate_optional_text("Session Context", draft.session_context, 2_000)?;
        let objective_notes =
            validate_optional_text("Objective Notes", draft.objective_notes, 2_000)?;
        let environment = validate_optional_text("environment", draft.environment, 240)?;
        let build_version = validate_optional_text("build/version", draft.build_version, 120)?;
        let related_reference =
            validate_optional_text("related reference", draft.related_reference, 500)?;

        self.database.connection().execute(
            "INSERT INTO sessions (
                id, title, session_context, objective_notes, environment, build_version,
                related_reference, created_at, updated_at, last_opened_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?8)",
            params![
                id,
                title,
                session_context,
                objective_notes,
                environment,
                build_version,
                related_reference,
                now
            ],
        )?;

        self.get_session(&id)?.ok_or(QaScribeError::NotFound(id))
    }

    pub fn list_sessions(&self) -> Result<Vec<Session>> {
        let mut statement = self.database.connection().prepare(
            "SELECT id, title, session_context, objective_notes, environment, build_version,
                related_reference, created_at, updated_at, last_opened_at
             FROM sessions
             ORDER BY last_opened_at DESC",
        )?;
        let sessions = statement
            .query_map([], map_session)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(sessions)
    }

    pub fn get_session(&self, id: &str) -> Result<Option<Session>> {
        self.database
            .connection()
            .query_row(
                "SELECT id, title, session_context, objective_notes, environment, build_version,
                    related_reference, created_at, updated_at, last_opened_at
                 FROM sessions
                 WHERE id = ?1",
                [id],
                map_session,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn reopen_session(&self, id: &str) -> Result<Session> {
        let now = now();
        let changed = self.database.connection().execute(
            "UPDATE sessions SET last_opened_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        if changed == 0 {
            return Err(QaScribeError::NotFound(id.to_string()));
        }
        self.get_session(id)?
            .ok_or(QaScribeError::NotFound(id.to_string()))
    }

    pub fn update_session(&self, id: &str, patch: SessionPatch) -> Result<Session> {
        let previous = self
            .get_session(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))?;
        let now = now();
        let title = match patch.title {
            Some(title) => validate_required_text("Session title", &title, 160)?,
            None => previous.title,
        };
        let session_context = patch.session_context.unwrap_or(previous.session_context);
        let objective_notes = patch.objective_notes.unwrap_or(previous.objective_notes);
        let environment = patch.environment.unwrap_or(previous.environment);
        let build_version = patch.build_version.unwrap_or(previous.build_version);
        let related_reference = patch
            .related_reference
            .unwrap_or(previous.related_reference);

        self.database.connection().execute(
            "UPDATE sessions SET
                title = ?1,
                session_context = ?2,
                objective_notes = ?3,
                environment = ?4,
                build_version = ?5,
                related_reference = ?6,
                updated_at = ?7
             WHERE id = ?8",
            params![
                title,
                validate_optional_text("Session Context", session_context, 2_000)?,
                validate_optional_text("Objective Notes", objective_notes, 2_000)?,
                validate_optional_text("environment", environment, 240)?,
                validate_optional_text("build/version", build_version, 120)?,
                validate_optional_text("related reference", related_reference, 500)?,
                now,
                id
            ],
        )?;

        self.get_session(id)?
            .ok_or(QaScribeError::NotFound(id.to_string()))
    }

    pub fn delete_session(&self, id: &str) -> Result<()> {
        let changed = self
            .database
            .connection()
            .execute("DELETE FROM sessions WHERE id = ?1", [id])?;
        if changed == 0 {
            return Err(QaScribeError::NotFound(id.to_string()));
        }
        Ok(())
    }

    pub fn create_entry(&self, draft: EntryDraft) -> Result<Entry> {
        let id = new_id();
        let now = now();
        let body = validate_required_text("Entry body", &draft.body, TEXT_BODY_MAX_LENGTH)?;
        let title = validate_optional_text("Entry title", draft.title, 160)?;
        let metadata_json = validate_metadata_json(draft.metadata_json)?;

        self.database.connection().execute(
            "INSERT INTO entries (
                id, session_id, type, title, body, metadata_json, excluded_from_generation, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![
                id,
                draft.session_id,
                draft.entry_type.as_str(),
                title,
                body,
                metadata_json,
                draft.excluded_from_generation,
                now
            ],
        )?;

        self.entry(&id)?.ok_or(QaScribeError::NotFound(id))
    }

    pub fn list_entries(&self, session_id: &str) -> Result<Vec<Entry>> {
        require_session(self.database.connection(), session_id)?;
        let mut statement = self.database.connection().prepare(
            "SELECT id, session_id, type, title, body, metadata_json, excluded_from_generation, created_at, updated_at
             FROM entries
             WHERE session_id = ?1
             ORDER BY created_at ASC",
        )?;
        let entries = statement
            .query_map([session_id], map_entry)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    pub fn update_entry(&self, id: &str, patch: EntryPatch) -> Result<Entry> {
        let existing = self
            .entry(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))?;
        let title = match patch.title {
            Some(title) => validate_optional_text("Entry title", title, 160)?,
            None => existing.title,
        };
        let body = match patch.body {
            Some(body) => validate_required_text("Entry body", &body, TEXT_BODY_MAX_LENGTH)?,
            None => existing.body,
        };
        let metadata_json = match patch.metadata_json {
            Some(metadata_json) => validate_metadata_json(metadata_json)?,
            None => existing.metadata_json,
        };
        let excluded = patch
            .excluded_from_generation
            .unwrap_or(existing.excluded_from_generation);
        let now = now();
        self.database.connection().execute(
            "UPDATE entries
             SET title = ?1, body = ?2, metadata_json = ?3, excluded_from_generation = ?4, updated_at = ?5
             WHERE id = ?6",
            params![title, body, metadata_json, excluded, now, id],
        )?;
        self.entry(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))
    }

    pub fn create_attachment(&self, draft: AttachmentDraft) -> Result<Attachment> {
        require_session(self.database.connection(), &draft.session_id)?;
        if let Some(entry_id) = &draft.entry_id {
            let entry_session_id: String = self.database.connection().query_row(
                "SELECT session_id FROM entries WHERE id = ?1",
                [entry_id],
                |row| row.get(0),
            )?;
            if entry_session_id != draft.session_id {
                return Err(validation("Attachment Entry must belong to the Session"));
            }
        }

        let id = new_id();
        let now = now();
        let filename = validate_required_text("attachment filename", &draft.filename, 240)?;
        let mime_type = validate_optional_text("attachment MIME type", draft.mime_type, 120)?;
        let sha256 = validate_required_text("attachment SHA-256", &draft.sha256, 64)?;
        let relative_path =
            validate_required_text("attachment relative path", &draft.relative_path, 600)?;
        if draft.size_bytes < 0 {
            return Err(validation("attachment size must not be negative"));
        }

        self.database.connection().execute(
            "INSERT INTO attachments (
                id, session_id, entry_id, filename, mime_type, size_bytes, sha256, relative_path, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                draft.session_id,
                draft.entry_id,
                filename,
                mime_type,
                draft.size_bytes,
                sha256,
                relative_path,
                now
            ],
        )?;

        self.get_attachment(&id)?.ok_or(QaScribeError::NotFound(id))
    }

    pub fn list_attachments(&self, session_id: &str) -> Result<Vec<Attachment>> {
        require_session(self.database.connection(), session_id)?;
        let mut statement = self.database.connection().prepare(
            "SELECT id, session_id, entry_id, filename, mime_type, size_bytes, sha256, relative_path, created_at
             FROM attachments
             WHERE session_id = ?1
             ORDER BY created_at DESC",
        )?;
        let attachments = statement
            .query_map([session_id], map_attachment)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(attachments)
    }

    pub fn get_attachment(&self, id: &str) -> Result<Option<Attachment>> {
        self.database
            .connection()
            .query_row(
                "SELECT id, session_id, entry_id, filename, mime_type, size_bytes, sha256, relative_path, created_at
                 FROM attachments
                 WHERE id = ?1",
                [id],
                map_attachment,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn create_finding(&self, draft: FindingDraft) -> Result<Finding> {
        let id = new_id();
        let now = now();
        let title = validate_required_text("Finding title", &draft.title, 160)?;
        let body = validate_required_text("Finding body", &draft.body, TEXT_BODY_MAX_LENGTH)?;
        let metadata_json = validate_metadata_json(draft.metadata_json)?;

        self.database.connection().execute(
            "INSERT INTO findings (id, session_id, title, body, kind, metadata_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![id, draft.session_id, title, body, draft.kind.as_str(), metadata_json, now],
        )?;

        self.finding(&id)?.ok_or(QaScribeError::NotFound(id))
    }

    pub fn list_findings(&self, session_id: &str) -> Result<Vec<Finding>> {
        require_session(self.database.connection(), session_id)?;
        let mut statement = self.database.connection().prepare(
            "SELECT id, session_id, title, body, kind, metadata_json, created_at, updated_at
             FROM findings
             WHERE session_id = ?1
             ORDER BY created_at DESC",
        )?;
        let findings = statement
            .query_map([session_id], map_finding)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(findings)
    }

    pub fn create_evidence_link(&self, draft: EvidenceLinkDraft) -> Result<EvidenceLink> {
        if draft.entry_id.is_none() && draft.attachment_id.is_none() {
            return Err(validation(
                "Evidence link requires an Entry or managed attachment reference",
            ));
        }

        let finding_session_id: String = self.database.connection().query_row(
            "SELECT session_id FROM findings WHERE id = ?1",
            [&draft.finding_id],
            |row| row.get(0),
        )?;

        if let Some(entry_id) = &draft.entry_id {
            let entry_session_id: String = self.database.connection().query_row(
                "SELECT session_id FROM entries WHERE id = ?1",
                [entry_id],
                |row| row.get(0),
            )?;
            if entry_session_id != finding_session_id {
                return Err(validation(
                    "Evidence link Entry must belong to the Finding Session",
                ));
            }
        }

        if let Some(attachment_id) = &draft.attachment_id {
            let attachment_session_id: String = self.database.connection().query_row(
                "SELECT session_id FROM attachments WHERE id = ?1",
                [attachment_id],
                |row| row.get(0),
            )?;
            if attachment_session_id != finding_session_id {
                return Err(validation(
                    "Evidence link attachment reference must belong to the Finding Session",
                ));
            }
        }

        let id = new_id();
        let now = now();
        self.database.connection().execute(
            "INSERT INTO evidence_links (id, finding_id, entry_id, attachment_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id,
                draft.finding_id,
                draft.entry_id,
                draft.attachment_id,
                now
            ],
        )?;

        self.evidence_link(&id)?.ok_or(QaScribeError::NotFound(id))
    }

    pub fn list_evidence_links(&self, session_id: &str) -> Result<Vec<EvidenceLink>> {
        require_session(self.database.connection(), session_id)?;
        let mut statement = self.database.connection().prepare(
            "SELECT evidence_links.id, evidence_links.finding_id, evidence_links.entry_id,
                    evidence_links.attachment_id, evidence_links.created_at
             FROM evidence_links
             INNER JOIN findings ON findings.id = evidence_links.finding_id
             WHERE findings.session_id = ?1
             ORDER BY evidence_links.created_at ASC",
        )?;
        let links = statement
            .query_map([session_id], map_evidence_link)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(links)
    }

    pub fn create_generation_context(&self, session_id: &str) -> Result<GenerationContext> {
        require_session(self.database.connection(), session_id)?;
        let context_id = new_id();
        let now = now();
        self.database.connection().execute(
            "INSERT INTO generation_contexts (id, session_id, created_at) VALUES (?1, ?2, ?3)",
            params![context_id, session_id, now],
        )?;

        let mut statement = self.database.connection().prepare(
            "SELECT id FROM entries
                 WHERE session_id = ?1 AND excluded_from_generation = 0
                 ORDER BY created_at ASC",
        )?;
        let entry_ids = statement
            .query_map([session_id], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for entry_id in entry_ids {
            self.database.connection().execute(
                "INSERT INTO generation_context_entries (id, generation_context_id, entry_id, included)
                 VALUES (?1, ?2, ?3, 1)",
                params![new_id(), context_id, entry_id],
            )?;
        }

        let mut statement = self
            .database
            .connection()
            .prepare("SELECT id FROM attachments WHERE session_id = ?1 ORDER BY created_at ASC")?;
        let attachment_ids = statement
            .query_map([session_id], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for attachment_id in attachment_ids {
            self.database.connection().execute(
                "INSERT INTO generation_context_attachments (id, generation_context_id, attachment_id, included)
                 VALUES (?1, ?2, ?3, 1)",
                params![new_id(), context_id, attachment_id],
            )?;
        }

        Ok(GenerationContext {
            id: context_id,
            session_id: session_id.to_string(),
            created_at: now,
        })
    }

    pub fn create_ai_run(&self, draft: AiRunCreate) -> Result<AiRun> {
        require_session(self.database.connection(), &draft.session_id)?;
        if let Some(context_id) = &draft.generation_context_id {
            let context_session_id: String = self.database.connection().query_row(
                "SELECT session_id FROM generation_contexts WHERE id = ?1",
                [context_id],
                |row| row.get(0),
            )?;
            if context_session_id != draft.session_id {
                return Err(validation(
                    "AI Run Generation Context must belong to the Session",
                ));
            }
        }
        let model = validate_required_text("AI model", &draft.model, 240)?;
        let prompt_version = validate_required_text("prompt version", &draft.prompt_version, 80)?;
        let reasoning_effort =
            validate_optional_text("reasoning effort", draft.reasoning_effort, 40)?;
        let id = new_id();
        let now = now();

        self.database.connection().execute(
            "INSERT INTO ai_runs (
                id, session_id, generation_context_id, provider, model, reasoning_effort,
                prompt_version, status, error_message, created_at, completed_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running', NULL, ?8, NULL)",
            params![
                id,
                draft.session_id,
                draft.generation_context_id,
                draft.provider.as_str(),
                model,
                reasoning_effort,
                prompt_version,
                now
            ],
        )?;

        self.ai_run(&id)?.ok_or(QaScribeError::NotFound(id))
    }

    pub fn complete_ai_run(&self, id: &str) -> Result<AiRun> {
        let now = now();
        self.database.connection().execute(
            "UPDATE ai_runs
             SET status = 'completed', error_message = NULL, completed_at = ?1
             WHERE id = ?2",
            params![now, id],
        )?;
        self.ai_run(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))
    }

    pub fn fail_ai_run(&self, id: &str, message: &str) -> Result<AiRun> {
        let now = now();
        let error_message = validate_required_text("AI Run error", message, 2_000)?;
        self.database.connection().execute(
            "UPDATE ai_runs
             SET status = 'failed', error_message = ?1, completed_at = ?2
             WHERE id = ?3",
            params![error_message, now, id],
        )?;
        self.ai_run(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))
    }

    pub fn create_draft(&self, draft: DraftCreate) -> Result<Draft> {
        require_session(self.database.connection(), &draft.session_id)?;
        if let Some(ai_run_id) = &draft.ai_run_id {
            let ai_run_session_id: String = self.database.connection().query_row(
                "SELECT session_id FROM ai_runs WHERE id = ?1",
                [ai_run_id],
                |row| row.get(0),
            )?;
            if ai_run_session_id != draft.session_id {
                return Err(validation("Draft AI Run must belong to the Session"));
            }
        }
        let id = new_id();
        let now = now();
        let title = validate_required_text("Draft title", &draft.title, 160)?;
        let body = validate_required_text("Draft body", &draft.body, DRAFT_BODY_MAX_LENGTH)?;

        self.database.connection().execute(
            "INSERT INTO drafts (id, session_id, ai_run_id, kind, title, body, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![id, draft.session_id, draft.ai_run_id, draft.kind.as_str(), title, body, now],
        )?;

        self.draft(&id)?.ok_or(QaScribeError::NotFound(id))
    }

    pub fn list_drafts(&self, session_id: &str) -> Result<Vec<Draft>> {
        require_session(self.database.connection(), session_id)?;
        let mut statement = self.database.connection().prepare(
            "SELECT id, session_id, ai_run_id, kind, title, body, created_at, updated_at
             FROM drafts
             WHERE session_id = ?1
             ORDER BY updated_at DESC, created_at DESC",
        )?;
        let drafts = statement
            .query_map([session_id], map_draft)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(drafts)
    }

    pub fn update_draft(&self, id: &str, patch: DraftPatch) -> Result<Draft> {
        let existing = self
            .draft(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))?;
        let title = match patch.title {
            Some(title) => validate_required_text("Draft title", &title, 160)?,
            None => existing.title,
        };
        let body = match patch.body {
            Some(body) => validate_required_text("Draft body", &body, DRAFT_BODY_MAX_LENGTH)?,
            None => existing.body,
        };
        let now = now();

        self.database.connection().execute(
            "UPDATE drafts
             SET title = ?1, body = ?2, updated_at = ?3
             WHERE id = ?4",
            params![title, body, now, id],
        )?;

        self.draft(id)?
            .ok_or_else(|| QaScribeError::NotFound(id.to_string()))
    }

    fn entry(&self, id: &str) -> Result<Option<Entry>> {
        self.database
            .connection()
            .query_row(
                "SELECT id, session_id, type, title, body, metadata_json, excluded_from_generation, created_at, updated_at
                 FROM entries
                 WHERE id = ?1",
                [id],
                map_entry,
            )
            .optional()
            .map_err(Into::into)
    }

    fn finding(&self, id: &str) -> Result<Option<Finding>> {
        self.database
            .connection()
            .query_row(
                "SELECT id, session_id, title, body, kind, metadata_json, created_at, updated_at
                 FROM findings
                 WHERE id = ?1",
                [id],
                map_finding,
            )
            .optional()
            .map_err(Into::into)
    }

    fn evidence_link(&self, id: &str) -> Result<Option<EvidenceLink>> {
        self.database
            .connection()
            .query_row(
                "SELECT id, finding_id, entry_id, attachment_id, created_at
                 FROM evidence_links
                 WHERE id = ?1",
                [id],
                map_evidence_link,
            )
            .optional()
            .map_err(Into::into)
    }

    fn ai_run(&self, id: &str) -> Result<Option<AiRun>> {
        self.database
            .connection()
            .query_row(
                "SELECT id, session_id, generation_context_id, provider, model, reasoning_effort,
                    prompt_version, status, error_message, created_at, completed_at
                 FROM ai_runs
                 WHERE id = ?1",
                [id],
                map_ai_run,
            )
            .optional()
            .map_err(Into::into)
    }

    fn draft(&self, id: &str) -> Result<Option<Draft>> {
        self.database
            .connection()
            .query_row(
                "SELECT id, session_id, ai_run_id, kind, title, body, created_at, updated_at
                 FROM drafts
                 WHERE id = ?1",
                [id],
                map_draft,
            )
            .optional()
            .map_err(Into::into)
    }
}

fn require_session(connection: &rusqlite::Connection, session_id: &str) -> Result<()> {
    let exists: Option<String> = connection
        .query_row(
            "SELECT id FROM sessions WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .optional()?;
    exists
        .map(|_| ())
        .ok_or_else(|| QaScribeError::NotFound(session_id.to_string()))
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
