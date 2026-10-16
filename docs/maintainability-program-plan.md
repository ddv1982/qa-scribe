# QA Scribe maintainability plan

Delegation, lifecycle, isolation, history, and capability fallbacks follow the installed runtime contract in the installed Poteto Mode skill.

Make provider changes easier to verify and make Note write ownership easier to trace.
Preserve testers' Notes, managed Evidence, permission choices, and optional AI workflow.
Deliver P01, then P02 and P03 for providers. Deliver P04 after baseline recovery characterization, then P05 and P06 for frontend ownership. P04 has no code dependency on the backend replay reader.
The operator authorized implementation and a final release on 2026-10-16. Record actual phase and release receipts in `docs/verification/maintainability-execution.md`.
Read the [investigation](investigations/2026-10-16-maintainability-and-t3code.md) for evidence and rejected alternatives.

This is the original proposal. The [execution reconciliation](verification/maintainability-plan-reconciliation.md) records completed work, procedural substitutions, and the remaining release gates. Historical boxes are not claims of completion.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. A nested box is a sub-step of the box above it. The body is a how-to. The appendices explain and record.

Execute each approved slice under the installed `poteto-mode/playbooks/refactoring.md`. Route a reproduced defect through `playbooks/bug-fix.md`. The parent integrates and opens PRs. The operator has authorized execution and final release after success. The parent prepares and integrates verified PRs through the protected branch and existing release workflow.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State this plan and protocol to the operator. Begin implementation only after an explicit request to execute a named scope.
- [ ] If the operator requests a standing autonomous program, create a goal that names this plan, P01 through P06, the verification rule, operator merges, and completion evidence. Otherwise keep ordinary work in the current task.
- [ ] Read the installed execution playbook, runtime contract, swarm, control-ui, technical-writing, unslop, deslop if available, and opening-a-pr instructions at execution start.
- [ ] Use `git show origin/main:docs/maintainability-program-plan.md` after this plan lands. Read plugin skills from their installed paths. They are not files in QA Scribe's trunk.
- [ ] Skip an hourly audit and heartbeat for ordinary per-PR work. Arm recurring work only when the operator requests that lifecycle.
- [ ] For a requested standing program, record a queue table at each supported audit tick with PR, exact SHA, owner, proof, blocker, and next action.
- [ ] On a hold request, stop writers and reconcile their actual filesystem and process state.

### Spawn owners

- [ ] Use one owner for a bounded PR. Inherit the parent's model and effort unless an installed profile provides a validated pair.
- [ ] Start P01 first. Start P02 after P01. P04 can run independently after baseline recovery characterization. Start P03 after P02, P05 after P04, and P06 after P05.
- [ ] Give concurrent writers separate worktrees. P02 and P03 own core protocol and Tauri execution. P04 through P06 own the named frontend files.
- [ ] Start each worktree from committed prerequisites. Do not assume uncommitted edits are copied into a delegated task.
- [ ] Stop any PR that changes interaction behavior at the operator review gate with screenshots and a video.

### PR mechanics, for every PR

- [ ] Resolve the forge from this repository's origin. Use `gh` if it resolves the repository. Do not require Graphite for this dependency graph.
- [ ] Record baseline SHA, changed files, invariants, and focused checks before edits.
- [ ] Apply deslop before commit and no-comments before review. Keep application changes inside the PR's stated scope.
- [ ] Run `bun run verify:fast`, the focused checks, and the complete `bun run verify` before reporting merge-ready.
- [ ] Run built-app E2E for affected workflows through the existing WebdriverIO and Tauri provider. Keep test permissions absent from production.
- [ ] Open the authorized PR with the resolved forge. Link its full URL through T3 Code `link_pull_request` when available. Confirm registration before handoff.
- [ ] Assess review findings against reproduced behavior. Fix proven defects and explain dismissed findings with evidence.

### Verdict and merge, for every PR

- [ ] At the exact head SHA, run the unit gate, the ten live scenarios below, and the performance check. Use isolated environments for concurrent live lanes.
- [ ] Obtain two independent read-only audits with different focuses. Audit protocol and resource ownership for P01 through P03. Audit persistence and lifecycle ownership for P04 through P06.
- [ ] Use the configured fast profile for live lanes if observable. Otherwise inherit the parent and report that fallback. Queue lanes when capacity is limited.
- [ ] Accept a clean verdict only when every required lane passes. Record missing native control or provider credentials as blocked proof, not success.
- [ ] After a code change, rerun affected proof at the new head and record what remains valid. Follow the installed execution playbook for broader revalidation.
- [ ] The parent reports merge-ready with the exact SHA. The operator merges. Do not arm automatic merging from this planning request.

### Boot recipe, for every live lane

Each live lane uses a disposable checkout, app-data root, provider fixtures, and artifact directory at the PR head.
Use the installed control-ui skill with this repository's existing WebdriverIO and Tauri workflow. A browser-only mock is not native proof.

