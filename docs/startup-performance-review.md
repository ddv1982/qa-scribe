# Startup Performance Review

Date: 2026-07-13. Source: startup audit plus built-application large-fixture measurement covering Tauri startup, SQLite storage, frontend boot/session hydration, provider CLI checks, and production bundle output.

Deployment context: qa-scribe is a local-first, single-user Tauri desktop app. The performance risk is local startup latency and perceived readiness as the Session Library grows, not shared-service throughput.

## Executive Summary

Startup can get slower with database growth. The original strongest cause was not a single LLM CLI connection check; it was the boot shape. That shape has now been changed so initial readiness is bounded:

1. Tauri setup opens SQLite, initializes schema, runs migrations when needed, and sweeps orphaned running AI Runs before app state is ready (`src-tauri/src/main.rs:24-31`, `crates/qa-scribe-core/src/storage/mod.rs:68-122`, `crates/qa-scribe-core/src/services/session_service.rs:24-27`). Migration startup still runs full foreign-key validation before stamping the schema current; normal current-schema startup now skips the unqualified `PRAGMA foreign_key_check` scan.
2. The frontend boot path loads settings, a bounded recent Session list, and the active Session's editable Note Entry plus cheap Testware/Finding counts before clearing boot busy state (`frontend/src/app/useAppController.ts`, `frontend/src/app/sessionActions.ts`). Full Session Library loading is explicit through `Load all notes` after readiness.
3. Draft and Finding bodies are loaded only when their views or creation flows need them. Stale lazy loads are invalidated across Session transitions so old record data cannot repopulate the new active Session.
4. Provider CLI probing is deferred until after boot, and automatic boot provider work remains Fast status only. Deep refresh remains available through explicit provider refresh (`frontend/src/app/useAppController.ts`, `src-tauri/src/commands/providers.rs:24-36`).

The remaining improvement direction is evidence accumulation: keep the lightweight startup logs/marks, retain named-runner reports, and use the required regression gate to prevent startup from drifting back to unbounded boot work.

## Implementation Status

Implemented in the first startup-performance slice:

1. Backend startup timing logs for app-data setup, SQLite open/initialization phases, schema DDL, migrations, `PRAGMA foreign_key_check`, orphan AI Run recovery, SessionService setup, and total Tauri setup.
2. Frontend startup timing marks/measures for boot start, settings loaded, Sessions loaded, active Session or empty library ready, boot busy cleared, first paint after boot, provider Fast status complete, and provider Deep refresh completion when explicit refresh runs.
3. Startup quality budgets in `docs/quality-scenarios.md`.
4. Schema version 8 with partial index `idx_ai_runs_running_status` on `ai_runs(status) WHERE status = 'running'`, plus migration and query-plan coverage for the orphan AI Run sweep.
5. Fast-only automatic provider status after boot; Deep provider refresh remains available through the explicit provider refresh action.

Implemented in the full-resolution follow-up:

1. Current-schema SQLite opens skip the full unqualified `PRAGMA foreign_key_check`; migration opens still run it before `user_version` is stamped current.
2. New bounded backend startup APIs: `list_recent_sessions(limit)` and `open_session_note_state(id)`.
3. Frontend boot uses `listRecentSessions(50)` and `openSessionNoteState`, not full `listSessions`, `listEntries`, `listDrafts`, or `listFindings` before Notes readiness.
4. Full Session Library loading is explicit through the `Load all notes` action after the shell is ready.
5. Drafts and Findings hydrate lazily on view entry or creation flows, with stale-load invalidation across Session transitions and generated-record merge protection.

Implemented in the reproducible measurement follow-up:

1. A versioned fixture generator creates 1,000 Sessions and Note Entries, a large active Note, 250 active Testware records, 250 Findings, and 2,000 completed AI Runs with foreign-key validation.
2. `bun run startup:benchmark` launches the built Tauri application repeatedly against one fixture database and captures process-cold and warm frontend performance measures.
3. The benchmark proves boot hydration remains bounded and rejects any automatic Deep provider refresh.
4. CI records all three samples before enforcing a 4-second process-cold and 3-second warm first-paint budget on `ubuntu-24.04-github-x64`, then publishes cold/warm timing and production JavaScript raw/gzip totals in the job summary. The separate cold budget was calibrated after the first two named-runner measurements recorded 2,439ms and 3,141ms; the original single 3-second threshold had insufficient headroom for observed cold-runner variance.
5. A local `darwin-arm64-local` three-sample validation recorded 21ms process-cold and 23ms/23ms warm first-paint p50/p95, 181ms/332ms editor input p50/p95 for the 80,000-character Note, and 776,738 raw / 241,220 gzip JavaScript bytes. These local numbers are evidence that the harness works, not the Linux release baseline.

