# qa-scribe

qa-scribe is a local-first desktop testing notepad for capturing testing sessions and turning the raw material into structured testware.

During a Session, testers can collect notes, observations, API responses, logs, possible findings, screenshots, and other evidence in one chronological Session Timeline. After capture, qa-scribe can help review the Generation Context and create editable Session Report Drafts with Jira-ready bug sections.

## Current Status

This repository contains an Electron, React, TypeScript, SQLite, and Drizzle MVP implementation.

Implemented capabilities include:

- Session Library with create, reopen, rename, and delete flows.
- Required Session title plus optional context, objective notes, environment, build/version, and related reference.
- Chronological Session Timeline with typed Entries.
- Managed attachment ingestion stored outside SQLite with metadata in the database.
- Findings linked to Entry or attachment Evidence.
- Manual Draft editing and copy-friendly Jira bug draft sections.
- Explicit AI generation through already-authenticated local Codex CLI, Claude Code, or GitHub Copilot CLI.
- Generation Context review before provider calls.
- Local capture, persistence, and export without AI configuration.
- macOS local directory packaging through electron-builder.

## Tech Stack

- Desktop shell: Electron
- Build tooling: electron-vite
- UI: React and TypeScript
- Styling: plain CSS with adaptive light/dark design tokens
- Database: SQLite
- Database access: Drizzle ORM with `better-sqlite3` in Electron main
- IPC validation: Zod
- AI: local provider adapters for Codex CLI, Claude Code, and GitHub Copilot CLI
- Tests: Vitest
- Packaging: electron-builder

## Requirements

- Node.js compatible with the versions in `package-lock.json`
- npm
- macOS for local macOS packaging

`better-sqlite3` is a native dependency. The project scripts rebuild it for Node during tests and for Electron during app runtime/package workflows.

Dependency updates should stay compatible with the Electron toolchain. In particular, `electron-vite@5` currently peers with Vite 5, 6, or 7, so Vite 8 and `@vitejs/plugin-react@6` should wait until the Electron build stack supports them. Node typings should track Electron's embedded Node major rather than the newest local Node installed on a developer machine.

## Setup

Install dependencies:

```sh
npm install
```

Run the desktop app in development mode:

```sh
npm run dev
```

## AI Providers

AI generation is optional. Capture, persistence, manual review, drafts, and export work without any AI provider.

qa-scribe does not manage API keys or expose an AI settings screen. It detects already-authenticated local tools:

- Claude Code through the local `claude` CLI and existing Claude authentication.
- Codex through the local `codex` CLI and existing Codex authentication.
- GitHub Copilot through the standalone local `copilot` CLI and existing Copilot authentication.

Provider model discovery is best-effort and never makes an otherwise authenticated provider unavailable. If discovery fails, qa-scribe keeps cost-aware static fallback choices and still accepts custom model names.

| Provider | Discovery source | Fallback behavior |
| --- | --- | --- |
| Codex CLI | `codex app-server --stdio` JSON-RPC `model/list` after local authentication succeeds. Returned display names and per-model reasoning efforts populate the generation controls. | Static Codex fallback choices prefer `gpt-5.4` by default with `gpt-5.4-mini` available as the cheaper option if app-server discovery times out, fails, or returns an unexpected shape. |
| Claude Code | `claude --help` is parsed for documented aliases and effort values. If the separate Anthropic `ant` CLI is installed and credentialed, `ant beta:models list` can add full model descriptors and model-specific effort capabilities. | Static Claude fallback choices prefer `sonnet` by default and include `haiku` for cheaper runs. Premium models such as Opus or Fable are not promoted as static fallbacks, but remain usable when discovered by the provider or entered as custom model names. |
| GitHub Copilot CLI | `copilot help config` is parsed for the local CLI model catalog. Concrete discovered models expose documented `--effort` choices; `auto` remains the no-explicit-reasoning default. | Static Copilot choices are used if help-config parsing fails, and custom model names remain accepted. |

Environment overrides still set the initial default model when present: `CLAUDE_MODEL`, `CODEX_MODEL`, and `COPILOT_MODEL`.

For desktop launches, qa-scribe hydrates the provider command `PATH` from the user's login shell and common local install locations before spawning `claude`, `codex`, or `copilot`. This helps CLIs installed through Homebrew, npm, nvm, fnm, or similar tools work the same way they do in a terminal. Provider checks and generation run from an empty qa-scribe runtime directory under `~/.qa-scribe/provider-runtime` by default, so the CLIs can resolve their normal user-local configuration without receiving the app repository as working-directory context. Set `QA_SCRIBE_PROVIDER_RUNTIME_DIR` to override that runtime location.

Privacy boundaries:

- AI calls only happen when the user explicitly starts generation.
- Provider, model, and reasoning choices are per-run Generation Context controls.
- Only non-secret last-used provider/model/reasoning choices are persisted locally for convenience.
- Attachments are sent to the prompt as metadata only; raw screenshot or file binaries are not sent by default.

## Scripts

```sh
npm run dev
```

Starts the Electron development app.

```sh
npm run lint
```

Runs TypeScript checks.

```sh
npm test
```

Rebuilds `better-sqlite3` for Node, runs Vitest, then rebuilds it for Electron.

```sh
npm run test:watch
```

Rebuilds `better-sqlite3` for Node and starts Vitest.

```sh
npm run build
```

Type-checks and builds Electron main, preload, and renderer output.

```sh
npm run dist:dir
```

Builds and packages an unpacked app directory for the current platform.

```sh
npm run dist:mac
```

Builds macOS artifacts. This script only runs on macOS.

```sh
npm run dist:win
npm run dist:linux
```

These scripts must be run on their matching operating systems because `better-sqlite3` needs target-platform native binaries.

## Database And Files

The app stores its SQLite database in Electron's app data directory as `qa-scribe.sqlite`.

Managed attachment files are stored in an `attachments` folder under the same app data location. SQLite remains the source of truth for attachment ownership and metadata.

The database currently uses a small versioned migration runner based on SQLite `user_version`.

## Project Structure

```text
src/main/              Electron main process, SQLite, IPC, services
src/preload/           Narrow preload bridge exposed to the renderer
src/renderer/          React app and styles
src/shared/            Shared Zod contracts and TypeScript types
drizzle/               Generated Drizzle schema migration artifacts
docs/                  Product plan and architecture decisions
scripts/               Local build/package helper scripts
```

## Verification

Before packaging or sharing changes, run:

```sh
npm run lint
npm test
npm run build
npm run dist:dir
```

## Documentation

- [Initial phased plan](docs/initial-phased-plan.md)
- [Architecture cleanup plan](docs/architecture-cleanup-plan.md)
- [Project language](CONTEXT.md)
- [Architecture decisions](docs/adr)
