//! Single source of truth for the Tauri command bridge's TypeScript bindings.
//!
//! Rust owns the ~27-command surface; [`builder`] collects every command and
//! the event type carried over `start_ai_action_job`'s [`tauri::ipc::Channel`],
//! and the generated `frontend/src/bindings.ts` is what the frontend imports.
//! A renamed Rust field becomes a frontend compile error instead of a silent
//! runtime `undefined`.
//!
//! Generation runs in two places, both driving the same [`builder`]:
//! - debug startup (`main`) re-exports on every `cargo tauri dev` run, and
//! - the [`tests::bindings_are_up_to_date`] test / `bindings:generate` npm
//!   script regenerate without a GUI so CI and the frontend build can diff.

use qa_scribe_core::domain::{
    default_selected_ai_models_by_provider, default_selected_ai_reasoning_efforts_by_provider,
};
use qa_scribe_core::generation::{
    editor_html_tags, managed_attachment_protocol, self_closing_editor_html_tags,
};
use specta_typescript::Typescript;
use tauri_specta::{Builder, ErrorHandlingMode, collect_commands};

use crate::commands;

/// The Tauri Specta builder wired with every `#[tauri::command]`.
///
/// `main` uses this for the real `invoke_handler`; the bindings export (debug
/// startup and the freshness test) reuses the exact same builder so the wire
/// handler and the generated types can never drift apart.
///
/// Commands reject with [`crate::commands::CommandError`], so the generated
/// wrappers throw that structured value on failure — matching the historical
/// `invoke(...)` behaviour the frontend already handles.
///
/// Commands are referenced by their defining-module path: `collect_commands!`
/// expands to `tauri::generate_handler!`, which resolves each command's hidden
/// `__cmd__*` macro relative to that path, and those macros are not carried by
/// the `pub use` re-exports in `commands.rs`.
pub fn builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        // Commands reject with `CommandError`; `Throw` makes the generated
        // wrappers throw it (like the old `invoke(...)`) rather than returning
        // a `Result` enum, keeping the frontend's error handling unchanged.
        .error_handling(ErrorHandlingMode::Throw)
        // `Attachment.size_bytes` is an `i64`; specta forbids i64 by default to
        // flag BigInt precision loss. The existing wire contract already
        // serializes it as a JSON `number` (`sizeBytes: number`), and a file's
        // byte size never approaches 2^53, so cast to `number` to DESCRIBE the
        // current format rather than change it.
        .dangerously_cast_bigints_to_number()
        .commands(collect_commands![
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::sessions::list_sessions,
            commands::sessions::list_recent_sessions,
            commands::sessions::create_session,
            commands::sessions::reopen_session,
            commands::sessions::open_session_note_state,
            commands::sessions::update_session,
            commands::sessions::delete_session,
            commands::entries::create_entry,
            commands::entries::list_entries,
            commands::entries::update_entry,
            commands::findings::create_finding,
            commands::findings::list_findings,
            commands::findings::list_finding_library,
            commands::findings::update_finding,
            commands::generation::create_draft,
            commands::generation::list_drafts,
            commands::generation::list_draft_library,
            commands::generation::update_draft,
            commands::generation::delete_draft,
            commands::findings::delete_finding,
            commands::ai::job_runner::start_ai_action_job,
            commands::ai::job_runner::get_ai_action_job_status,
            commands::ai::job_runner::list_active_ai_action_jobs,
            commands::ai::job_runner::cancel_ai_action_job,
            commands::files::import_clipboard_screenshot,
            commands::providers::get_provider_status,
            commands::providers::refresh_provider_status,
            commands::files::get_attachment_preview_data_url,
            commands::files::read_clipboard_image_data_url,
            commands::files::copy_attachment_image_to_clipboard,
            commands::files::copy_html_to_clipboard,
        ])
        // Single-source the provider defaults: core owns these maps and they
        // reach the frontend as typed constants instead of a duplicated
        // `frontend/src/settings/defaults.ts` copy that could silently drift.
        .constant(
            "PROVIDER_MODEL_DEFAULTS",
            default_selected_ai_models_by_provider(),
        )
        .constant(
            "PROVIDER_REASONING_DEFAULTS",
            default_selected_ai_reasoning_efforts_by_provider(),
        )
        // Single-source the editor-HTML contract: core owns the managed
        // attachment protocol, the allowed-tag list, and the void/self-closing
        // subset of it, and the frontend (`editor/editorHtml.ts`) derives its
        // copies from these bindings constants instead of restating the
        // literals, so the sanitizer and the response-repair pass can never
        // silently diverge.
        .constant("MANAGED_ATTACHMENT_PROTOCOL", managed_attachment_protocol())
        .constant("EDITOR_HTML_TAGS", editor_html_tags())
        .constant(
            "SELF_CLOSING_EDITOR_HTML_TAGS",
            self_closing_editor_html_tags(),
        )
}

/// The exporter configuration used everywhere bindings are written, so the
/// debug-startup export and the freshness check produce byte-identical output.
pub fn exporter() -> Typescript {
    Typescript::default()
}

/// Path (relative to `src-tauri/`) of the committed bindings the frontend
/// imports. Kept out of any Tauri file-watch root to avoid dev rebuild loops
/// (`frontend/src` is watched only by Vite, which is fine).
pub const BINDINGS_PATH: &str = "../frontend/src/bindings.ts";

#[cfg(test)]
mod tests {
    use super::*;

    /// Non-GUI generation + drift check in one deterministic place:
    /// - `bun run bindings:generate` sets `UPDATE_BINDINGS=1`, which writes the
    ///   committed `frontend/src/bindings.ts` from the source of truth, and
    /// - `bun run bindings:check` (plain `cargo test`) regenerates to a temp
    ///   file and fails if the committed file drifted.
    ///
    /// CI and the frontend build therefore never need a GUI run to trust the
    /// bindings.
    #[test]
    fn bindings_are_up_to_date() {
        let committed_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(BINDINGS_PATH);

        if std::env::var_os("UPDATE_BINDINGS").is_some() {
            builder()
                .export(exporter(), &committed_path)
                .expect("bindings export should succeed");
            return;
        }

        let temp = std::env::temp_dir().join(format!(
            "qa-scribe-bindings-{}-{}.ts",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        ));
        builder()
            .export(exporter(), &temp)
            .expect("bindings export should succeed");
        let generated =
            std::fs::read_to_string(&temp).expect("generated bindings should be readable");
        let _ = std::fs::remove_file(&temp);

        let committed =
            std::fs::read_to_string(&committed_path).expect("committed bindings.ts should exist");

        assert_eq!(
            generated, committed,
            "frontend/src/bindings.ts is stale; run `bun run bindings:generate` and commit the result",
        );
    }
}