- [ ] Fetch the authorized PR branch and check out its exact head in an isolated worktree. Install pinned dependencies with the repository setup workflow.
- [ ] Run `bun run e2e` through the documented Linux Xvfb workflow or supported native host. Use `QA_SCRIBE_E2E_SPEC` to select added scenarios.
- [ ] Add missing workflow scenarios in the PR. Drive input through WebdriverIO roles or stable locators. Use backend logs only as read-only diagnostics.
- [ ] Pair each internal wire-order or React race claim with its deterministic unit or replay receipt at the same SHA. Drive the corresponding user workflow natively. A screenshot proves only the visible result, not internal ordering.
- [ ] Save each screenshot under `artifacts/maintainability/<pr-id>/worker-<n>/`. Save status, process cleanup evidence, and the execution metadata alongside it.
- [ ] Confirm production isolation with `bun run e2e:isolation`. Leave authenticated live-provider checks opt-in and label each absent compatibility cell.

## Extend the provider replay corpus (P01)

**Depends on.** None.

**Files.**

- [ ] Edit or add behavior-owned files under `crates/qa-scribe-core/src/ai/chat_protocol/tests/`.
- [ ] Edit or add behavior-owned files under `src-tauri/src/commands/ai/chat_duplex/tests/`.
- [ ] Edit or add behavior-owned files under `e2e/fixtures/`.

**Build.**

- [ ] Inventory the existing fixtures before adding a replay reader. Record each covered transition and missing interleaving.
- [ ] Define a test-only transcript with provider, protocol, CLI version, scenario, expected outbound frames, inbound frames, and named release points.
- [ ] Reuse the current fake executables. Add a shared reader only when two existing suites can use it without increasing fixture complexity.
- [ ] Add exact outbound assertions for opaque permission IDs, deny replies, terminal output, foreign identities, and unsupported requests.
- [ ] Keep captured account data out of fixtures. Add synthetic unknown fields and malformed required fields.
- [ ] Record the CLI compatibility floor separately for catalog, one-way generation, and duplex Chat. Leave missing live cells visibly unverified.

**You see.**

- [ ] The replay fails when an outbound permission reply, identity, or terminal outcome differs from the expected fixture.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `cargo test -p qa-scribe-core ai::chat_protocol` and `cargo test -p qa-scribe-tauri commands::ai::chat_duplex`. Add a negative control that changes one expected outbound frame and proves the replay fails.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe.

- [ ] Lane 1. Codex completion. Save `artifacts/maintainability/P01/worker-1/result.png`. Pass when one final answer is persisted.
- [ ] Lane 2. Claude completion. Save `artifacts/maintainability/P01/worker-2/result.png`. Pass when the final snapshot replaces partial text.
- [ ] Lane 3. Copilot completion. Save `artifacts/maintainability/P01/worker-3/result.png`. Pass when the active Session receives the answer.
- [ ] Lane 4. Permission approval. Save `artifacts/maintainability/P01/worker-4/result.png`. Pass when the exact offered once-only option is sent.
- [ ] Lane 5. Permission denial. Save `artifacts/maintainability/P01/worker-5/result.png`. Pass when the provider receives its own correlated deny reply.
- [ ] Lane 6. Cancel before initialization. Save `artifacts/maintainability/P01/worker-6/result.png`. Pass when no result is committed.
- [ ] Lane 7. Cancel with approval queued. Save `artifacts/maintainability/P01/worker-7/result.png`. Pass when no stale approval is sent.
- [ ] Lane 8. Duplicate permission request. Save `artifacts/maintainability/P01/worker-8/result.png`. Pass when the run fails visibly without another approval.
- [ ] Lane 9. Malformed provider frame. Save `artifacts/maintainability/P01/worker-9/result.png`. Pass when the error is visible and the peer is reaped.
- [ ] Lane 10. EOF with descendant pipes open. Save `artifacts/maintainability/P01/worker-10/result.png`. Pass when the run ends within the existing cleanup bound.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record process-cold and warm first paint, production JavaScript gzip size, and active provider child count after terminal state. P04 through P06 also record pending pollers after disposal.
- [ ] Probe. Run `bun run frontend:build` at each checked-out revision before `bun run startup:benchmark -- --samples 3` on the same named runner at trunk and head. Interleave trunk and head runs. Preserve each report before the next run overwrites the artifact path. Read child counts and poller counts from deterministic test receipts.
- [ ] Baseline. Record trunk values and runner class before measuring the head. No performance baseline was measured during planning.
- [ ] Rule. On `ubuntu-24.04-github-x64`, fail if cold first paint exceeds 4000 ms or any warm sample exceeds 3000 ms. Fail if provider child count after cleanup exceeds 0 or pollers after disposal exceed 0. Investigate a gzip increase above 0 bytes for P02 through P06 before acceptance. Keep local timings observational.

