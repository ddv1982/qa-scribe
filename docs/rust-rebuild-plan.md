# Rust Rebuild Plan

qa-scribe is being rebuilt as a Rust desktop application. The current Electrobun/Bun MVP remains useful product evidence, but the target implementation is a clean Rust/Tauri app with fresh storage and no existing-data migration requirement.

## Goals

- Preserve qa-scribe product language: Session, Entry, Evidence, Finding, Testware, Session Library, Session Context, Objective Notes, Session Timeline, Generation Context, Draft, AI Run, Session Report Draft, and Jira Bug Draft.
- Keep capture, persistence, manual Draft editing, attachment handling, and export local-first and usable without AI configuration.
- Keep AI generation explicit and user-triggered.
- Keep provider credentials outside qa-scribe; use already-authenticated local CLI providers where possible.
- Keep native filesystem, clipboard, provider process spawning, SQLite access, attachment storage, and export on the Rust/Tauri side.
- Use a narrow typed frontend command bridge instead of exposing raw Tauri, filesystem, database, or process primitives to React.

## Non-Goals

- Do not migrate existing Electrobun/Bun app data.
- Do not preserve Drizzle artifacts, Bun SQLite migrations, or the Electrobun app-data layout.
- Do not keep Electrobun compatibility adapters after the Rust command bridge exists.
- Do not add background AI generation or provider probing that sends Session data without a user action.
- Do not prioritize signed/notarized/APT release infrastructure before feature parity and validation are stable.

## Target Stack

The target stack follows the proven shape used by `~/projects/csv-data-anonymizer`:

- Cargo workspace at the repository root.
- `crates/qa-scribe-core` for domain types, validation, storage, attachments, export, generation prompt assembly, provider abstractions, and tests.
- `src-tauri` for Tauri 2 desktop startup, command registration, managed app state, clipboard paste import, app-data paths, export/attachment commands, and process spawning.
- `frontend` for the React, TypeScript, and Vite UI.
- Optional `crates/qa-scribe-app` CLI or smoke harness for non-GUI verification of core workflows.
- SQLite with a fresh Rust-owned schema.
- `serde` camelCase command DTOs and explicit typed wrappers in the frontend.

## Architecture Boundaries

### Core Crate

`qa-scribe-core` owns behavior that should be testable without a desktop window:

- Session Library, Session, Entry, Finding, Evidence link, Draft, Generation Context, AI Run, and app settings domain types.
- Validation rules and length limits.
- Fresh SQLite schema setup and storage repositories.
- Managed attachment path safety, hashing, metadata, cleanup, and preview limits.
- Markdown and JSON export rendering.
- Prompt construction and structured Testware parsing.
- Provider abstractions that can be tested with stub command runners.

### Tauri Shell

`src-tauri` owns native integration:

- Tauri app lifecycle, menus, windows, and app-data paths.
- Explicit command modules grouped by domain, such as settings, sessions, entries, findings, evidence, drafts, generation, attachments, export, and providers.
- Path-based attachment import, clipboard image paste import/copy helpers, export rendering, and process spawning.
- Job state for long-running generation or import/export work when synchronous commands would block the UI.
- Minimal Tauri capabilities and `withGlobalTauri: false`.

### Frontend

`frontend` owns user interaction:

- Session setup and Session Library flows.
- Session Timeline capture for Notes, Observations, API Responses, Logs, screenshots, and possible Findings.
- Inspectors and Evidence linking.
- Generation Context review.
- Draft review and editing.
- Settings for providers, prompts, and capture templates.

The frontend should call one typed bridge module rather than importing `invoke` across feature components.

## Fresh Storage Stance

The rebuild starts from a clean SQLite schema. Existing Electrobun/Bun databases are not read, transformed, or upgraded. This reduces implementation risk and lets the Rust model match the current product language directly.

The new schema should still preserve the important product relationships:

- Sessions contain Entries, Findings, Drafts, Generation Contexts, AI Runs, and attachments.
- Attachments are managed files with metadata in SQLite.
- Evidence links connect Findings or generated Testware claims back to Entries; managed attachment references can support those links without renaming attachments as Evidence.
- AI Runs are immutable records of user-triggered generation attempts.
- Drafts remain editable Testware.

## Phases

1. Architecture blueprint: record this plan, the ADR, terminology constraints, no-migration scope, and validation strategy.
2. Workspace skeleton: introduce Cargo workspace, Tauri 2 shell, Vite/React frontend, baseline scripts, and smoke harness structure.
3. Core domain and storage: implement Rust domain types, fresh schema, repositories, services, and core tests.
4. Tauri command shell: expose the core through explicit Tauri command modules and native capability wrappers.
5. Frontend rebuild: build the React/Vite UI on top of typed Tauri wrappers.
6. Attachments and export: add managed attachment ingestion, clipboard screenshots, preview/copy helpers, Evidence linking, and export.
7. AI generation parity: port explicit local CLI provider detection, prompt construction, AI Runs, structured output parsing, and generated Session Report Drafts.
8. Packaging and validation hardening: finalize scripts, broad gates, package metadata, and documentation; remove obsolete Electrobun/Bun assumptions.

## Delivered Rebuild Status

The Rust/Tauri rebuild now includes the Cargo workspace, core SQLite storage, Tauri command shell, React/Vite UI, managed attachments, Markdown/JSON export, explicit local CLI AI generation, package metadata, and broad validation scripts. The old Electrobun/Bun runtime path is historical reference only and is not used by the current app.

## Validation Strategy

Validation should be added early and become stricter with each phase:

- `cargo fmt --all --check` for formatting.
- `cargo clippy --workspace --all-targets -- -D warnings` for Rust linting.
- `cargo test --workspace` for core, command, and smoke tests.
- Frontend typecheck and build for React/Vite.
- `bun run verify` for the broad gate used before packaging or handoff.
- `bun run smoke` for the non-GUI status smoke harness.
- Manual desktop smoke for path-based attachment import, clipboard image paste/copy, app-data paths, provider detection, and package launch when a GUI target is available.

## Follow-Up Decisions

- The CLI smoke harness currently remains development-only.
- Signed/notarized release automation is not configured yet.
- A native file dialog can replace path-based attachment import in a later UI polish pass.
- Local Ollama support remains out of scope for this rebuild.