## Phase 6 Baseline Comparison

The v0.7.13 production baseline was 771.81 kB raw and 240.57 kB gzip across JavaScript chunks. The current exact report is 776,738 raw bytes and 241,220 gzip bytes: approximately +4.93 kB raw (+0.64%) and +0.65 kB gzip (+0.27%). Vendor, editor, and icon chunks are effectively unchanged; the increase is in the application chunk that contains the new capability boundaries and measurement hooks. This sub-one-percent aggregate increase is accepted because the structural refactor removes the global workflow context, the build emits no chunk-size warning, and the production-isolation check proves the WDIO bridge is absent.

The Phase 1 baseline did not contain a reproducible large-fixture startup or editor-input measurement, so it cannot support an honest before/after latency percentage. The current versioned fixture and three-sample runner report establish the forward comparison point. Linux timing acceptance remains provisional until reports exist from `ubuntu-24.04-github-x64`; editor input remains observational until that history supports a stable budget.

Deferred follow-up work:

1. Accumulate comparable Linux reports and reassess the 3-second budget after enough named-runner history exists.
2. Pagination or virtualization inside Testware/Finding views if real Sessions become too large after the user explicitly opens those views.
3. A formal startup state machine if future startup phases become harder to reason about than the current refs/tests.

## What Happens On Startup

### Backend Setup

`main` builds the Tauri app, creates the app data directory, opens `qa-scribe.sqlite`, constructs `SessionService`, and stores it in managed app state (`src-tauri/src/main.rs:24-31`). `Database::open` creates a single rusqlite connection and calls `initialize` (`crates/qa-scribe-core/src/storage/mod.rs:12-15`).

`initialize` always:

1. Reads `PRAGMA user_version`.
2. Enables foreign keys and busy timeout.
3. Sets WAL and `synchronous=NORMAL`.
4. Executes the schema DDL batch.
5. Runs migrations when the schema version is old.
6. Runs `assert_no_foreign_key_violations` only when migrations ran, before stamping `user_version` current (`crates/qa-scribe-core/src/storage/mod.rs:68-122`).

`assert_no_foreign_key_violations` prepares and executes unqualified `PRAGMA foreign_key_check` (`crates/qa-scribe-core/src/storage/mod.rs:415-430`). SQLite documents that `PRAGMA foreign_key_check` without a table argument checks the database, while `PRAGMA foreign_key_check(table-name)` checks only constraints created by that table's `REFERENCES` clauses. The full-resolution follow-up keeps that full check on migration opens, but skips it for ordinary current-schema opens so startup does not scan all foreign-key-covered rows every time.

`SessionService::new` also calls `fail_orphaned_running_ai_runs` (`crates/qa-scribe-core/src/services/session_service.rs:24-27`). That method updates all rows where `ai_runs.status = 'running'` (`crates/qa-scribe-core/src/services/session_service/generation.rs:193-205`). The first startup-performance implementation slice adds a partial `idx_ai_runs_running_status` index on `ai_runs(status) WHERE status = 'running'` so the orphan sweep can target the small running subset instead of historical AI Runs.

### Frontend Boot

The React controller starts with `busyAction = 'boot'`. `boot` awaits settings and `listRecentSessions(50)`, then opens the newest Session with `openSessionNoteState` before clearing busy state (`frontend/src/app/useAppController.ts`, `frontend/src/app/sessionActions.ts`).

`openSessionNoteState` reopens the Session, gets or creates the editable Note Entry, and returns Testware/Finding counts without returning Draft or Finding bodies (`crates/qa-scribe-core/src/services/session_service/sessions.rs`, `crates/qa-scribe-core/src/services/session_service/entries.rs`). The full list methods remain available, but are no longer part of initial boot:

1. `list_sessions` is now user-driven through `Load all notes`.
2. `list_drafts` runs when the Testware view or a Testware creation flow needs Drafts.
3. `list_findings` runs when the Findings view or a Finding creation flow needs Findings.
4. `list_entries` remains available for flows that need all Entries, but it is not used to find the editable boot Note Entry.

