# Refactoring Roadmap

Date: 2026-07-12. Baseline: v0.7.10.

## Decision

Continue the Rust/Tauri rebuild incrementally. Do not start another ground-up rewrite.

The current architecture already matches ADR 0009: the Rust core owns domain and persistence behavior, the Tauri crate owns native integration and process execution, and React talks through generated Specta bindings. Replacing that foundation would add migration risk without removing the remaining hotspots, which are mostly oversized modules and coordination logic inside otherwise-correct boundaries.

Each slice must preserve Tauri command names, the SQLite schema, generated binding compatibility, and the product language in `CONTEXT.md`. Use characterization tests before moving behavior and keep `bun run verify:fast` green between slices.

## Current Shape

- `qa-scribe-core` is the domain boundary: validation, storage, attachments, generation workflows, provider abstractions, and stream parsing.
- `qa-scribe-tauri` is the native adapter: commands, jobs, provider probing, process lifecycle, clipboard, files, and settings paths.
- `frontend` is the presentation and interaction layer: generated IPC bindings, rich-text editing, workflows, and view composition.
- `qa-scribe-app` is the headless smoke path through the core.

The earlier improvement plan was written against v0.4.24. By v0.7.10, its major cross-boundary recommendations have landed: generated bindings, structured command errors, workflow ownership in core, per-provider stream parsers, bounded startup, provider cache refresh, shared HTML utilities, DOMPurify, and consolidated record views.

## Work Queue

### 1. Decompose the frontend controller

Status: production decomposition complete; test-file organization remains.

`useAppController.ts` was above the project's 500-line split threshold and mixed record hydration, startup, close protection, derived view data, and action composition.

- Done: extract Draft/Finding lazy hydration, stale-load invalidation, dirty-record merge protection, and record refs into `useRecordHydration`.
- Done: extract startup and provider-readiness coordination into `useAppStartup` without hiding a generic mount effect.
- Done: extract pending-change and native-close protection into `usePendingChangeProtection`.
- Reassessed: keep the remaining independent UI state as `useState`. Workflow transitions already live in focused action modules, so a reducer would centralize unrelated state without making transitions more explicit.
- Done: split the controller characterization test by behavior (workflows/hydration, autosave/close protection, lifecycle/reconciliation) behind a shared Tauri test harness while retaining all 127 frontend tests.

React's current guidance supports focused custom Hooks for concrete stateful use cases and recommends stable callbacks for functions returned from a custom Hook:

- <https://react.dev/learn/reusing-logic-with-custom-hooks>
- <https://react.dev/reference/react/useCallback>

### 2. Split Rust modules by responsibility

Status: initial responsibility splits complete.

Keep public module APIs stable and move private implementation details first.

- Done: move managed-image preservation out of `generation/response.rs`; the response module remains the stable public facade for envelope handling and sanitization.
- Done: move Generation Context creation out of `services/session_service/generation.rs`; AI Run transitions and generated-record completion remain together because they share transaction helpers and transition invariants.
- Done: move schema definition out of `storage/mod.rs`; `Database` remains the public facade for connection, transaction, and migration orchestration.
- Move the remaining large inline generation tests into responsibility-aligned sibling test modules.

This follows Rust's module guidance: group related behavior, separate distinct features, and keep implementation details private behind a small public surface:

- <https://doc.rust-lang.org/book/ch07-00-managing-growing-projects-with-packages-crates-and-modules.html>
- <https://doc.rust-lang.org/stable/book/ch07-05-separating-modules-into-different-files.html>

### 3. Tighten the Tauri trust boundary

Status: audited and guarded.

- Done: audit `src-tauri/capabilities/default.json` against the commands actually used by the main window.
- Already present and verified: explicit `tauri_build::AppManifest::commands` allowlist.
- Done: add `bun run tauri:commands:check` to prevent drift across the build manifest, Specta handler, bindings, and permissions.
- Verify clipboard, file import, and provider-process inputs at both the generated IPC boundary and the Rust implementation boundary.
- Done: record the Isolation Pattern decision and revisit conditions in `docs/tauri-threat-model.md`.

Tauri documents IPC as the bridge between the untrusted WebView and unrestricted Rust core, and recommends narrow capabilities and explicit command exposure:

- <https://v2.tauri.app/security/>
- <https://v2.tauri.app/security/capabilities/>

### 4. Make the verification structure match the architecture

Status: structural verification complete; performance measurement remains conditional follow-up.

- Add focused tests for extracted hooks and pure merge/transition functions when doing so makes failure localization better than the controller-level tests alone.
- Done: keep controller-level Session/autosave/reopen characterization and the `qa-scribe-app` headless generation path with a fake executor, persisted Draft/Finding output, evidence links, and managed attachments.
- Deferred by design: add the large-data startup fixture and record cold/warm baselines before undertaking any further startup optimization. This is a measurement prerequisite, not part of the completed structural refactor.
- Introduce performance work only after a measured budget fails.

## Slice Definition of Done

Every refactor slice should meet all of these:

1. Public behavior and boundary names remain unchanged, or the change has its own explicit product decision.
2. A characterization or focused regression test covers the moved behavior.
3. No new lint suppression is added without a narrow explanation.
4. Maintained files move toward the size guidelines without creating generic grab-bag modules.
5. `bun run verify:fast` passes; run the full `bun run verify` for boundary, dependency, release, or packaging changes.

## Stop Conditions

Pause and write an ADR before changing the database ownership model, replacing Tauri/React, introducing a server or cloud dependency, changing provider authentication assumptions, or renaming authoritative domain concepts. Those are architecture or product changes, not refactors.
