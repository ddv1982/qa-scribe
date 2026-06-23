# qa-scribe

qa-scribe is a local-first desktop testing notepad for capturing testing Sessions and turning raw testing material into structured Testware.

During a Session, testers capture Entries such as Notes, Observations, API Responses, Logs, possible Findings, screenshots, and managed attachments in a chronological Session Timeline. qa-scribe can then help review a Generation Context and create editable Session Report Drafts.

## Current Status

qa-scribe has been rebuilt as a Rust/Tauri application with a fresh SQLite schema. The previous Electrobun/Bun MVP remains historical product reference only; existing MVP data, Drizzle artifacts, Bun SQLite migrations, and Electrobun app-data layouts are not migration targets.

Implemented capabilities include:

- Session Library create/reopen/delete flows.
- Session Context and Objective Notes.
- Session Timeline Entry capture with include/exclude controls for generation.
- Findings linked to Entry Evidence and managed attachment Evidence.
- Managed attachment import by local path and pasted clipboard image data.
- Attachment preview data URLs and local Markdown/JSON Session export.
- Editable Session Report Drafts persisted in local SQLite.
- Explicit user-triggered AI generation through already-authenticated local Claude Code, Codex CLI, or GitHub Copilot CLI commands when available.
- Local app settings for the generation system prompt.

## Tech Stack

- Desktop shell: Tauri 2
- Core: Rust Cargo workspace
- UI: React, TypeScript, and Vite
- Storage: fresh Rust-owned SQLite schema through `rusqlite`
- Bridge: typed Tauri commands and serde DTOs
- AI: local CLI process execution only; qa-scribe does not store provider API keys

## Requirements

- Rust stable
- Node.js 22.13 or newer
- Platform toolchain for the local Tauri target
- Optional authenticated local AI CLIs: `claude`, `codex`, or `gh copilot`

Install frontend dependencies:

```sh
npm --prefix frontend install
```

Run the desktop app in development mode:

```sh
npm run dev
```

Build the Rust workspace and frontend:

```sh
npm run build
```

Run the broad verification gate:

```sh
npm run verify
```

Run the non-GUI smoke harness:

```sh
npm run smoke
```

Validate package metadata JSON:

```sh
npm run package:check
```

## AI Providers

AI generation is optional. Capture, persistence, manual review, Draft editing, attachment handling, and export work without AI configuration.

qa-scribe does not manage API keys. It detects local CLI tools and only starts generation when the user explicitly chooses a provider and runs generation.

- Claude Code: detects `claude --version` and runs `claude -p`.
- Codex CLI: detects `codex --version` and runs `codex exec`.
- GitHub Copilot CLI: detects `gh copilot --help` and runs `gh copilot explain`.

Provider model and reasoning choices are recorded on each AI Run and included in the provider prompt. Provider authentication remains the responsibility of the local CLI.

## Data And Privacy

- Storage is local SQLite under the Tauri app-data directory.
- Managed attachment files are stored under `attachments/<session-id>/` in the app-data directory.
- SQLite stores attachment metadata, ownership, hashes, and relative paths.
- Deleting a Session through the Tauri app removes its managed attachment files and cascades database rows.
- AI calls send only the selected Generation Context text and attachment metadata, not raw attachment binaries.
- Existing Electrobun/Bun databases are intentionally not read or migrated.

## Project Structure

```text
crates/qa-scribe-core/  Domain, SQLite storage, attachments, export, generation, tests
crates/qa-scribe-app/   Non-GUI smoke harness
src-tauri/              Tauri 2 shell and command modules
frontend/               React/Vite renderer and typed Tauri bridge
docs/                   Rebuild plan and architecture decisions
scripts/                Local packaging helpers
```

## Documentation

- [Rust rebuild plan](docs/rust-rebuild-plan.md)
- [Rebuild ADR](docs/adr/0009-rebuild-with-rust-tauri.md)
- [Project language](CONTEXT.md)
- [Architecture decisions](docs/adr)
- Historical planning docs remain in `docs/` for reference.
