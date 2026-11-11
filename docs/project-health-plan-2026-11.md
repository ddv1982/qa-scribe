# Project health plan (2026-11)

Goal: make each change cheaper and safer. No new features until P1 to P3 are done.

Evidence this plan rests on (2026-11-11):

- Checks you can't trust: three native E2E checks fail locally but pass on CI (clipboard, chat-tool-authorization, "Native keys require exactly one visible window"). CI has two known flakes: the AppShell.copy timeout and the Tiptap teardown "window is not defined".
- Plan sprawl: 64 entries in `docs/`. Several plans were abandoned with most boxes open:
  - ask-ai-phased: 254 open
  - maintainability-program: 219 open
  - cli-model-management: 175 open
  - manual-formats-chat-attachments: 153 open
  - ask-ai-conversation-isolation: 145 open
  - adoption-and-ci: 123 open
  - tsc-rs-only: 77 open
  - Correction (2026-11-11, docs inventory): none of these plans was abandoned. Each one shipped (the CHANGELOG and merged PRs confirm it), but its boxes were never ticked. The real problem is plans that are never closed out, not unfinished work. P2.3 therefore collects only the few genuine leftovers.
- Ask AI has been redesigned at least seven times (phased, minimal, UX reset, isolation, notes, notes-unified, chat tools) without a single target spec.
- Files at or near the 500-line cap:
  - `useAppController.ts` (500)
  - `sessionChat.actions.ts` (493)
  - `sessionActions.writes.ts` (464)
- 112 tags in 5 months, with no definition of 1.0.

## P1. Trustworthy checks

- [x] P1.1 Reproduce the clipboard E2E failure locally and record the root cause here. Result: on a Wayland desktop, `xvfb-run` sets DISPLAY but GTK prefers the inherited WAYLAND_DISPLAY, so the app window opened on the real desktop. The only visible X11 window was the Xvfb root, with an empty name. CI has no Wayland.
- [x] P1.2 Fix it, or gate it on a named environment requirement that reports SKIP with the reason, never a silent pass. Fixed in `scripts/run-e2e.mjs`: every Linux invocation gets GDK_BACKEND=x11 and loses WAYLAND_DISPLAY. A process test covers it.
- [x] P1.3 Same as P1.1 and P1.2 for chat-tool-authorization. Same root cause, same fix.
- [x] P1.4 Same as P1.1 and P1.2 for "Native keys require exactly one visible window". Same root cause, same fix. native-close also needed WAYLAND_DISPLAY removed, even though it already had GDK_BACKEND=x11. Local suite: 6 of 22 invocations failed before, 22 of 22 pass after.
- [ ] P1.5 Reproduce the AppShell.copy timeout (repeat runs under CI-like parallelism) and fix the cause, not the timeout value. Not reproduced: 10 repeated local runs of AppShell.copy and the other AppShell editor tests (23 of 23 each time), a full vitest run while the native E2E ran alongside, and no match in the last 40 CI run logs. Nothing to fix without a reproduction; reopen if it recurs.
- [ ] P1.6 Remove the Tiptap teardown "window is not defined" error, so the vitest output has no errors. Not reproduced: the same runs printed no teardown error.
- [ ] P1.7 Check: `verify:fast`, `cargo test` and the full native E2E are green locally 3 runs in a row, and CI is green on 5 consecutive main runs. Local part done: `verify:fast` and `cargo test` are green, and the full native E2E passed 22 of 22 three runs in a row. The 5 consecutive main CI runs can only be counted after merge.

## P2. Docs that describe today

- [x] P2.1 Classify every `docs/` plan as done, abandoned or live, in a table in `docs/archive/README.md`. Result: all done, none abandoned.
- [x] P2.2 Move the classified done or abandoned plans and their evidence files (`docs/research`, `docs/verification`, `docs/superpowers`, the release-vX plans) into `docs/archive/`. `verification/check-inventory.md` is still living, so it moved to `docs/check-inventory.md` instead.
- [x] P2.3 Copy any still-wanted item from an abandoned plan into one short `docs/backlog.md`. Everything else stays archived.
- [x] P2.4 Write `docs/architecture.md` (one page): layers, the chat lifecycle, the storage model, and where each concern lives.
- [x] P2.5 Check: top-level `docs/` holds only living docs, and `rg` finds no broken links to moved files. Result: 74 broken links before and after the move, all absolute machine paths or gitignored `artifacts/`; no new ones.