**Review gate.** None. P01 is not review-gated. If implementation changes an interaction, add the screenshot and video gate before merge.

**Merge.**

- [ ] Obtain the parent's clean verdict at the exact head SHA with all receipts linked.
- [ ] Resolve review findings and confirm the prerequisites have landed.
- [ ] Reconcile with current trunk and revalidate changed behavior. Hand the PR to the operator for merge.

## Give each provider its own protocol state (P02)

**Depends on.** P01.

**Files.**

- [ ] Edit or add behavior-owned files under `crates/qa-scribe-core/src/ai/chat_protocol.rs`.
- [ ] Edit or add behavior-owned files under `crates/qa-scribe-core/src/ai/chat_protocol/`.

**Build.**

- [ ] Write the data shape first. Use a provider protocol enum containing provider-owned phase enums and required identity fields.
- [ ] Keep the current ChatProtocol public facade and ChatProtocolEvent outputs. Move Copilot-only metadata and Codex-only turn identity to their owners.
- [ ] Migrate Claude first, Codex second, and Copilot third. Run the full replay corpus after each provider before continuing.
- [ ] Preserve permission FIFO, stale-request rejection, text replacement, and fail-closed handling of unsupported requests.
- [ ] Compare literal outbound frames and terminal results with P01. Remove each replaced numeric-stage implementation in the same PR.
- [ ] Do not change launch arguments, transport choice, catalog behavior, persistence, or permissions in this PR.

**You see.**

- [ ] The same replay produces the same frames, final text, permission options, and errors after the state representation changes.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `cargo test -p qa-scribe-core ai::chat_protocol` after each provider migration. Run `cargo test -p qa-scribe-tauri commands::ai::chat_duplex` after the final migration.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe.

- [ ] Lane 1. Claude initialization failure. Save `artifacts/maintainability/P02/worker-1/result.png`. Pass when no prompt is submitted after a failed initialization.
- [ ] Lane 2. Claude partial then final. Save `artifacts/maintainability/P02/worker-2/result.png`. Pass when only final authoritative text is saved.
- [ ] Lane 3. Codex thread correlation. Save `artifacts/maintainability/P02/worker-3/result.png`. Pass when a foreign thread fails visibly.
- [ ] Lane 4. Codex turn correlation. Save `artifacts/maintainability/P02/worker-4/result.png`. Pass when a foreign turn never updates the current answer.
- [ ] Lane 5. Codex unsupported elicitation. Save `artifacts/maintainability/P02/worker-5/result.png`. Pass when no approval is synthesized.
- [ ] Lane 6. Copilot Session creation. Save `artifacts/maintainability/P02/worker-6/result.png`. Pass when prompt submission follows the matching Session reply.
- [ ] Lane 7. Copilot early metadata. Save `artifacts/maintainability/P02/worker-7/result.png`. Pass when legal early commands do not fail the handshake.
- [ ] Lane 8. Copilot wrong Session. Save `artifacts/maintainability/P02/worker-8/result.png`. Pass when the run rejects the foreign update.
- [ ] Lane 9. Permission queue order. Save `artifacts/maintainability/P02/worker-9/result.png`. Pass when two sequential choices retain their original IDs.
- [ ] Lane 10. Cancel during streaming. Save `artifacts/maintainability/P02/worker-10/result.png`. Pass when the answer is not committed after cancellation.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record process-cold and warm first paint, production JavaScript gzip size, and active provider child count after terminal state. P04 through P06 also record pending pollers after disposal.
- [ ] Probe. Run `bun run frontend:build` at each checked-out revision before `bun run startup:benchmark -- --samples 3` on the same named runner at trunk and head. Interleave trunk and head runs. Preserve each report before the next run overwrites the artifact path. Read child counts and poller counts from deterministic test receipts.
- [ ] Baseline. Record trunk values and runner class before measuring the head. No performance baseline was measured during planning.
- [ ] Rule. On `ubuntu-24.04-github-x64`, fail if cold first paint exceeds 4000 ms or any warm sample exceeds 3000 ms. Fail if provider child count after cleanup exceeds 0 or pollers after disposal exceed 0. Investigate a gzip increase above 0 bytes for P02 through P06 before acceptance. Keep local timings observational.

**Review gate.** None. P02 is not review-gated. If implementation changes an interaction, add the screenshot and video gate before merge.

**Merge.**

- [ ] Obtain the parent's clean verdict at the exact head SHA with all receipts linked.
- [ ] Resolve review findings and confirm the prerequisites have landed.
- [ ] Reconcile with current trunk and revalidate changed behavior. Hand the PR to the operator for merge.

## Classify protocol failures at the existing boundary (P03)

**Depends on.** P02.

**Files.**

