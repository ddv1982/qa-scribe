# Code Quality Roadmap

Date: 2026-07-13. Baseline: v0.7.13.

## Decision

Continue improving the existing Rust/Tauri application incrementally. Do not start another ground-up rewrite and do not replace the current state-management approach with a global reducer or third-party state framework.

The architecture already matches ADR 0009: the Rust core owns domain and persistence behavior, the Tauri crate owns native integration and process execution, and React talks through generated Specta bindings. The remaining quality work is narrower: add a real application-level safety net, align frontend language with the domain, reduce coordination coupling, make maintainability policies enforceable, and keep dependency exceptions current.

Each slice must preserve the SQLite schema, Tauri command names, generated binding compatibility, and provider authentication assumptions unless a separate product or architecture decision explicitly changes them. `CONTEXT.md` remains authoritative.

## Agreed Principles

- **Session and Note are distinct.** A Session is the testing effort; a Note is an Entry inside it. Session-facing UI and frontend identifiers must use Session. Genuine Note Entry, summarization, and prompt concepts keep Note.
- **Compatibility over cosmetic boundary churn.** The terminology cleanup does not rename persisted values or accurate commands such as `open_session_note_state`.
- **Narrow capability ownership.** Keep independent React state in `useState`; move related state, refs, transitions, and callbacks into focused capability hooks. Use a local reducer only when one capability has a genuine state machine.
- **Real application coverage without external-provider flakiness.** Required end-to-end tests exercise a built Tauri application with deterministic fake provider executables, never authenticated Claude, Codex, or Copilot accounts.
- **Policies must be checkable.** File-size and dependency-exception guidance must have automated or time-bounded enforcement rather than relying on prose that can silently drift.

## Completed Foundation

- Rust owns the domain, SQLite persistence, attachment integrity, generation workflows, and provider stream parsing.
- Tauri owns the narrow native boundary, clipboard/filesystem integration, provider probing, process lifecycle, and job control.
- React uses generated Specta bindings and structured command errors.
- Provider execution covers cancellation, watchdog timeouts, process-group cleanup, blocked pipes, crash recovery, and webview job reconciliation.
- The frontend has strict TypeScript, type-aware ESLint, sanitization, contrast checks, and focused controller characterization tests.
- CI and release validation share one composite quality action.

The older `docs/improvement-plan.md` remains historical evidence from v0.4.24; this document is the active roadmap.

## Implementation Status

As of 2026-07-13:

- Phases 1–5 are implemented. The built-app suite passes all four critical workflows locally and is wired into the shared Linux CI/release action; terminology, capability boundaries, file-size policy, and reviewed RustSec exceptions are automated gates.
- Phase 6 measurement infrastructure is implemented. CI retains success/failure/rerun evidence, enforces the large-fixture first-paint budget on `ubuntu-24.04-github-x64`, records bundle size, and provides a promotion audit command.
- Phase 6 is intentionally not declared complete yet. The repository must accumulate 20 consecutive first-attempt remote E2E passes. macOS E2E remains deferred and non-required until `bun run e2e:reliability:check` reports readiness.

### Completion Evidence Map

| Phase | Repository evidence | Status |
| --- | --- | --- |
| 1 | Fixed baseline, `bun run e2e`, production-isolation check, shared Linux CI/release action, and optional real-provider smoke checklist | Implemented locally; remote reliability history is tracked in Phase 6 |
| 2 | Session/Note frontend rename plus `bun run terminology:check` | Complete |
| 3 | Capability workspaces and stable action APIs; autosave, lifecycle, stale-load, generation, and close-protection regression tests | Complete |
| 4 | Four Rust test splits plus `bun run code-size:check`, including expiring exception/exclusion metadata | Complete |
| 5 | Exact 20-record RustSec registry, compatible lockfile updates, upgrade-spike evidence, and `bun run rust:audit` | Complete |
| 6 | Retained pass/fail/attempt markers, promotion audit, versioned large fixture, named-runner budget/reporting, and reviewed bundle delta | Infrastructure complete; 20 remote first-attempt passes and later macOS expansion remain |