The backend `AppState` still wraps `SessionService` in a `Mutex`, and every command goes through `with_service` (`src-tauri/src/settings.rs:7-33`). Bounded boot matters because these calls remain effectively serial on the single managed service connection.

### Provider Checks

Provider status work is scheduled after Session boot with `setTimeout` and is not awaited before the boot `finally` clears busy state (`frontend/src/app/useAppController.ts:187-203`). That means LLM CLI checks are unlikely to be the primary cause of the initial boot spinner.

The scheduled boot work now runs `getProviderStatus` only. The backend Fast status path detects executable presence (`src-tauri/src/commands/providers.rs:56-69`, `src-tauri/src/commands/providers/detection.rs:118-137`). Explicit Deep refresh clears readiness and PATH caches, then performs deeper provider checks (`src-tauri/src/commands/providers.rs:30-36`). Deep detection can run provider version, model, auth, and help probes (`src-tauri/src/commands/providers/detection.rs:139-151`, `src-tauri/src/commands/providers/models.rs:81-109`, `src-tauri/src/commands/providers/models.rs:118-135`, `src-tauri/src/commands/providers/detection.rs:206-229`). Each provider subprocess probe has a 4 second timeout (`src-tauri/src/commands/providers/probe.rs:13`), and login-shell PATH probing has a 2 second timeout (`src-tauri/src/provider_command.rs:98-130`).

So provider checks are a real perceived-startup risk, especially for AI button readiness and backend responsiveness immediately after the shell appears, but they are not the best explanation for the initial boot wait.

## Scalability Risks

### High Confidence

1. **Full database integrity check on every open.** Addressed by the full-resolution follow-up: the unqualified `PRAGMA foreign_key_check` now runs after migrations, before stamping the schema current, and is skipped on ordinary current-schema opens. This keeps migration integrity coverage without making every startup proportional to all foreign-key-covered rows.
2. **Unindexed orphan AI-run sweep.** Crash recovery is correct, but the original `UPDATE ai_runs ... WHERE status = 'running'` had no status index. The first startup-performance implementation slice adds and verifies a partial running-status index, so this item is addressed for current builds while remaining relevant to old builds before migration.
3. **Unbounded boot data transfer.** Addressed by the full-resolution follow-up: boot uses a bounded recent Session list and minimal active Note state. Full Session Library, Draft bodies, and Finding bodies are explicit follow-up loads after readiness.

### Medium Confidence

1. **Derived frontend work over loaded records.** Startup no longer loads Draft/Finding bodies, so their screenshot-count parsing is not part of boot. Once a user opens Testware or Findings, counts still parse loaded record bodies (`frontend/src/app/useAppController.ts`, `frontend/src/editor/clipboardExport.ts:51-68`). Consider pagination, virtualization, or stored attachment-reference counts if explicit view loads become heavy.
2. **Immediate Deep provider refresh.** Addressed by the first startup-performance implementation slice: boot now performs Fast provider status only, while Deep refresh remains explicit. Keep watching this if a future background refresh is added.
3. **Serialized backend command access.** A single `Mutex<SessionService>` is simple and safe, but it means frontend parallel calls are not actually parallel at the database layer.

### Low Confidence Or Non-Causes

1. **Debug Specta export.** Debug builds export bindings before setup (`src-tauri/src/main.rs:16-22`). This can affect `cargo tauri dev`, but not production startup and not database-growth behavior.
2. **Settings load.** Settings are a single primary-key lookup (`crates/qa-scribe-core/src/services/session_service/settings.rs:24-40`). This is unlikely to be material by itself.

## Phased Improvement Plan

### Phase 0 - Measure Before Changing Behavior

Goal: turn startup concerns into repeatable numbers before optimizing.