- [ ] Edit or add behavior-owned files under `crates/qa-scribe-core/src/ai/chat_protocol.rs`.
- [ ] Edit or add behavior-owned files under `crates/qa-scribe-core/src/ai/chat_protocol/`.
- [ ] Edit or add behavior-owned files under `src-tauri/src/commands/ai/chat_duplex.rs`.
- [ ] Edit or add behavior-owned files under `docs/provider-catalog-contract.md`.

**Build.**

- [ ] Define a small internal ProtocolError enum for invalid frame, unsupported request, provider failure, and incomplete stream.
- [ ] Keep transport and cancellation ownership in Tauri. Format bounded user messages at the existing outer boundary.
- [ ] Document accepted permission request families next to each adapter. Avoid a provider-wide approval boolean that hides unsupported forms.
- [ ] Use the current discovery error taxonomy for catalogs. Preserve source, confidence, custom models, and provider-managed Default.
- [ ] Keep Copilot server-protocol catalog probing separate from ACP Chat. Do not add a universal driver registry.
- [ ] Record duplicated runtime cleanup code and its ownership. Defer extraction to a separately scoped follow-up after replay demonstrates equivalent resource behavior. Retain separate completion policies.

**You see.**

- [ ] Unsupported input produces a stable category and bounded readable detail while the same permission protections remain active.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add category assertions to protocol tests. Run `cargo test -p qa-scribe-core ai::chat_protocol`, `cargo test -p qa-scribe-tauri commands::ai`, and `cargo test -p qa-scribe-tauri commands::providers`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe.

- [ ] Lane 1. Unsupported Codex request. Save `artifacts/maintainability/P03/worker-1/result.png`. Pass when the UI explains that the request cannot be handled.
- [ ] Lane 2. Malformed Claude reply. Save `artifacts/maintainability/P03/worker-2/result.png`. Pass when the job fails without showing protocol JSON as assistant text.
- [ ] Lane 3. Failed Copilot stop reason. Save `artifacts/maintainability/P03/worker-3/result.png`. Pass when partial text is not marked successful.
- [ ] Lane 4. Provider exit before terminal event. Save `artifacts/maintainability/P03/worker-4/result.png`. Pass when the job reports an incomplete run.
- [ ] Lane 5. Catalog unavailable. Save `artifacts/maintainability/P03/worker-5/result.png`. Pass when custom model input and Default remain usable.
- [ ] Lane 6. Invalid explicit model. Save `artifacts/maintainability/P03/worker-6/result.png`. Pass when the provider does not receive a prompt.
- [ ] Lane 7. Permission form unsupported. Save `artifacts/maintainability/P03/worker-7/result.png`. Pass when no allow reply is sent.
- [ ] Lane 8. Provider stderr overflow. Save `artifacts/maintainability/P03/worker-8/result.png`. Pass when the error remains bounded.
- [ ] Lane 9. Cancel blocked writer. Save `artifacts/maintainability/P03/worker-9/result.png`. Pass when the provider group is stopped.
- [ ] Lane 10. Success with server still alive. Save `artifacts/maintainability/P03/worker-10/result.png`. Pass when the protocol result completes and the peer is reaped.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record process-cold and warm first paint, production JavaScript gzip size, and active provider child count after terminal state. P04 through P06 also record pending pollers after disposal.
- [ ] Probe. Run `bun run frontend:build` at each checked-out revision before `bun run startup:benchmark -- --samples 3` on the same named runner at trunk and head. Interleave trunk and head runs. Preserve each report before the next run overwrites the artifact path. Read child counts and poller counts from deterministic test receipts.
- [ ] Baseline. Record trunk values and runner class before measuring the head. No performance baseline was measured during planning.
- [ ] Rule. On `ubuntu-24.04-github-x64`, fail if cold first paint exceeds 4000 ms or any warm sample exceeds 3000 ms. Fail if provider child count after cleanup exceeds 0 or pollers after disposal exceed 0. Investigate a gzip increase above 0 bytes for P02 through P06 before acceptance. Keep local timings observational.

**Review gate.** The operator reviews before merge.

- [ ] Post the changed behavior screenshots from `P03` and a 30 to 60 second video in chat. Save the video as `artifacts/maintainability/P03/review.mp4`.
- [ ] Record the operator's review of the screenshots and video. Stop at merge-ready for the operator to merge.

**Merge.**

- [ ] Obtain the parent's clean verdict at the exact head SHA with all receipts linked.
- [ ] Resolve review findings and confirm the prerequisites have landed.
- [ ] Reconcile with current trunk and revalidate changed behavior. Hand the PR to the operator for merge.

## Own recovered-generation polling for its full lifetime (P04)

**Depends on.** Baseline recovery characterization. This frontend slice has no code dependency on P01, P02, or P03.

**Files.**