## Phase 1 — Baseline and Required Linux End-to-End Gate

**Outcome:** refactors and terminology changes are protected by a small suite that drives the real Tauri application.

1. Record the v0.7.13 baseline: `bun run verify:fast`, the full Rust suite, frontend test count, relevant file sizes, startup marks, and production bundle size. The fixed record is `docs/code-quality-baseline.md`.
2. Add WebdriverIO using [Tauri's supported WebDriver integration](https://v2.tauri.app/develop/tests/webdriver/) and a test-only application configuration. Test plugins and permissions must never be enabled in production bundles.
3. Give every test an isolated temporary app-data directory and deterministic fixtures.
4. Add 3–5 critical workflows:
   - create, edit, close/reopen, and delete a Session;
   - persist edits to the Session's Note Entry across Session switching;
   - create and delete a Draft or Finding;
   - cover one managed-attachment or clipboard boundary when the Linux runner supports it reliably;
   - start, stream, complete, and cancel generation through a deterministic fake provider executable.
5. Capture frontend and backend logs on failure and make the Linux suite a required PR, merge-queue, and release gate.
6. Keep real authenticated-provider checks as an optional manual release smoke test only.

**Exit criteria:** the suite runs from one documented command, is required in CI/release validation, leaves no persistent user data, exposes no test-only production capability, and passes repeatedly without manual timing or network dependencies.

## Phase 2 — Align Session and Note Language

**Outcome:** user-facing copy and internal frontend names tell the truth about the domain without breaking storage or IPC.

1. Rename Session-facing navigation, pickers, empty states, actions, notices, ARIA labels, tests, and component/CSS names from Note to Session.
2. Rename frontend state and workflow identifiers that hold Session data, including `noteTitle`-style names, Session view names, and `open-note`/`new-note`/`delete-note` busy keys.
3. Clarify identifiers that store a Session id while calling the target a Note.
4. Preserve `noteEntry`, `noteBody`, `EntryType::Note`, selected-Note generation language, and other genuine Note Entry concepts.
5. Preserve the SQLite schema, serialized enum values, Rust domain types, Tauri command names, and generated binding contracts.
6. Add a terminology regression check over user-facing frontend copy, with an explicit allowlist for genuine Note Entry usage.

**Exit criteria:** the UI consistently presents Sessions, genuine Note Entry language remains intact, no migration is required, and unit plus end-to-end behavior is unchanged apart from approved copy.

## Phase 3 — Narrow Frontend Coordination Boundaries

**Outcome:** no workflow depends on the current nearly 50-field `AppWorkflowContext`.

1. Use the Phase 1 end-to-end suite and existing characterization tests before moving coordination code.
2. Extract capability hooks around cohesive behavior. Expected seams include Session workspace/editing, Draft/Finding records, generation jobs, and application notifications; exact names should follow the behavior discovered during each slice.
3. Give each hook a small explicit input/output contract. Do not pass unrelated setters, refs, or derived data through a generic context.
4. Keep autosave, stale-write rejection, dirty-record preservation, Session switching, and close protection explicit and covered by focused tests.
5. Return stable callbacks from hooks and remove hook-rule suppressions made unnecessary by the new ownership boundaries.
6. Keep independent UI state in `useState`. Introduce `useReducer` only inside one capability when multiple fields form a demonstrable transition system; do not add a global store.
7. Measure render and startup behavior before optimizing. Add the existing planned large-data startup fixture before making performance-driven structural changes.

**Exit criteria:** capability interfaces are narrow, workflow factories no longer receive a global mutable context, no behavior regresses, no unexplained lint suppression is added, and measured startup/render performance does not worsen beyond the recorded baseline.

## Phase 4 — Test Organization and Enforced Size Policy

**Outcome:** maintained files conform to the repository's documented size policy and cannot silently drift again.

1. Split the four current Rust test files above 500 physical lines by behavior and shared fixture ownership:
   - `crates/qa-scribe-core/src/generation/tests.rs`;
   - `crates/qa-scribe-core/src/generation/workflow/tests.rs`;
   - `crates/qa-scribe-core/tests/session_storage/migrations.rs`;
   - `crates/qa-scribe-core/tests/session_storage/generation_and_relationships.rs`.
2. Preserve private-access unit tests as sibling test modules rather than converting them mechanically to integration tests.
3. Add a repository check that fails maintained source or test files above 500 physical lines.
4. Allow an exception only when it records the file, rationale, why splitting would reduce cohesion, and a review date.
5. Report the 300–500 watch range without failing it. Continue excluding generated files, lockfiles, release metadata, binary assets, and explicitly reviewed operational scripts.

**Exit criteria:** no unapproved maintained source/test file exceeds 500 lines, the check runs in CI and release validation, and all moved tests retain their original behavioral coverage.

## Phase 5 — Dependency Exception Hardening

**Outcome:** there are no unexplained or stale dependency-audit ignores.

1. Classify every ignored RustSec advisory as vulnerability, unsoundness, or unmaintained dependency.
2. Record the affected package and target, application exposure, dependency path, upstream blocker, compatible patched version when one exists, review date, and removal trigger.
3. Resolve advisories with compatible updates first; the current `anyhow` unsoundness warning has a compatible patched release and should not remain ignored without evidence that the update is blocked.
4. Run a time-boxed Tauri/GTK/Wayland upgrade spike for the constrained Linux stack and remove every ignore it makes obsolete.
5. Keep genuinely blocked transitive advisories only with an explicit rationale and deadline. Recheck them at least quarterly and whenever Tauri, `tauri-plugin-clipboard-manager`, `tauri-specta`, or the Linux webview stack changes.
6. Continue failing CI on every new advisory that is not already in the reviewed registry.

**Exit criteria:** the audit passes with only reviewed, current exceptions; all compatible fixes are applied; and the next review date is visible in `docs/rust-dependency-audit.md`. Zero ignores is desirable but is not required when upstream constraints are documented.

## Phase 6 — Stabilization and Cross-Platform Expansion

**Outcome:** the new controls remain useful rather than becoming flaky or ceremonial.

1. Track Linux end-to-end duration, failures, and reruns. Fix or quarantine infrastructure defects immediately; do not normalize rerunning a required gate until it passes.
2. Require 20 consecutive green required-gate executions without an infrastructure rerun before using the suite as the basis for platform expansion.
3. Add the large-data startup fixture, record cold/warm baselines, and make the existing startup budgets enforceable only after the fixture is reproducible on a named runner class.
4. Review Vite bundle output and editor-heavy interaction timing against the Phase 1 baseline.
5. Add macOS end-to-end coverage after the Linux suite is stable. Keep Linux required while macOS is introduced non-blocking; promote macOS only after it meets the same reliability standard.
6. Reassess the test-only Tauri plugin configuration against `docs/tauri-threat-model.md` before enabling it on another platform.

**Exit criteria:** Linux remains a dependable required gate, performance budgets are fixture-backed, and any macOS gate has demonstrated the same reproducibility before becoming required.

## Slice Definition of Done

Every implementation slice must meet all of these:

1. It has one stated behavioral or maintainability outcome and avoids unrelated cleanup.
2. Public behavior and boundary names remain unchanged unless the phase contains an explicit product decision permitting the change.
3. A characterization, focused regression, or end-to-end test covers the behavior at the appropriate layer.
4. No new lint, audit, size, or security exception is added without a narrow rationale and review trigger.
5. Documentation and code use Session, Entry, Evidence, Finding, Testware, Draft, AI Run, Generation Context, and Note consistently with `CONTEXT.md`.
6. `bun run verify:fast` passes between slices. Run `bun run verify` for boundary, dependency, release, packaging, or completed-phase changes.

## Stop Conditions

Pause and write an ADR before changing the database ownership model, replacing Tauri or React, introducing a server/cloud dependency, changing provider authentication assumptions, enabling test-only privileges in production, or renaming authoritative domain concepts. These are architecture or product changes, not refactors.

No ADR is required for the phases above as scoped: they reinforce existing boundaries, preserve compatibility, and remain reversible.
