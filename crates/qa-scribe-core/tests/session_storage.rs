use qa_scribe_core::{
    QaScribeError,
    attachments::{
        attachment_file_bytes, attachment_preview_data_url, delete_session_attachment_files,
        delete_session_with_attachment_files, import_clipboard_screenshot_data_url,
        import_managed_attachment, reconcile_attachment_files,
    },
    domain::{
        AiProvider, AiRunCreate, AppSettings, DraftCreate, DraftKind, DraftPatch, EntryDraft,
        EntryPatch, EntryType, EvidenceLinkDraft, FindingDraft, FindingKind, FindingPatch,
        SessionDraft, SessionPatch, default_generation_system_prompt,
        legacy_testware_generation_system_prompt,
    },
    export::{ExportFormat, export_session},
    services::SessionService,
    storage::{Database, SCHEMA_VERSION},
};
use std::fs;

#[path = "session_storage/helpers.rs"]
mod helpers;

use helpers::{assert_no_foreign_key_violations, count_rows, unique_temp_dir};

include!("session_storage/lifecycle_and_validation.rs");
include!("session_storage/generation_and_relationships.rs");
include!("session_storage/migrations.rs");
include!("session_storage/migrations_indices.rs");
include!("session_storage/attachments.rs");
include!("session_storage/ai_run_lifecycle.rs");
include!("session_storage/not_found_references.rs");
