# qa-scribe

qa-scribe is a local-first desktop testing notepad for capturing testing sessions and turning the raw material into structured testware.

During a Session, testers can collect notes, observations, API responses, logs, possible findings, screenshots, and other evidence in one chronological Session Timeline. After capture, qa-scribe can help review the Generation Context and create editable Session Report Drafts with Jira-ready bug sections.

## Current Status

This repository contains an Electrobun, Bun, React, TypeScript, SQLite, and Drizzle MVP implementation.

Implemented capabilities include:

- Session Library with create, reopen, rename, and delete flows.
- Required Session title plus optional context, objective notes, environment, build/version, and related reference.
- Chronological Session Timeline with typed Entries.
- Managed attachment ingestion stored outside SQLite with metadata in the database.
- Findings linked to Entry or attachment Evidence.
- Manual Draft editing and copy-friendly Jira bug draft sections.
- Explicit AI generation through already-authenticated local Codex CLI, Claude Code, or GitHub Copilot CLI.
- Generation Context review before provider calls.
- Application settings for selectable AI providers, the generation system prompt, and advanced Note/Finding capture templates.
- Finding composer attachments from actual and expected result editors, linked as Finding Evidence on save.
- Local capture, persistence, and export without AI configuration.
- Electrobun local builds for the current platform.

## Tech Stack

- Desktop shell: Electrobun
- Runtime: Bun
- Build tooling: Electrobun CLI
- UI: React and TypeScript
- Styling: plain CSS with adaptive light/dark design tokens
- Database: SQLite
- Database access: Drizzle ORM with `bun:sqlite`
- Host/renderer bridge: Electrobun typed RPC with Zod validation
- AI: local provider adapters for Codex CLI, Claude Code, and GitHub Copilot CLI
- Tests: Vitest
- Packaging: Electrobun

## Requirements

- Bun for dependency installation, scripts, the Electrobun runtime, and Bun SQLite tests
- Node.js for Node-based development tools invoked by package scripts
- macOS, Windows, or Linux matching the local build target

The app uses Bun's built-in SQLite driver. Service tests that open the database run under Bun through the package scripts.

## Setup

Install dependencies:

```sh
bun install
```

Run the desktop app in development mode:

```sh
bun run dev
```

## AI Providers

AI generation is optional. Capture, persistence, manual review, drafts, and export work without any AI provider.

qa-scribe does not manage API keys. It detects already-authenticated local tools and lets users enable or disable which detected CLI providers are selectable in application settings:

- Claude Code through the local `claude` CLI and existing Claude authentication.
- Codex through the local `codex` CLI and existing Codex authentication.
- GitHub Copilot through the standalone local `copilot` CLI and existing Copilot authentication.

Provider model discovery is best-effort and never makes an otherwise authenticated provider unavailable. If discovery fails, qa-scribe keeps cost-aware static fallback choices and still accepts custom model names.

| Provider | Discovery source | Fallback behavior |
| --- | --- | --- |
| Codex CLI | `codex app-server --stdio` JSON-RPC `model/list` after local authentication succeeds. Returned display names and per-model reasoning efforts populate the generation controls. | Static Codex fallback choices prefer `gpt-5.4` by default with `gpt-5.4-mini` available as the cheaper option if app-server discovery times out, fails, or returns an unexpected shape. |
| Claude Code | `claude --help` is parsed for documented aliases and effort values. If the separate Anthropic `ant` CLI is installed and credentialed, `ant beta:models list` can add full model descriptors and model-specific effort capabilities. | Static Claude fallback choices prefer `sonnet` by default and include `haiku` for cheaper runs. Premium models such as Opus or Fable are not promoted as static fallbacks, but remain usable when discovered by the provider or entered as custom model names. |
| GitHub Copilot CLI | `copilot help config` is parsed for the local CLI model catalog. Concrete discovered models expose documented `--effort` choices; `auto` remains the no-explicit-reasoning default. | Static Copilot choices are used if help-config parsing fails, and custom model names remain accepted. |

Environment overrides still influence default model selection when present: `CLAUDE_MODEL`, `CODEX_MODEL`, and `COPILOT_MODEL`.