1. Add lightweight timing logs around backend setup: app data directory creation, `Database::open`, schema DDL, migration, `foreign_key_check`, orphan AI-run sweep, and state registration. Implemented in the first startup-performance slice with `qa-scribe startup ... elapsed_ms=...` backend log lines.
2. Add frontend timing marks for boot start, settings loaded, Sessions loaded, first Session opened, first paint after boot, provider Fast status complete, and provider Deep refresh complete. Implemented in the first startup-performance slice with `qa-scribe:startup:` performance marks and `qa-scribe startup ...` measures.
3. Add a synthetic large-data fixture or integration helper with many Sessions, a large latest Session, many Drafts/Findings, and many AI Runs. Implemented by `generate_startup_fixture` and the built-app benchmark profile.
4. Capture process-cold and warm startup numbers for the large fixture. Implemented locally and wired as a named-runner CI report; the Linux history begins with the first workflow execution carrying this change.
5. Define budgets in `docs/quality-scenarios.md`, for example: shell visible within a small fixed budget, initial Session Library bounded by recent-session limit, and provider Deep refresh not blocking boot. Implemented in the first startup-performance slice.

Validation:

```bash
cargo test -p qa-scribe-core --test session_storage
bun run --cwd frontend test src/app/useAppController.test.ts
```

### Phase 1 - Low-Risk Database And Provider Wins

Goal: remove avoidable startup work while preserving crash recovery and integrity guarantees.

1. Add a migration for a partial index on running AI Runs, such as `CREATE INDEX ... ON ai_runs(status) WHERE status = 'running'`, or a normal `ai_runs(status)` index if partial indexes are not desirable. Implemented in the first startup-performance slice with `idx_ai_runs_running_status`.
2. Keep `fail_orphaned_running_ai_runs`, but measure it and verify it uses the new index with `EXPLAIN QUERY PLAN` in a focused test or benchmark helper. Implemented in the first startup-performance slice.
3. Stop running full `PRAGMA foreign_key_check` on every normal open. Implemented by running the full check only after migrations and skipping it for ordinary current-schema startup.
4. Keep Fast provider status after boot, but stop automatic Deep refresh on every boot. Move Deep refresh behind the Settings refresh button or a clearly backgrounded, cancellable task with a short cache. Implemented in the first startup-performance slice by keeping boot to Fast status and preserving manual Deep refresh.

Validation:

```bash
cargo test -p qa-scribe-core --test session_storage
cargo test -p qa-scribe-tauri providers
bun run --cwd frontend test src/app/useAppController.test.ts
```

### Phase 2 - Bounded Initial Readiness

Goal: make initial UI readiness independent of total Session Library and mostly independent of active Session size.

1. Add a backend command for a bounded recent Session list, for example `list_recent_sessions(limit)`, and use it during boot. Implemented with `list_recent_sessions(limit)` and `listRecentSessions(50)`.
2. Keep full Session search or full library browsing as an explicit follow-up load, not part of initial boot. Implemented with the `Load all notes` action.
3. Split `openSession` hydration by need:
   - Always load the active Session and editable Note Entry needed for the Notes view. Implemented through `open_session_note_state`.
   - Load Drafts only when the Testware view or creation flow needs them. Implemented with lazy `loadDraftsForSession`.
   - Load Findings only when the Findings view or creation flow needs them. Implemented with lazy `loadFindingsForSession`.
4. Avoid automatically creating or hydrating expensive records before the shell can render. Implemented: the backend creates/loads only the editable Note Entry; Draft/Finding bodies are deferred.
5. Preserve autosave and active-session behavior while changing load order. Implemented with regression tests for pending-edit flush, failed-flush no-switch behavior, stale lazy-load invalidation, and generated-record merge preservation.

Validation:

```bash
bun run --cwd frontend test src/app/useAppController.test.ts
cargo test -p qa-scribe-core --test session_storage
cargo test -p qa-scribe-tauri bindings_are_up_to_date
```

### Phase 3 - Frontend Work Deferral

Goal: avoid doing record-size work for data the user is not viewing.

1. Compute Draft and Finding screenshot counts lazily per active view or per visible record instead of for every loaded record in the controller. Implemented for startup by deferring Draft/Finding body loads until their views or creation flows need them.
2. Consider storing attachment-reference counts in metadata if counting screenshots remains expensive and needs to be shown frequently.
3. Paginate or virtualize Testware and Finding record collections if large Sessions are expected.
4. Keep the Notes view lightweight: avoid making note keystrokes recompute unrelated Draft/Finding derived state.

Validation:

```bash
bun run --cwd frontend test
bun run --cwd frontend build
```

### Phase 4 - Startup Architecture Hardening

Goal: keep startup fast by design, not by accident.

