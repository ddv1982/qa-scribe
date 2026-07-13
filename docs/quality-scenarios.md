# Quality Scenarios

This document defines measurable quality scenarios for qa-scribe. Use these scenarios when reviewing feature work, refactors, and release readiness. They are intentionally concrete so quality claims can be checked with tests, static gates, or a reproducible manual workflow.

## Baseline Gate

Before release-oriented work is considered complete, run:

```bash
bun run verify
```

For focused work, use the smallest check that can fail for the changed behavior, then run the broad gate before final release or session closure.

## Required Application-Level Gate

The required Linux end-to-end suite drives a built Tauri application through WebdriverIO and Tauri's embedded WebDriver provider. It is part of both PR/merge-queue validation and release validation.

Scenario: critical Session workflows behave correctly across the React, Tauri, Rust, SQLite, and process boundaries.

Measure:

- Every suite run uses an isolated temporary app-data root; each workflow seeds its own deterministic Session fixture and does not depend on the previous workflow's active view or data.
- The suite creates, edits, reopens, and deletes a Session and persists its Note Entry across Session switching.
- The suite creates and deletes Testware.
- The native clipboard command boundary is covered.
- Provider execution uses deterministic fake executables to cover streaming, completion, cancellation, persistence, and UI reconciliation.
- No test requires a real provider account, network access, model response, or usage cost.
- Test-only Tauri plugins and permissions are absent from production bundles.

Validation:

```bash
bun run e2e
```

The command builds the opt-in E2E binary, restores a production frontend build before running it, writes run metadata and failure evidence under `artifacts/e2e/`, and removes its temporary application data. Run `bun run e2e:isolation` after a production frontend build to prove the WDIO guest, permissions, and plugins are absent from production.

## Maintainability

Scenario: adding a new AI action for a selected Note Entry should not require editing unrelated Testware or Finding UI code.

Measure:

- Public Tauri command names remain covered by `frontend/src/tauri.test.ts`.
- Selected Entry validation stays isolated in `crates/qa-scribe-core/src/generation/workflow.rs`.
- Provider stream parsing changes stay isolated in the per-format parsers under `crates/qa-scribe-core/src/ai/stream/`.

Validation:

```bash
bun run --cwd frontend test
cargo test -p qa-scribe-core
cargo test -p qa-scribe-tauri
```

## Reliability

Scenario: the built-application Linux gate is stable enough to justify adding another required platform.

Measure:

- Every required E2E execution retains a passed or failed marker for 90 days.
- A rerun is evidence of instability even when the rerun passes.
- macOS E2E must not become required until the most recent 20 retained executions are consecutive first-attempt passes.

Validation before platform promotion:

```bash
GITHUB_REPOSITORY=ddv1982/qa-scribe GH_TOKEN=... bun run e2e:reliability:check
```

CI writes E2E duration, result, runner class, and workflow attempt to the job summary. Failure artifacts include the WebdriverIO log, run metadata, and screenshots.

Scenario: AI action jobs do not grow process memory indefinitely after jobs complete, fail, or are cancelled.

Measure:

- `JobStore` reports only active jobs through `activeJobCount`.
- Recent terminal job status remains available, but old terminal records are pruned after the retention bound.

Validation:

```bash
cargo test -p qa-scribe-tauri jobs::tests::terminal_jobs_are_bounded_but_recent_status_is_available
```

## Security And Privacy

Scenario: summarizing a Note cannot update an Entry from another Session or silently fall back to another Note.

Measure:

- An explicit `noteEntryId` must resolve to a Note in the requested Session.
- Summary completion updates the prepared selected Note id, not an unchecked request id.

Validation:

```bash
cargo test -p qa-scribe-core generation::workflow::tests::summary_generation_rejects_note_id_from_another_session
cargo test -p qa-scribe-core generation::workflow::tests::summary_completion_updates_the_selected_note_only
```

## Usability

Scenario: the UI distinguishes the Session from its Note Entry consistently.

Measure:

- Session navigation, creation, deletion, selection, titles, notices, and empty states use Session.
- Note refers only to a Note Entry, its editor, or an operation on that Entry.
- SQLite values, Rust domain types, Tauri command names, and generated bindings remain compatible.

Validation target:

```bash
bun run terminology:check
bun run --cwd frontend test
```

The terminology check is required in CI and release validation.

Scenario: failed Draft or Finding saves preserve the tester's editing context.

Measure:

- Draft and Finding views stay in edit mode when the save callback reports failure.
- Successful saves still leave edit mode and keep existing copy/delete actions available.

Validation:

```bash
bun run --cwd frontend test src/views/copySuccess.test.tsx
```

## Performance

Scenario: frontend refactors do not hide bundle growth or slow editor-heavy views.

Measure:

- `bun run verify` includes the production frontend build.
- Vite chunk-size warnings are reviewed during broad validation and either accepted with context or addressed with a targeted split.
- Shared rich-record rendering remains covered by view tests before further editor UI changes.

Validation:

```bash
bun run --cwd frontend build
bun run --cwd frontend test
```

Scenario: startup remains bounded as the Session Library and latest Session grow.

Measure:

- Backend startup logs include elapsed milliseconds for app-data setup, SQLite open/initialization, schema DDL, migrations, `PRAGMA foreign_key_check`, orphan AI Run recovery, SessionService setup, and total backend setup.
- Frontend startup marks use the `qa-scribe:startup:` prefix for boot start, settings loaded, Sessions loaded, first Session or empty library ready, boot busy cleared, first paint after boot, provider Fast status complete, and provider Deep refresh complete when it runs.
- Normal current-schema startup does not run the full unqualified `PRAGMA foreign_key_check`; migration startup still validates foreign keys before stamping the schema current.
- Boot loads a bounded recent Session list with `listRecentSessions(50)` and opens only the active Session Note state with `openSessionNoteState` before clearing boot busy state.
- Full Session Library loading is explicit after readiness through `Load all notes`; Draft and Finding bodies load only when their views or creation flows need them.
- The deterministic large fixture contains 1,000 Sessions and Note Entries, 250 Testware records, 250 Findings, and 2,000 AI Runs.
- On the `ubuntu-24.04-github-x64` runner class, both process-cold and warm samples must record first paint within 3 seconds. The gate uses three process launches against one fixture database.
- Provider Deep refresh must not be part of the boot busy-state budget; it is tracked separately as provider readiness work.
- The production bundle report records every JavaScript chunk plus aggregate raw and gzip size so growth is visible beside startup timing.
- The same built-app samples edit the large active Note Entry and report WebDriver-observed editor input p50/p95. This remains observational until named-runner history supports a stable budget.

Validation:

```bash
cargo test -p qa-scribe-core --test session_storage
bun run --cwd frontend test \
  src/app/useAppController.autosave.test.ts \
  src/app/useAppController.lifecycle.test.ts \
  src/app/useAppController.workflows.test.ts
bun run --cwd frontend test src/App.test.tsx
bun run startup:benchmark
bun run verify:fast
```

Local benchmark numbers are observational unless `QA_SCRIBE_STARTUP_BUDGET_MS` and `QA_SCRIBE_STARTUP_RUNNER_CLASS` name a controlled runner. Reports are written to `artifacts/startup/startup-report.json`; CI adds the cold, warm p50/p95, and bundle totals to the job summary.

## Review Expectations

- Correctness and privacy scenarios are blocking when touched.
- Refactors must show behavior-preservation evidence, not only formatting.
- Documentation and code should continue to use Session, Entry, Note, Evidence, Finding, Testware, Draft, AI Run, and Generation Context consistently with `CONTEXT.md`.
