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

- [ ] P1.1 Reproduce the clipboard E2E failure locally and record the root cause here.
- [ ] P1.2 Fix it, or gate it on a named environment requirement that reports SKIP with the reason, never a silent pass.
- [ ] P1.3 Same as P1.1 and P1.2 for chat-tool-authorization.
- [ ] P1.4 Same as P1.1 and P1.2 for "Native keys require exactly one visible window".
- [ ] P1.5 Reproduce the AppShell.copy timeout (repeat runs under CI-like parallelism) and fix the cause, not the timeout value.
- [ ] P1.6 Remove the Tiptap teardown "window is not defined" error, so the vitest output has no errors.
- [ ] P1.7 Check: `verify:fast`, `cargo test` and the full native E2E are green locally 3 runs in a row, and CI is green on 5 consecutive main runs.

## P2. Docs that describe today

- [x] P2.1 Classify every `docs/` plan as done, abandoned or live, in a table in `docs/archive/README.md`. Result: all done, none abandoned.
- [x] P2.2 Move the classified done or abandoned plans and their evidence files (`docs/research`, `docs/verification`, `docs/superpowers`, the release-vX plans) into `docs/archive/`. `verification/check-inventory.md` is still living, so it moved to `docs/check-inventory.md` instead.
- [x] P2.3 Copy any still-wanted item from an abandoned plan into one short `docs/backlog.md`. Everything else stays archived.
- [x] P2.4 Write `docs/architecture.md` (one page): layers, the chat lifecycle, the storage model, and where each concern lives.
- [x] P2.5 Check: top-level `docs/` holds only living docs, and `rg` finds no broken links to moved files. Result: 74 broken links before and after the move, all absolute machine paths or gitignored `artifacts/`; no new ones.

## P3. One Ask AI target spec (design before code)

- [ ] P3.1 Write `docs/ask-ai-spec.md`, one spec for the Notes, Test cases and Findings panels:
  - how you open it and what context it shows;
  - the reply, proposal, apply and undo flow;
  - where options live;
  - the empty, error and busy states.
- [ ] P3.2 Add a visual mockup per panel state (an HTML artifact) for your review.
- [ ] P3.3 Gate: you approve the spec. Implementation items get added here only after approval.
- [ ] P3.4 Gap list: each spec point marked met or not met against the current UI, with a screenshot.
- [ ] P3.5 Delete the superseded Ask AI plan and design docs (moved in P2).

## P4. Structure under the size cap

- [ ] P4.1 Split `useAppController.ts` into its navigation, notes/session and chat parts with no behaviour change. Target at most 300 lines.
- [ ] P4.2 Same for `sessionChat.actions.ts`.
- [ ] P4.3 Check: the frontend tests, native E2E and `code-size` pass, and the diff contains moves only (reviewed with `git diff --color-moved`).

## P5. Chat subsystem: delete what no path uses

- [ ] P5.1 Inventory the chat concepts:
  - contract v2 and v3;
  - response purposes;
  - refinement record kinds;
  - question intents (including the Draft Jira path, which still exists in core and frontend);
  - for each, the UI entry point that reaches it, or "none".
- [ ] P5.2 Decision per "none" item: delete or keep, with a reason. Approval gate before deleting.
- [ ] P5.3 Delete the approved items. Check: `cargo test`, the bindings check, frontend tests and E2E are green.

## P6. Release policy

- [ ] P6.1 Write the 1.0 criteria into `docs/releasing.md`.
- [ ] P6.2 Add a batching rule (for example, release on a milestone or weekly rather than after each merged PR).
