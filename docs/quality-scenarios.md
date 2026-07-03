# Quality Scenarios

This document defines measurable quality scenarios for qa-scribe. Use these scenarios when reviewing feature work, refactors, and release readiness. They are intentionally concrete so quality claims can be checked with tests, static gates, or a reproducible manual workflow.

## Baseline Gate

Before release-oriented work is considered complete, run:

```bash
bun run verify
```

For focused work, use the smallest check that can fail for the changed behavior, then run the broad gate before final release or session closure.

## Maintainability

Scenario: adding a new AI action for a selected Note should not require editing unrelated Testware or Finding UI code.

Measure:

- Public Tauri command names remain covered by `frontend/src/tauri.test.ts`.
- Selected Entry validation stays isolated in `src-tauri/src/commands/ai/selection.rs`.
- Provider stream parsing changes stay isolated in `src-tauri/src/commands/ai/stream_parser.rs`.

Validation:

```bash
bun run --cwd frontend test
cargo test -p qa-scribe-tauri
```

## Reliability

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

## Review Expectations

- Correctness and privacy scenarios are blocking when touched.
- Refactors must show behavior-preservation evidence, not only formatting.
- Documentation and code should continue to use Session, Entry, Evidence, Finding, Testware, Draft, AI Run, and Generation Context consistently with `CONTEXT.md`.