1. Introduce a formal startup state machine: backend ready, shell visible, recent Sessions loaded, active Note loaded, provider Fast status loaded, provider Deep status loaded.
2. Make provider Deep refresh cancellable and observable. The current process-probe timeout loop already kills and waits for timed-out children (`src-tauri/src/commands/providers/probe.rs:79-113`); reuse that discipline for any background refresh orchestration.
3. Decide whether the single `Mutex<SessionService>` remains the right boundary. It is simple and safe, but if startup work remains serialized after data loading is bounded, consider a dedicated read-only connection or queued background worker. Do this only with measured evidence, because a second SQLite connection adds concurrency complexity.
4. Add startup performance scenarios to release checks or a local pre-release checklist.

Validation:

```bash
bun run verify:fast
cargo test --workspace
```

## Implemented Resolution Summary

The completed startup fix includes:

1. Timing instrumentation and startup budgets.
2. Indexed orphan AI Run recovery.
3. Current-schema startup skips the full unqualified foreign-key scan; migrations still validate before schema stamping.
4. Automatic provider boot is Fast-only; Deep provider refresh is explicit.
5. Boot loads a bounded recent Session list and minimal active Session Note state.
6. Full Session Library, Draft bodies, and Finding bodies load only after explicit user action or view/action need.
7. Regression tests cover the bounded boot path, autosave preservation, lazy record loads, stale-load invalidation, generated-record merge preservation, bindings, and storage startup contracts.

The startup path is now fixture-backed and budgeted, and the first bundle comparison is reviewed above. The remaining work is to accumulate the named Linux timing history and add pagination, virtualization, or a formal startup state machine only if measured data justifies that complexity.

## Evidence Sources

Local code:

1. `src-tauri/src/main.rs:16-31`
2. `src-tauri/src/settings.rs:7-33`
3. `crates/qa-scribe-core/src/storage/mod.rs`
4. `crates/qa-scribe-core/src/services/session_service.rs:24-27`
5. `crates/qa-scribe-core/src/services/session_service/generation.rs:193-205`
6. `crates/qa-scribe-core/src/services/session_service/sessions.rs`
7. `crates/qa-scribe-core/src/services/session_service/entries.rs`
8. `crates/qa-scribe-core/src/services/session_service/drafts.rs:48-59`
9. `crates/qa-scribe-core/src/services/session_service/findings.rs:40-51`
10. `frontend/src/app/useAppController.ts`
11. `frontend/src/app/sessionActions.ts`
12. `frontend/src/app/recordActions.ts`
13. `frontend/src/app/generationActions.ts`
14. `frontend/src/editor/clipboardExport.ts:51-68`
15. `frontend/src/views/RecordCollectionView.tsx:127-191`
16. `src-tauri/src/commands/providers.rs:24-36`, `56-69`
17. `src-tauri/src/commands/providers/detection.rs:118-151`, `206-229`
18. `src-tauri/src/commands/providers/models.rs:81-109`, `118-135`
19. `src-tauri/src/commands/providers/probe.rs:13`, `79-113`
20. `src-tauri/src/provider_command.rs:98-130`

External documentation:

1. Tauri splashscreen docs: heavy backend setup can be spawned non-blockingly from setup so windows can be created while it executes.
2. Tauri `async_runtime` docs: Tauri exposes Tokio-backed `spawn` and `spawn_blocking` for setup hooks and commands.
3. SQLite `PRAGMA foreign_key_check` docs: the unqualified form checks the database; the table-name form narrows the checked constraints.
4. SQLite foreign-key docs: child-key indexes are not required but are usually beneficial; without them, FK-related checks can require linear scans.
5. rusqlite README: the `bundled` feature compiles and links SQLite into apps that control their own database.
6. Rust `std::process::Command` and `Child` docs: CLI probing creates child processes, and callers must wait or reap children.

## Validation Run During Review And Implementation

```bash
bun run package:check
cargo test -p qa-scribe-core --test session_storage
bun run --cwd frontend test src/app/useAppController.test.ts
bun run --cwd frontend test src/App.test.tsx
bun run bindings:check
bun run verify:fast
```

Results during implementation: `session_storage` passed 41 tests after storage and backend API changes; `useAppController.test.ts` passed 18 tests after bounded boot and lazy loading changes; `App.test.tsx` passed 7 workflow tests; `bindings:generate` and `bindings:check` passed for the new command surface. Final broad validation uses `bun run verify:fast`.