- [ ] Edit or add behavior-owned files under `frontend/src/app/generationActions.ts`.
- [ ] Edit `useGenerationActions` in `frontend/src/app/generationActions.ts`.
- [ ] Edit or add behavior-owned files under `frontend/src/app/sessionChat.polling.ts`.
- [ ] Edit or add behavior-owned files under `frontend/src/app/useAppController.lifecycle.summary-recovery.test.ts`.

**Build.**

- [ ] Add behavior tests for unmount while a recovered generation is active, repeated reconciliation, and late status completion.
- [ ] Record whether current behavior fails each test before editing implementation. Treat a passing case as characterization, not a fabricated defect.
- [ ] Give generation polling one owner with duplicate suppression, stop, and dispose operations. Wire disposal to the owning React lifecycle.
- [ ] Reuse a small polling mechanism only if both callers become simpler. Keep Summary canonical adoption separate from Chat refresh.
- [ ] Ensure disposing a frontend observer does not cancel a durable backend job or erase Summary write protection.

**You see.**

- [ ] Unmounted observers stop scheduling reads. Repeated reconciliation owns at most one observer per job and preserves canonical recovery.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add lifecycle cases to generation recovery tests. Run `bun run --cwd frontend test src/app/useAppController.lifecycle.summary-recovery.test.ts src/app/useAppController.chat.recovery.test.ts src/app/useAppController.closeProtection.summaryRecovery.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe.

- [ ] Lane 1. Recover running Summary. Save `artifacts/maintainability/P04/worker-1/result.png`. Pass when the Note remains protected until canonical content is known.
- [ ] Lane 2. Reconcile twice. Save `artifacts/maintainability/P04/worker-2/result.png`. Pass when one status observer owns the job.
- [ ] Lane 3. Unmount pending poll. Save `artifacts/maintainability/P04/worker-3/result.png`. Pass when no later timer issues a read.
- [ ] Lane 4. Remount with active job. Save `artifacts/maintainability/P04/worker-4/result.png`. Pass when status recovery resumes.
- [ ] Lane 5. Late status after unmount. Save `artifacts/maintainability/P04/worker-5/result.png`. Pass when no stale UI result is adopted.
- [ ] Lane 6. Three status failures. Save `artifacts/maintainability/P04/worker-6/result.png`. Pass when recovery stops visibly without unlocking unsafe writes.
- [ ] Lane 7. Summary completes in another Session. Save `artifacts/maintainability/P04/worker-7/result.png`. Pass when the active Session is not overwritten.
- [ ] Lane 8. Chat poll disposal. Save `artifacts/maintainability/P04/worker-8/result.png`. Pass when Chat still stops its observer.
- [ ] Lane 9. Cancel recovered job. Save `artifacts/maintainability/P04/worker-9/result.png`. Pass when terminal state clears only the matching active job.
- [ ] Lane 10. Close with unresolved Summary. Save `artifacts/maintainability/P04/worker-10/result.png`. Pass when the close guard retains protection.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record process-cold and warm first paint, production JavaScript gzip size, and active provider child count after terminal state. P04 through P06 also record pending pollers after disposal.
- [ ] Probe. Run `bun run frontend:build` at each checked-out revision before `bun run startup:benchmark -- --samples 3` on the same named runner at trunk and head. Interleave trunk and head runs. Preserve each report before the next run overwrites the artifact path. Read child counts and poller counts from deterministic test receipts.
- [ ] Baseline. Record trunk values and runner class before measuring the head. No performance baseline was measured during planning.
- [ ] Rule. On `ubuntu-24.04-github-x64`, fail if cold first paint exceeds 4000 ms or any warm sample exceeds 3000 ms. Fail if provider child count after cleanup exceeds 0 or pollers after disposal exceed 0. Investigate a gzip increase above 0 bytes for P02 through P06 before acceptance. Keep local timings observational.

**Review gate.** The operator reviews before merge.

- [ ] Post the changed behavior screenshots from `P04` and a 30 to 60 second video in chat. Save the video as `artifacts/maintainability/P04/review.mp4`.
- [ ] Record the operator's review of the screenshots and video. Stop at merge-ready for the operator to merge.

**Merge.**

- [ ] Obtain the parent's clean verdict at the exact head SHA with all receipts linked.
- [ ] Resolve review findings and confirm the prerequisites have landed.
- [ ] Reconcile with current trunk and revalidate changed behavior. Hand the PR to the operator for merge.

## Make Note recovery ownership explicit (P05)

**Depends on.** P04.

**Files.**

- [ ] Edit or add behavior-owned files under `frontend/src/app/types.ts`.
- [ ] Edit or add behavior-owned files under `frontend/src/app/generationActions.ts`.
- [ ] Edit or add behavior-owned files under `frontend/src/app/useChatNoteRecovery.ts`.
- [ ] Edit or add behavior-owned files under `frontend/src/app/sessionChat.noteRecovery.ts`.
- [ ] Edit or add behavior-owned files under `frontend/src/app/sessionActions.writes.ts`.
- [ ] Edit or add behavior-owned files under `frontend/src/app/useAppController.ts`.

**Build.**

- [ ] Write the data shape first. Replace LatestNoteGenerationUndo optional-field combinations with a local discriminated union.
- [ ] Enumerate normal undo, pending canonical recovery, conflict choice, and resolved states from current tests. Preserve their distinct meaning.
- [ ] Introduce one small capability for Note write and hydration eligibility. Keep Summary conflict recovery and Chat uncertain commit distinct.
- [ ] Migrate all affected readers together. Delete duplicate eligibility predicates after equivalence is demonstrated.
- [ ] Preserve entry and Session identity, canonical reload, dirty-edit retention, and stale-write compensation. Do not change the database or serialized IPC values.
- [ ] Add transition coverage for Summary completion during Chat recovery and Session deletion with recovery pending before removing any guard.

**You see.**

- [ ] Every caller gets the same write-eligibility decision, and recovery still preserves the correct Session Note and newer local edits.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bun run --cwd frontend test src/app/useAppController.chat.recovery.test.ts src/app/useAppController.closeProtection.summaryRecovery.test.ts src/app/useAppController.autosave.recovered-summary.test.ts src/app/useAppController.sessionIntegrity.compensation.test.ts`. Add intersecting recovery cases.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe.