## P3. One Ask AI target spec (design before code)

- [x] P3.1 Write `docs/ask-ai-spec.md`, one spec for the Notes, Test cases and Findings panels:
  - how you open it and what context it shows;
  - the reply, proposal, apply and undo flow;
  - where options live;
  - the empty, error and busy states.
- [x] P3.2 Add a visual mockup per panel state (an HTML artifact) for your review. Published as a private artifact and committed as `docs/design/ask-ai-spec/mockup.html`.
- [ ] P3.3 Gate: you approve the spec. Implementation items get added here only after approval. Waiting on the user's approval.
- [x] P3.4 Gap list: each spec point marked met or not met against the current UI, with a screenshot. Ten gaps (G1 to G9, plus the Jira line), with native E2E screenshots.
- [x] P3.5 Delete the superseded Ask AI plan and design docs (moved in P2). Deviation: archived under `docs/archive/` in P2 instead of deleted. Git history keeps them either way, and the archive index still answers "when did X ship".

## P4. Structure under the size cap

- [x] P4.1 Split `useAppController.ts` into its navigation, notes/session and chat parts with no behaviour change. Target at most 300 lines. Result: 500 to 291 lines across 9 new `useAppController.*.ts` hooks. The AppController type and keys are unchanged, checked by a temporary exact-type and runtime-key comparison.
- [x] P4.2 Same for `sessionChat.actions.ts`. Result: 493 to 342 lines, with `sessionChat.composer.ts` and `sessionChat.handoff.ts` as moves. Deviation: 300 was not reached. The next seam (activate/dispose/retire) shares four mutable variables with the engine, so moving it means a new state object, not a move.
- [x] P4.3 Check: the frontend tests, native E2E and `code-size` pass, and the diff contains moves only (reviewed with `git diff --color-moved`). Result: vitest 146 files and 1359 tests, `code-size` 0 failures, and the native E2E 22 of 22 twice on the final code.

## P5. Chat subsystem: delete what no path uses

- [x] P5.1 Inventory the chat concepts:
  - contract v2 and v3;
  - response purposes;
  - refinement record kinds;
  - question intents (including the Draft Jira path, which still exists in core and frontend);
  - for each, the UI entry point that reaches it, or "none".
  - Result: all 14 chat Tauri commands are called from the UI, and every purpose, record kind, patch and action is live. With no UI path: the v1 "Legacy" response contract, the `RefineRecord` and `DraftJira` intents, and the frontend `onRefine`/`onDraftJira` handlers.
- [x] P5.2 Decision per "none" item: delete or keep, with a reason. (No separate approval gate under full-stop; the unmerged PR is the gate.)
  - Delete the v1 contract. No release ever stored one: #84 shipped in v0.8.22 already writing v2, and the only v1 rows ever were made by a test that drops the immutability trigger.
  - Delete the frontend `onRefine`, `onDraftJira` and `legacySend`. Nothing calls them, tests included.
  - Keep the core `RefineRecord`/`DraftJira` intents, `setIntent`, `ChatResponsePurpose::JiraDrafting` and the v2 refinement path. Releases v0.8.22 to v0.8.34 stored these states (`jira_drafting` contracts, `refine_record`/`draft_jira` composer intents), loading a chat deserializes them, and about 25 test files use the intents to build those legacy states. Replacing that seam means 300 to 500 lines of test rework for no user-visible change.
- [x] P5.3 Delete the approved items. Check: `cargo test`, the bindings check, frontend tests and E2E are green. Result: cargo 18 suites with 0 failed, the bindings check passes, vitest 1359 of 1359, the fixture and script tests 577 of 577, and the native E2E 22 of 22 twice. A new test failed before the deletion and passes after.

## P6. Release policy

- [x] P6.1 Write the 1.0 criteria into `docs/releasing.md`.
- [x] P6.2 Add a batching rule (for example, release on a milestone or weekly rather than after each merged PR).
