# qa-scribe

qa-scribe is a local-first desktop testing notepad for capturing testing sessions and turning the raw material into structured testware.

During a Session, testers can collect notes, observations, API responses, logs, possible findings, screenshots, and other evidence in one chronological Session Timeline. After capture, qa-scribe can help review the Generation Context and create editable Session Report Drafts with Jira-ready bug sections.

## Current Status

This repository contains an Electron, React, TypeScript, SQLite, and Drizzle MVP implementation.

Implemented capabilities include:

- Session Library with create, reopen, rename, and delete flows.
- Session metadata for Test Target, Charter, environment, build/version, and related reference.
- Chronological Session Timeline with typed Entries.
- Managed attachment ingestion stored outside SQLite with metadata in the database.
- Findings linked to Entry or attachment Evidence.
- Manual Draft editing and copy-friendly Jira bug draft sections.
- Explicit AI generation through the Vercel AI SDK and OpenAI provider configuration.
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
- AI: Vercel AI SDK with OpenAI
- Tests: Vitest
- Packaging: electron-builder

## Requirements

- Node.js compatible with the versions in `package-lock.json`
- npm
- macOS for local macOS packaging

`better-sqlite3` is a native dependency. The project scripts rebuild it for Node during tests and for Electron during app runtime/package workflows.

## Setup

Install dependencies:

```sh
npm install
```

Run the desktop app in development mode:

```sh
npm run dev
```

## AI Configuration

AI generation is optional. Capture, persistence, manual review, drafts, and export work without an API key.

To enable generation, set:

```sh
export OPENAI_API_KEY="your-api-key"
export OPENAI_MODEL="gpt-4.1-mini"
```

`OPENAI_MODEL` is optional. If omitted, qa-scribe uses `gpt-4.1-mini`.

Privacy boundaries:

- AI calls only happen when the user explicitly starts generation.
- API keys are read from environment variables and are not stored in SQLite.
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
- [Project language](CONTEXT.md)
- [Architecture decisions](docs/adr)