Application settings also store the editable system prompt used as the first instruction block for AI generation. qa-scribe still appends protected context, evidence, and structured-output instructions so generated Testware remains grounded in the reviewed Generation Context.

Advanced settings also control the fields shown by the Note and Finding capture forms. Required fields stay enabled, while optional fields can be hidden and supported field types include text, textarea, rich text, select, multiselect, and checkbox controls. The Finding form keeps structured Jira-oriented fields such as actual result, expected result, steps, severity, priority, component, environment, and notes.

For desktop launches, qa-scribe hydrates the provider command `PATH` from the user's login shell and common local install locations before spawning `claude`, `codex`, or `copilot`. This helps CLIs installed through Homebrew, npm, nvm, fnm, or similar tools work the same way they do in a terminal. Provider checks and generation run from an empty qa-scribe runtime directory under `~/.qa-scribe/provider-runtime` by default, so the CLIs can resolve their normal user-local configuration without receiving the app repository as working-directory context. Set `QA_SCRIBE_PROVIDER_RUNTIME_DIR` to override that runtime location.

Privacy boundaries:

- AI calls only happen when the user explicitly starts generation.
- Provider, model, and reasoning choices are per-run Generation Context controls.
- Only non-secret last-used provider/model/reasoning choices are persisted locally for convenience.
- Attachments are sent to the prompt as metadata only; raw screenshot or file binaries are not sent by default.

## Scripts

```sh
bun run dev
```

Starts the Electrobun development app with watch mode.

```sh
bun run lint
```

Runs TypeScript checks.

```sh
bun run test
```

Runs Vitest for renderer/provider tests and Bun's test runner for the SQLite service suite.

```sh
bun run test:watch
```

Starts Vitest watch mode for the non-SQLite suites.

```sh
bun run build
```

Type-checks and builds an Electrobun app for the current platform.

```sh
bun run build:dev
```

Builds an Electrobun development artifact.

```sh
bun run build:canary
```

Builds an Electrobun canary artifact.

```sh
bun run build:stable
```

Builds an Electrobun stable artifact. Production release artifacts should be built on their matching host OS/architecture.

## Database And Files

The app stores its SQLite database in Electrobun's app-scoped user data directory as `qa-scribe.sqlite`.

Managed attachment files are stored in an `attachments` folder under the same app data location. SQLite remains the source of truth for attachment ownership and metadata.

The database currently uses a small versioned migration runner based on SQLite `user_version`.

Drizzle schema files describe the TypeScript data model. Runtime database changes are applied through the `user_version` migration runner in `src/main/db/migrations.ts`; generated Drizzle artifacts are not the runtime migration source of truth.

Managed attachment files are deleted with their owning Session and are bounded by service-level import and preview limits.

## Project Structure

```text
src/bun/               Electrobun host process, window lifecycle, and RPC handlers
src/main/              SQLite, services, provider adapters, and domain logic
src/renderer-view/     Electrobun browser adapter that exposes window.qaScribe
src/renderer/          React app and styles
src/shared/            Shared Zod contracts, TypeScript types, and RPC schema
drizzle/               Generated Drizzle schema migration artifacts
docs/                  Product plan and architecture decisions
scripts/               Local build/package helper scripts
```

## Verification

Before packaging or sharing changes, run:

```sh
bun run verify
bun run build
```

`bun run verify` runs the project typecheck and test suite. Release-oriented build scripts (`build`, `build:dev`, `build:canary`, and `build:stable`) run verification before invoking Electrobun.

Production artifacts should be built on the target host OS/architecture. Use `scripts/assert-package-platform.cjs` in any release automation that targets a specific platform, for example `bun scripts/assert-package-platform.cjs darwin macOS` before a macOS package step.

The current Electrobun configuration leaves macOS codesigning/notarization disabled and has an empty release `baseUrl`; set those values before publishing signed or auto-updated artifacts.

## Documentation

- [Initial phased plan](docs/initial-phased-plan.md) (historical baseline)
- [Architecture cleanup plan](docs/architecture-cleanup-plan.md)
- [Project language](CONTEXT.md)
- [Architecture decisions](docs/adr)