- [ ] Lane 1. Summary conflict choose generated. Save `artifacts/maintainability/P05/worker-1/result.png`. Pass when the chosen generated content becomes canonical.
- [ ] Lane 2. Summary conflict keep local. Save `artifacts/maintainability/P05/worker-2/result.png`. Pass when the newer local Note survives.
- [ ] Lane 3. Chat uncertain commit. Save `artifacts/maintainability/P05/worker-3/result.png`. Pass when the canonical reload precedes unlocking edits.
- [ ] Lane 4. Summary completes during Chat recovery. Save `artifacts/maintainability/P05/worker-4/result.png`. Pass when neither flow overwrites the wrong revision.
- [ ] Lane 5. Delete during recovery. Save `artifacts/maintainability/P05/worker-5/result.png`. Pass when late results do not restore the Session.
- [ ] Lane 6. Switch Session during reload. Save `artifacts/maintainability/P05/worker-6/result.png`. Pass when the answer updates only its owning Session.
- [ ] Lane 7. Canonical read fails. Save `artifacts/maintainability/P05/worker-7/result.png`. Pass when the Note stays protected and retry remains possible.
- [ ] Lane 8. Permission decision in stale Session. Save `artifacts/maintainability/P05/worker-8/result.png`. Pass when no approval reaches the previous job.
- [ ] Lane 9. Undo ordinary generation. Save `artifacts/maintainability/P05/worker-9/result.png`. Pass when the previous Note returns without a recovery prompt.
- [ ] Lane 10. Close during recovery. Save `artifacts/maintainability/P05/worker-10/result.png`. Pass when unsafe writes do not occur to allow close.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record process-cold and warm first paint, production JavaScript gzip size, and active provider child count after terminal state. P04 through P06 also record pending pollers after disposal.
- [ ] Probe. Run `bun run frontend:build` at each checked-out revision before `bun run startup:benchmark -- --samples 3` on the same named runner at trunk and head. Interleave trunk and head runs. Preserve each report before the next run overwrites the artifact path. Read child counts and poller counts from deterministic test receipts.
- [ ] Baseline. Record trunk values and runner class before measuring the head. No performance baseline was measured during planning.
- [ ] Rule. On `ubuntu-24.04-github-x64`, fail if cold first paint exceeds 4000 ms or any warm sample exceeds 3000 ms. Fail if provider child count after cleanup exceeds 0 or pollers after disposal exceed 0. Investigate a gzip increase above 0 bytes for P02 through P06 before acceptance. Keep local timings observational.

**Review gate.** The operator reviews before merge.

- [ ] Post the changed behavior screenshots from `P05` and a 30 to 60 second video in chat. Save the video as `artifacts/maintainability/P05/review.mp4`.
- [ ] Record the operator's review of the screenshots and video. Stop at merge-ready for the operator to merge.

**Merge.**

- [ ] Obtain the parent's clean verdict at the exact head SHA with all receipts linked.
- [ ] Resolve review findings and confirm the prerequisites have landed.
- [ ] Reconcile with current trunk and revalidate changed behavior. Hand the PR to the operator for merge.

## Settle Session writes through one capability (P06)

**Depends on.** P05.

**Files.**

- [ ] Edit or add behavior-owned files under `frontend/src/app/sessionActions.writes.ts`.
- [ ] Edit or add behavior-owned files under `frontend/src/app/sessionActions.saving.ts`.
- [ ] Edit or add behavior-owned files under `frontend/src/app/useAppController.navigation.ts`.
- [ ] Edit or add behavior-owned files under `frontend/src/app/usePendingChangeProtection.ts`.
- [ ] Characterize `frontend/src/app/useStableCapability.ts`. Change its timing only if a separate behavior test demonstrates a failure.
- [ ] Edit the existing record and attachment action modules only where persistence ownership must move to remove the construction cycle.
- [ ] Edit or add behavior-owned files under `frontend/src/app/useAppController.ts`.

