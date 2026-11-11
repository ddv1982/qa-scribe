# Architecture

qa-scribe is a local-first desktop app. A tester records a Session (a Note, attachments and context), then uses a local AI CLI to turn it into Test cases, Findings and summaries. Product terms are defined in [CONTEXT.md](../CONTEXT.md).

## Layers

| Layer | Path | Owns |
| --- | --- | --- |
| Core | `crates/qa-scribe-core` | Domain types, rules, storage and AI protocols. No Tauri. Tested with `cargo test`. |
| Shell | `src-tauri` | Tauri commands, background jobs, provider processes and settings. Thin adapters over core. |
| UI | `frontend/src` | React 19 views and controller hooks. Talks to the shell only through generated bindings. |
| Native E2E | `e2e/` | WebdriverIO against the built app, with fake provider CLIs in `e2e/fixtures/bin`. |

Bindings come from Rust: `bun run bindings:generate` writes `frontend/src/bindings.ts` with tauri-specta, and `bindings:check` fails CI on drift. A change to a command or a shared type therefore starts in Rust.

## Core (`crates/qa-scribe-core/src`)

- `domain/`: plain data types shared with the UI (Session, Entry, Draft, Finding, chat types, AI runs).
- `storage/`: SQLite through rusqlite. `schema.rs` holds the schema and additive migrations. Some invariants are enforced by triggers; for example, stored chat response contracts are immutable.
- `services/session_service/`: all reads and writes. One file per concern: sessions, entries (the Note), drafts (Test cases), findings, attachments, generation, and the `chat_*` files.
- `generation/`: prompt building and output parsing for one-shot generation (Test cases, Findings, summaries).
- `chat/`: the Ask AI prompt (`mod.rs`), the bounded transcript input (`input.rs`) and the reply contract interpreter (`response.rs`).
- `ai/`: CLI executor, streaming and the chat wire protocol.
- `attachments/`: managed files on disk (ADR 0002) and chat image limits.

## Shell (`src-tauri/src`)

- `commands/`: one module per area (sessions, entries, findings, generation, chat, providers, files, settings). Each command validates its input and calls a `SessionService` method.
- `jobs/`: the in-memory job store for long AI runs. It handles cancellation, capacity (up to 3 active generations) and chat tool permission prompts.
- `provider_command/`: spawning Claude Code, Codex CLI or Copilot CLI (`AiProvider`). These are the user's own installed tools; the app holds no API keys (ADR 0004).

## UI (`frontend/src`)

- `app/`: controller hooks. `useAppController` composes the workspace hooks (session, records, generation, deletion, navigation, chat) into one object for `AppShell`.
- `views/`: presentational components (Session editor, record collections, Ask AI panel, settings).
- `editor/`: the Tiptap rich text editor, plus HTML and Markdown conversion for copy and AI.
- `styles/`: CSS by area; the color tokens are checked by `frontend/scripts/check-css-colors.mjs`.

## Ask AI (chat) lifecycle

1. Each conversation belongs to an owner: the Notes panel or one record (`ConversationOwner`). A record's Ask AI never sees another record's conversation.
2. Send runs `start_chat_job`. The shell captures a preparation snapshot: the transcript, the Session context (plus the saved Note, for Notes) and any images. It rechecks the snapshot just before the provider starts, so a change in between cancels the run instead of sending stale context.
3. Core stores a response contract for the turn: the purpose (conversation, refinement of a record kind, or Jira drafting) and the version. The reply must match it. Otherwise it is kept as text with a warning, and nothing is applied.
4. A refinement reply becomes a proposal (Offered). Apply moves it to Applied and writes the record; Undo moves it back. Note proposals also check a fingerprint of the Note, so an edit made after the suggestion is never overwritten.

## Checks

The [check inventory](check-inventory.md) maps every local command to its CI job. The quick loop is `bun run verify:fast`, `cargo test --workspace` and the native E2E (`xvfb-run -a dbus-run-session -- bun run e2e` on Linux). Files are capped at 500 lines; see [code size guidelines](code-size-guidelines.md).

Decisions are recorded in [ADRs](adr/). Finished plans live in the [archive](archive/README.md).