**Build.**

- [ ] Define a Session settlement snapshot for pending edits, in-flight writes, compensation, attachments, and recovery blocks.
- [ ] Give navigation and close protection the same flush and pending contract. Keep Note serialization inside the write owner.
- [ ] Characterize actions before capability bridge publication and actions across a context update.
- [ ] Remove success-returning placeholder callbacks by removing their dependency cycle. Retain stable callbacks only where their behavior is required.
- [ ] Delete duplicate pending predicates and redundant synchronized refs only after their protected races pass.
- [ ] Record before and after ownership for create, edit, switch, discard, close, and recovered generation. Reject a change that merely moves the same context through another wrapper.

**You see.**

- [ ] Navigation, close, and dirty-state presentation agree about pending work without inspecting Note serialization or compensating writes.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bun run --cwd frontend test src/app/useAppController.workflows.settlement.test.ts src/app/useAppController.sessionIntegrity.compensation.test.ts src/app/useAppController.closeProtection.test.ts src/app/useAppController.hydration-races.test.ts`. Add pre-publication and context-update cases.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe.

- [ ] Lane 1. Edit then switch Session. Save `artifacts/maintainability/P06/worker-1/result.png`. Pass when the last edit is present after reopen.
- [ ] Lane 2. Edit while save awaits. Save `artifacts/maintainability/P06/worker-2/result.png`. Pass when the newer edit remains dirty and is saved next.
- [ ] Lane 3. Discard with late save. Save `artifacts/maintainability/P06/worker-3/result.png`. Pass when compensation restores the chosen baseline.
- [ ] Lane 4. Close with dirty Note. Save `artifacts/maintainability/P06/worker-4/result.png`. Pass when save completes before the window closes.
- [ ] Lane 5. Close after save failure. Save `artifacts/maintainability/P06/worker-5/result.png`. Pass when the window stays open with edits retained.
- [ ] Lane 6. Attachment import during switch. Save `artifacts/maintainability/P06/worker-6/result.png`. Pass when managed Evidence remains with its owner.
- [ ] Lane 7. Delete with pending write. Save `artifacts/maintainability/P06/worker-7/result.png`. Pass when late completion cannot revive deleted state.
- [ ] Lane 8. Open a Session and immediately edit and switch. Save `artifacts/maintainability/P06/worker-8/result.png`. Pass when the edit persists after reopen and the paired React receipt rejects placeholder success before bridge publication.
- [ ] Lane 9. Switch Session, edit, and return to the first Session. Save `artifacts/maintainability/P06/worker-9/result.png`. Pass when each Session retains only its own edits and the paired React receipt covers the context-update race.
- [ ] Lane 10. Summary recovery then navigation. Save `artifacts/maintainability/P06/worker-10/result.png`. Pass when canonical recovered content survives reopen.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record process-cold and warm first paint, production JavaScript gzip size, and active provider child count after terminal state. P04 through P06 also record pending pollers after disposal.
- [ ] Probe. Run `bun run frontend:build` at each checked-out revision before `bun run startup:benchmark -- --samples 3` on the same named runner at trunk and head. Interleave trunk and head runs. Preserve each report before the next run overwrites the artifact path. Read child counts and poller counts from deterministic test receipts.
- [ ] Baseline. Record trunk values and runner class before measuring the head. No performance baseline was measured during planning.
- [ ] Rule. On `ubuntu-24.04-github-x64`, fail if cold first paint exceeds 4000 ms or any warm sample exceeds 3000 ms. Fail if provider child count after cleanup exceeds 0 or pollers after disposal exceed 0. Investigate a gzip increase above 0 bytes for P02 through P06 before acceptance. Keep local timings observational.

**Review gate.** The operator reviews before merge.

- [ ] Post the changed behavior screenshots from `P06` and a 30 to 60 second video in chat. Save the video as `artifacts/maintainability/P06/review.mp4`.
- [ ] Record the operator's review of the screenshots and video. Stop at merge-ready for the operator to merge.

**Merge.**

- [ ] Obtain the parent's clean verdict at the exact head SHA with all receipts linked.
- [ ] Resolve review findings and confirm the prerequisites have landed.
- [ ] Reconcile with current trunk and revalidate changed behavior. Hand the PR to the operator for merge.

## Close the program

- [ ] Confirm every implemented PR has its evidence and operator merge recorded. Mark any rejected extraction as rejected with its reason instead of leaving a silent omission.
- [ ] Update the investigation with actual outcomes. Remove obsolete plan statements only after recording what superseded them.
- [ ] Report provider transitions, duplicate owners, bridge callbacks, and pending predicates removed. Compare the before and after ownership map.
- [ ] Confirm Notes, Evidence, recovery, permission scope, production isolation, and startup gates retain their required behavior.
- [ ] Stop at the approved scope. Treat backup, retrieval, rendering changes, persistent provider sessions, and new providers as separately scoped work.

## Appendix A. Prototype evidence

This planning pass is a read-only investigation with written artifacts. It did not build a prototype, create a branch, or establish runtime equivalence.
QA Scribe baseline is `321f73ba993fc9f461152244ae6c7238c12fbefa`.
T3 Code reference is `e3b35d1b2440b104f0bc2e357377c348121234dd`.
The working tree already had eight plan edits. They remain untouched.

Static tracing established the separate transport choices, shared numeric protocol state, and different frontend polling ownership.
The replay-reader cost, safe runtime extraction, capability publication timing, and intersecting recovery behavior remain empirical questions.
P01 must compare the current fixture approach with a small replay sketch before adding a reader.
P04 and P06 must characterize current behavior before choosing their smallest correction.
If an experiment finds no useful simplification, record that result and remove the proposed extraction.
Do not represent these unbuilt sketches as proved design decisions.

The parent core run passed 32 selected protocol tests. The frontend exploration lane passed seven files and 46 tests.
The parent-run focused Tauri duplex suite passed 29 selected tests against local fake processes. No authenticated CLI was launched.
No native E2E, authenticated provider matrix, T3 test suite, or performance baseline is claimed for planning.

## Appendix B. Alternatives rejected

Keep Rust and Tauri. A JavaScript SDK sidecar adds packaging, upgrade, and process ownership costs without a demonstrated benefit here.
Keep provider-specific protocols. T3's ACP support still contains Copilot-specific routing.
Keep one-way generation and duplex Chat distinct until replay proves a shared resource owner reduces code without obscuring completion.
Keep current catalog provenance and fallback. A generic model list would discard useful evidence already available to the picker.
Keep stale-write compensation until equivalent behavior is proved. More appealing code is insufficient evidence for removing data protection.
Reject a global state rewrite, a universal provider registry, long-lived sessions, and multi-account support as immediate maintainability work.
Defer renderer replacement. Chat and managed Evidence have different trust rules.

## Appendix C. Risks

P01 can become another testing framework. Reuse fixtures first and keep the transcript vocabulary small.
P02 can subtly change wire order or terminal semantics. Require exact outbound replay and per-provider verification.
P03 can overstate capability parity or expose raw diagnostics. Scope support to request families and preserve bounded sanitized detail.
P04 can accidentally stop a durable backend job when only its observer should stop. Test these lifetimes separately.
P05 can combine Summary conflict and Chat uncertain-commit semantics. Preserve both and test their intersections.
P06 can remove compensating writes that repair real late-save cases. Keep compensation tests and add publication timing characterization.
Native Tauri control is available through the repository workflow but was not run in this investigation. A missing native host blocks live proof.
A browser preview alone cannot prove process cleanup, SQLite persistence, managed attachments, or native close behavior.
Authenticated compatibility requires available provider accounts and platform access. Do not silently infer those cells from deterministic fixtures.
There is no validated cross-family critic configuration in this run. Independent delegates inherited the parent model. Do not describe them as multi-model review.
Do not use test count or line count as the sole maintainability result. A protocol transition and Note settlement must have one discoverable owner.

## Appendix D. Links and reading list

Read [the investigation](investigations/2026-10-16-maintainability-and-t3code.md), [quality scenarios](quality-scenarios.md), [the catalog contract](provider-catalog-contract.md), [the current roadmap](refactoring-roadmap.md), and [CI ownership](ci.md).
Read `CONTEXT.md` before changing domain names.
Use the installed `skills/how/SKILL.md` for P02, P03, P05, and P06 architecture tracing.
Use the installed `skills/interrogate/SKILL.md` if implementation uncovers contested design. This plan does not claim that an adversarial multi-model round ran.
Use the installed show-me-your-work skill for the decision trail.
The current local trail is `.audit/maintainability-investigation.tsv`.
Plugin paths are installation-local references. Resolve them again on another machine.

The frontend lane ran this command successfully.

```sh
bun run --cwd frontend test \
  src/app/useAppController.chat.recovery.test.ts \
  src/app/useAppController.closeProtection.summaryRecovery.test.ts \
  src/app/useAppController.sessionIntegrity.compensation.test.ts \
  src/app/useAppController.workflows.settlement.test.ts \
  src/app/useAppController.hydration-races.test.ts \
  src/content/MarkdownContent.test.tsx \
  src/content/TestwareGenerationPreview.test.tsx
```

Validate this plan with the installed checker.

```sh
node <installed-poteto-skills>/poteto-mode/scripts/check-plan.mjs docs/maintainability-program-plan.md
```
