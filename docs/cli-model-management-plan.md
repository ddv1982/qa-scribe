# CLI model management plan

Keep model choices understandable for QA Scribe users and maintainable for the next engineer.
Reuse the existing discovery adapters, per-provider preferences, and ModelSelector.
Separate requested selection, observed CLI default, and provider-reported invocation metadata.
Deliver M01, M02, M03, then M04. These are proposed PR identifiers, not opened pull requests.
This document authorizes no implementation, publication, recurring automation, or CLI configuration changes.
See the [investigation](investigations/2026-10-16-cli-model-discovery.md) for source evidence and limits.

## How to read this

One box is one unit of work. Every box names the evidence that checks it.
Check a box only when its evidence exists, a file, log, screenshot, test run, or SHA.
The body is a how-to. The appendices explain and record.
Run each approved phase through `skills/poteto-mode/playbooks/feature.md` from the installed plugin resource directory.
The parent integrates and opens PRs. The operator reviews interaction changes and decides when to merge.
No release is included in this plan. Follow `docs/releasing.md` only under a later release instruction.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Execution reconciliation

The operator subsequently authorized full implementation and a release after successful verification.
The execution record is [CLI model-management execution](verification/cli-model-management-execution.md).
The original checklist below remains the proposed acceptance plan. This reconciliation records completed work, explicit workflow amendments, and open external gates.

| Phase | Implemented and verified | Evidence and remaining work |
| --- | --- | --- |
| M01, PR47 | Copilot Default and Auto, Settings round trip, narrow denial grammar, Claude Default and policy filtering | Merged at `64e2a8fe78df24bbfa923f06585101898ca36c33`; ten native scenarios, independent review and protected CI |
| M02, PR48 | Typed requested and reported evidence, schema-10 migration, parser trust boundaries, failure and cancellation settlement | Merged at `f0d3f4b314d3773abbd4481eb31487a025433fbe`; ten native scenarios, restart, literal SQLite, independent review and protected CI |
| M03, PR49 | Shared next-invocation selection, serialized Settings writes, captured launch values and immutable history | Independent final PASS+NOTES at `3ff36227295bfb6eef5b417e713452b0899f713f`; ten native scenarios and restart; fresh protected integration CI pending |
| M04 | Provider-aware authority, CODEX_HOME invalidation, auth before catalog within the same deadline, expanded required Linux native suite | Final parent native suite passed all 18 invocations. Exact-head independent shipping, size comparison and protected CI remain pending |
| External promotion | Diagnostics remains the default for Claude and Copilot | Full platform and account matrix, signed-in picker parity, Claude authorization and billing evidence, and Copilot catalog access remain open |
| Release | Authorized after successful deterministic qualification and integration | Follow `docs/releasing.md`; no release or new tag has been published by this program yet |

The same bounded Poteto owner continued the linear implementation phases. Independent design, source, comment and native shipping reviewers remained separate from the author.
The parent retained integration and publication authority. The execution record explains the autonomous visual-review amendment. No human approval is claimed.
M03 timing evidence uses debug-native artifacts and remains inconclusive for production latency.
M04 account-dependent checks stay separate from deterministic CI. A recorded provider denial does not pass an external promotion gate.
Unused file-list entries in the proposed checklist are scope options, not requirements to edit files without a behavioral reason.
No goal, scheduled audit or credential/configuration workaround was created.

## Program checklist

### Arm the program

- [ ] Record the operator's instruction to execute this plan before starting M01. Until then, retain every implementation box unchecked.
- [ ] Record the baseline `origin/main` SHA and read `AGENTS.md`, `docs/provider-catalog-contract.md`, and this plan.
- [ ] Resolve installed skill resources. Use `git show origin/main:<path>` only for repository-owned documents. Plugin skills are outside this repository.
- [ ] Skip create a goal and hourly audit automation. This plan defines a bounded session. Create lifecycle objects only if the operator explicitly requests unattended orchestration.
- [ ] Keep a local decision trail with a queue table after each phase. Record exact heads, evidence, unresolved gates, and next owner.
- [ ] Resolve model profiles at execution time. The configured fast profile is a preference. Use an inherited validated model when unavailable and label the fallback.

### Spawn owners

- [ ] Assign one bounded owner to M01. Finish its compatibility evidence before starting M02.
- [ ] Assign a fresh owner to M02, then M03, then M04. Use isolated worktrees or exclusive file ownership.
- [ ] Keep research read-only. Keep the parent responsible for integration, commits, pushes, PR linking, and final verification.
- [ ] Run independent design exploration before code crosses boundaries. Resolve contested choices before implementation.
- [ ] Keep model changes global per provider for this first version, matching existing Settings behavior. Label that scope in the UI.
- [ ] Stop M03 at merge-ready for operator review of screenshots and video. M01 and M04 also require review if they alter user-visible diagnostics or catalogs.

### PR mechanics, for every PR

- [ ] Use `gh` for forge operations and register each created or worked PR with T3 Code when available.
- [ ] Run the repository lint and typecheck before the PR-facing push. Preserve hooks.
- [ ] Apply deslop before commit and no-comments before review. Stage only owned files.
- [ ] Rebase or merge the current protected base through repository practice. Preserve a verifiable actual-head CI receipt.
- [ ] Inspect reviewer findings against the actual code and evidence. Record fixes and supported dismissals.

### Verdict and merge, for every PR

- [ ] At the exact candidate head, run one gates lane, the ten live lanes below, the perf lane, and two independent audits.
- [ ] Queue lanes to available capacity. Give each native run its own app data, fixture directory, artifacts, and display when required.
- [ ] Require unit, real app, and perf evidence. A missing driver, account, platform, or external rollout gate remains unverified.
- [ ] Reject provider-response prose as model evidence. Accept only typed fields from the correlated invocation and record their scope.
- [ ] Merge only after a clean verdict at the head and completion of the phase's review gate. Reverify any later behavior change.

### Boot recipe, for every live lane

- [ ] Fetch and check out the exact PR head in an owned worktree. Record the SHA in the lane receipt.
- [ ] Reuse `e2e/wdio.conf.mjs`, `scripts/run-e2e.mjs`, and their isolated fixture process setup. Do not use the operator's app data.
- [ ] Build with `bun run build`. Drive the native app through its existing WebdriverIO Tauri driver. Use the installed control-ui skill.
- [ ] Add `e2e/specs/model-management.e2e.mjs` in M01. Run it with `QA_SCRIBE_E2E_SPEC=model-management.e2e.mjs bun run e2e` under `xvfb-run -a` on Linux when a display is absent.
- [ ] Save positive screenshots, sanitized requested arguments or frames, normalized responses, and the SQLite rows relevant to each lane under `/tmp/qa-models/<pr-id>/lane-<n>/`.
- [ ] For real CLI compatibility, reuse no-prompt catalog tests through control-cli. Run generation smokes only as a separately identified authenticated test in a disposable workspace.
- [ ] Keep synthetic app proof distinct from real-provider access. A simulated catalog cannot satisfy an authenticated rollout gate.

## Prove catalog contracts and explain failures (M01)

**Depends on.** None.

**Files.**

- [ ] Edit or extend `crates/qa-scribe-core/src/ai/mod.rs`, `ai/chat.rs`, and their argument tests to distinguish Copilot Auto from Default.
- [ ] Edit or extend `src-tauri/src/commands/providers/probe/copilot/protocol.rs` only where the named behavior requires it.
- [ ] Edit or extend `src-tauri/src/commands/providers/probe/copilot/tests.rs` only where the named behavior requires it.
- [ ] Edit or extend `src-tauri/src/commands/providers/probe/fixtures/copilot/` only where the named behavior requires it.
- [ ] Edit or extend `e2e/specs/model-management.e2e.mjs` only where the named behavior requires it.
- [ ] Edit or extend `e2e/fixtures/bin/` only where the named behavior requires it.
- [ ] Edit or extend `docs/provider-catalog-contract.md` only where the named behavior requires it.

**Build.**

- [ ] First reproduce the Copilot Auto mismatch with literal command expectations. Default omits the override. Automatic selection sends `--model auto` in generation and Chat even when external configuration names a model. Verify compatibility before changing the shared helper.
- [ ] Add a sanitized regression for protocol-3 `models.list` returning JSON-RPC `-32603` with a string-only 403 unauthorized rejection. Preserve the failing baseline receipt before a fix.
- [ ] Classify that response through a bounded provider-specific parser. Keep local authentication status separate from catalog authorization. Do not use unrestricted substring matching on arbitrary provider prose.
- [ ] Record a compatibility matrix for the installed CLI versions and the supported floor. Record missing accounts and platforms explicitly.
- [ ] Extend the existing native fixture process to expose literal catalog, stale refresh, and error cases. Keep refresh free of prompts, installs, or authentication changes.
- [ ] Document existing behavior rather than rebuilding discovery. Preserve diagnostics rollout, Default, Auto, custom IDs, source confidence, and cache identity.

**You see.**

- [ ] A catalog denial yields useful recovery guidance while preserving the saved model and distinguishing signed-in status from catalog access.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `cargo test -p qa-scribe-tauri commands::providers`, `cargo test -p qa-scribe-core ai::tests`, and fixture process tests. Assert exact allowed RPCs, literal normalized models, and error categories.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head. Use the documented inherited-model fallback when needed.

- [ ] Lane 1. Refresh a Claude fixture catalog. Save `/tmp/qa-models/M01/lane-1/claude-catalog.png`. Pass when the native Settings view shows its source and does not send a prompt.
- [ ] Lane 2. Refresh a two-page Codex fixture catalog. Save `/tmp/qa-models/M01/lane-2/codex-pages.png`. Pass when both pages appear once and hidden rows remain hidden.
- [ ] Lane 3. Return the observed Copilot string-only denial. Save `/tmp/qa-models/M01/lane-3/copilot-denial.png`. Pass when catalog access failure remains distinct from local authentication status.
- [ ] Lane 4. Return structured signed-out status. Save `/tmp/qa-models/M01/lane-4/signed-out.png`. Pass when the app offers sign-in guidance without authenticating itself.
- [ ] Lane 5. Return an unsupported protocol. Save `/tmp/qa-models/M01/lane-5/unsupported.png`. Pass when the app retains compatibility choices and explains the limitation.
- [ ] Lane 6. Stall a catalog child. Save `/tmp/qa-models/M01/lane-6/timeout.png`. Pass when the transaction ends within its deadline and its process group exits.
- [ ] Lane 7. Fail a refresh with matching identity. Save `/tmp/qa-models/M01/lane-7/stale.png`. Pass when last-good entries carry stale status and saved selection stays intact.
- [ ] Lane 8. Change the fixture identity before refresh failure. Save `/tmp/qa-models/M01/lane-8/identity.png`. Pass when the app does not reuse the old account catalog.
- [ ] Lane 9. Enter an unlisted custom model ID. Save `/tmp/qa-models/M01/lane-9/custom.png`. Pass when the saved literal ID survives refresh. Also assert that Copilot Auto sends `--model auto` and Default omits it.
- [ ] Lane 10. Return blocked model rows. Save `/tmp/qa-models/M01/lane-10/policy.png`. Pass when blocked choices cannot be selected and Default remains provider-managed.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Catalog transaction deadline, child cleanup, and cached-read provider process count.
- [ ] Probe. Run identical scripted catalog cases at trunk and head. Record five repetitions each in alternating order, using bounded fake peers and one initialization-only installed-CLI check.
- [ ] Baseline. Record trunk deadline behavior, child count after teardown, and ordinary cached-read spawn count first. Do not treat the current investigation as a latency benchmark.
- [ ] Rule. Fail if the 12-second absolute transaction budget or 1 MiB frame limit is exceeded, a child remains after teardown, or an ordinary cached readiness read within its TTL adds a provider process. An explicit user Refresh may start one bounded discovery transaction and must not start duplicates.

**Review gate.** The operator reviews before merge.

- [ ] Post the relevant positive screenshots under `/tmp/qa-models/M01/review/`.
- [ ] Record a 30 to 60 second video of model selection or diagnostics. Save `/tmp/qa-models/M01/review/demo.mp4`.
- [ ] Present screenshots and video to the operator. Stop at merge-ready until that interaction receives review.

**Merge.**

- [ ] Record an independent clean verdict and protected CI at the exact head.
- [ ] Resolve review findings and finish the applicable interaction review.
- [ ] Let the parent merge only within explicit execution and merge authority. Preserve the final evidence SHA.

## Retain requested and reported model evidence (M02)

**Depends on.** M01.

**Files.**

- [ ] Edit or extend `crates/qa-scribe-core/src/domain/ai_run.rs` only where the named behavior requires it.
- [ ] Edit or extend `crates/qa-scribe-core/src/ai/` only where the named behavior requires it.
- [ ] Edit or extend `crates/qa-scribe-core/src/generation/workflow.rs` only where the named behavior requires it.
- [ ] Edit or extend `crates/qa-scribe-core/src/services/session_service/chat_turns.rs` only where the named behavior requires it.
- [ ] Edit or extend `crates/qa-scribe-core/src/storage/` only where the named behavior requires it.
- [ ] Edit or extend `src-tauri/src/commands/ai/` only where the named behavior requires it.
- [ ] Edit or extend `frontend/src/bridge/` only where the named behavior requires it.
- [ ] Edit or extend `e2e/specs/model-management.e2e.mjs` only where the named behavior requires it.

**Build.**

- [ ] Define requested model intent as provider Default, Copilot Auto, or an explicit opaque ID. Retain the existing provider descriptors as catalog owners.
- [ ] Store requested intent alongside optional runtime evidence. Record the source and scope of the report, such as thread configuration, initialization metadata, or assistant message metadata.
- [ ] Inspect the actual schema owner before editing storage. Add an additive SQLite migration and generated bridge bindings. Mark old ambiguous strings as legacy evidence without inventing a reported model.
- [ ] Preserve provider differences. Use exact correlated metadata for Claude and Codex where supported. Keep absent Codex generation and Copilot evidence unknown until the installed protocol proves a field.
- [ ] Snapshot selection at invocation start. Preserve both requested and reported IDs when the provider resolves an alias or reports a different model.
- [ ] Retain evidence for success, failure, and cancellation according to the existing run lifecycle. Do not let late events overwrite another run.

**You see.**

- [ ] Saved run records distinguish requested Default or alias from a provider report and identify unknown or legacy evidence explicitly.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `cargo test -p qa-scribe-core`, targeted Tauri metadata tests, and `bun run bindings:check`. Assert exact stored rows through generation and Chat entry points.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head. Use the documented inherited-model fallback when needed.

- [ ] Lane 1. Generate with Default and a fixture model report. Save `/tmp/qa-models/M02/lane-1/default-report.png`. Pass when SQLite retains Default intent and the separate reported ID.
- [ ] Lane 2. Generate with an alias resolving to another ID. Save `/tmp/qa-models/M02/lane-2/alias-report.png`. Pass when both IDs remain unchanged in evidence.
- [ ] Lane 3. Generate with an explicit model. Save `/tmp/qa-models/M02/lane-3/explicit.png`. Pass when the exact outbound ID and requested record match.
- [ ] Lane 4. Complete a turn with no model metadata. Save `/tmp/qa-models/M02/lane-4/missing.png`. Pass when the report stays unknown.
- [ ] Lane 5. Complete a Copilot plaintext generation. Save `/tmp/qa-models/M02/lane-5/copilot-unknown.png`. Pass when the app does not invent a serving model.
- [ ] Lane 6. Complete a Codex Chat turn. Save `/tmp/qa-models/M02/lane-6/codex-thread.png`. Pass when the model report is labeled with thread-configuration scope.
- [ ] Lane 7. Fail after initialization metadata. Save `/tmp/qa-models/M02/lane-7/failure.png`. Pass when the failed run keeps only justified evidence.
- [ ] Lane 8. Cancel while model metadata is delayed. Save `/tmp/qa-models/M02/lane-8/cancel.png`. Pass when late events cannot change the cancelled run or its successor.
- [ ] Lane 9. Return assistant prose containing a forged model field. Save `/tmp/qa-models/M02/lane-9/prose.png`. Pass when prose never becomes trusted model metadata.
- [ ] Lane 10. Open a pre-migration database and restart. Save `/tmp/qa-models/M02/lane-10/legacy.png`. Pass when old records remain readable with legacy provenance and new records persist both fields.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Database migration success, per-turn write count, and frontend production gzip size.
- [ ] Probe. Compare the same synthetic ten-turn workflow and old database fixture at trunk and head. Build production assets once at each exact revision and record gzip sizes.
- [ ] Baseline. Record trunk transaction count, startup behavior with the old fixture, and gzip bytes first.
- [ ] Rule. Fail on data loss, an additional provider probe per turn, or more than one additional metadata write per turn. Investigate gzip growth above 5 KiB before acceptance.

**Review gate.** None. M02 is not review-gated. It changes stored evidence without changing an interaction.

**Merge.**

- [ ] Record an independent clean verdict and protected CI at the exact head.
- [ ] Resolve review findings and finish the applicable interaction review.
- [ ] Let the parent merge only within explicit execution and merge authority. Preserve the final evidence SHA.

## Show the next model beside the action (M03)

**Depends on.** M02.

**Files.**

- [ ] Edit or extend `frontend/src/components/ModelSelector.tsx` only where the named behavior requires it.
- [ ] Edit or extend `frontend/src/views/SettingsView.tsx` only where the named behavior requires it.
- [ ] Edit or extend `frontend/src/hooks/useSettingsController.ts` only where the named behavior requires it.
- [ ] Edit or extend `frontend/src/app/AppShell.tsx` only where the named behavior requires it.
- [ ] Edit or extend `frontend/src/views/SessionChatView.tsx` only where the named behavior requires it.
- [ ] Edit or extend `frontend/src/app/generationPreflightAction.ts` only where the named behavior requires it.
- [ ] Edit or extend `e2e/specs/model-management.e2e.mjs` only where the named behavior requires it.

**Build.**

- [ ] Prototype two placements in the actual app test environment. Compare a composer picker with a compact next-turn summary that opens the shared picker. Save screenshots and keyboard traces before selecting one.
- [ ] Reuse ModelSelector and the existing settings controller. Keep one saved preference per provider. State that the preference affects new invocations across QA Scribe.
- [ ] Show next-turn selection, observed CLI default with freshness, and prior-turn reported model as separate facts. Never label a configured value as a verified serving model.
- [ ] Preserve unrelated unsaved Settings edits when the quick picker persists a model choice. Show a failed save and restore the prior selection. Verify both paths through the controller.
- [ ] Capture selection when Send or Generate begins. Keep in-flight requests and pending permissions tied to their original run. A later change affects the next invocation only.
- [ ] Retain saved custom IDs and unavailable selections across catalog refreshes. Show refresh progress and recoverable errors without silently replacing intent.
- [ ] Expose model options only when both catalog metadata and the exact execution path support them. Keep effort controls outside this phase unless existing configuration already supports the complete path.

**You see.**

- [ ] A user can change the next invocation model near Send or Generate and still read the prior turn's model evidence accurately.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run frontend tests for ModelSelector, SettingsView, useSettingsController, SessionChatView, and generation preflight. Assert persisted intent, keyboard behavior, and captured launch arguments.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head. Use the documented inherited-model fallback when needed.

- [ ] Lane 1. Open and choose a model using only the keyboard. Save `/tmp/qa-models/M03/lane-1/keyboard.png`. Pass when focus, selection, Escape, and return focus behave correctly.
- [ ] Lane 2. Change Claude before a new Chat turn. Save `/tmp/qa-models/M03/lane-2/claude-next.png`. Pass when the next process receives the exact override.
- [ ] Lane 3. Change Codex before generation. Save `/tmp/qa-models/M03/lane-3/codex-next.png`. Pass when the next generation receives the exact override.
- [ ] Lane 4. Choose Copilot Auto then an explicit model. Save `/tmp/qa-models/M03/lane-4/copilot-next.png`. Pass when Auto sends `--model auto` and the explicit model reaches its invocation.
- [ ] Lane 5. Change the preference during an active fixture turn. Save `/tmp/qa-models/M03/lane-5/active.png`. Pass when the active turn keeps its original model and the next turn uses the new one.
- [ ] Lane 6. Change Settings after a completed turn. Save `/tmp/qa-models/M03/lane-6/history.png`. Pass when the historical report does not change.
- [ ] Lane 7. Change the picker and open another Session. Save `/tmp/qa-models/M03/lane-7/global-scope.png`. Pass when the shared per-provider scope is visible and consistent without saving unrelated Settings drafts.
- [ ] Lane 8. Refresh while a custom model is selected. Save `/tmp/qa-models/M03/lane-8/refresh-race.png`. Pass when a late response preserves the custom intent.
- [ ] Lane 9. Select Default after an explicit override. Save `/tmp/qa-models/M03/lane-9/default.png`. Pass when the next launch omits the model argument and the UI explains delegation.
- [ ] Lane 10. Save separate choices for all providers and restart. Save `/tmp/qa-models/M03/lane-10/restart.png`. Pass when each provider restores its own choice without a leaked account catalog.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Picker interaction latency, native startup latency, and duplicate discovery request count.
- [ ] Probe. Use the existing startup benchmark and native test control at trunk and head. Alternate five cold runs and ten warm picker interactions per revision with the same fixtures and build mode.
- [ ] Baseline. Record trunk startup and interaction samples before changing UI. Keep all raw samples and machine details.
- [ ] Rule. Fail if median startup or picker latency grows by more than the larger of 10 percent or 50 ms, or one user refresh starts duplicate discovery transactions.

**Review gate.** The operator reviews before merge.

- [ ] Post the relevant positive screenshots under `/tmp/qa-models/M03/review/`.
- [ ] Record a 30 to 60 second video of model selection or diagnostics. Save `/tmp/qa-models/M03/review/demo.mp4`.
- [ ] Present screenshots and video to the operator. Stop at merge-ready until that interaction receives review.

**Merge.**

- [ ] Record an independent clean verdict and protected CI at the exact head.
- [ ] Resolve review findings and finish the applicable interaction review.
- [ ] Let the parent merge only within explicit execution and merge authority. Preserve the final evidence SHA.

## Qualify provider rollout and finish the contract (M04)

**Depends on.** M03. Provider-specific enablement may remain gated independently.

**Files.**

- [ ] Edit or extend `src-tauri/src/commands/providers/rollout.rs` only where the named behavior requires it.
- [ ] Edit or extend `src-tauri/src/commands/providers/models/catalog.rs` only where the named behavior requires it.
- [ ] Edit or extend `src-tauri/src/commands/providers/probe/` only where the named behavior requires it.
- [ ] Edit or extend `frontend/src/settings/providerStatusCache.ts` only where the named behavior requires it.
- [ ] Edit or extend `docs/provider-catalog-contract.md` only where the named behavior requires it.
- [ ] Edit or extend `e2e/specs/model-management.e2e.mjs` only where the named behavior requires it.

**Build.**

- [ ] Run the provider catalog and picker comparison matrix at the exact candidate head. Include the oldest supported and current CLI on supported release platforms.
- [ ] Resolve the Copilot catalog denial in an authorized account environment. Add no credential workaround to QA Scribe. Compare account models with ACP session configuration only if necessary.
- [ ] Evaluate ACP model options in a disposable no-prompt session only after recording session-creation side effects and cleanup. Keep this optional investigation out of startup until proven necessary.
- [ ] Promote Claude or Copilot account catalogs separately only when their existing repository release gates pass. Keep diagnostics mode for a blocked provider.
- [ ] Retain the kill switch, custom IDs, sanitized fallback categories, cache identity, and provider-managed Default. Do not adopt a remotely mutable manifest for this release.
- [ ] Perform one separately logged authenticated generation for each provider and supported selection path in a disposable workspace. Compare requested arguments, provider-reported evidence, and saved run records.
- [ ] Reconcile the old model-detection plan and this plan with actual evidence. Document remaining platform, account, policy, and provider-report limits. Remove duplicate internal selection storage only in a separately justified follow-up.

**You see.**

- [ ] Each enabled provider displays its proven catalog and reports the evidence it actually supplies. A gated provider explains its fallback honestly.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `bun run verify`, the full native suite, provider fixture tests, and the existing no-prompt live catalog contracts. Keep authenticated smokes separate from deterministic CI.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head. Use the documented inherited-model fallback when needed.

- [ ] Lane 1. Compare the signed-in Claude CLI picker with app discovery. Save `/tmp/qa-models/M04/lane-1/claude-live.png`. Pass when each difference has an explained source or a recorded blocker.
- [ ] Lane 2. Compare the signed-in Codex picker with paginated discovery. Save `/tmp/qa-models/M04/lane-2/codex-live.png`. Pass when the app preserves returned IDs, visibility, and effort metadata.
- [ ] Lane 3. Compare Copilot account catalog and any proven ACP options. Save `/tmp/qa-models/M04/lane-3/copilot-live.png`. Pass when catalog authorization and session configuration remain separately labeled.
- [ ] Lane 4. Disable structured catalogs. Save `/tmp/qa-models/M04/lane-4/kill-switch.png`. Pass when compatibility choices remain usable without new structured probes.
- [ ] Lane 5. Leave a provider in diagnostics mode. Save `/tmp/qa-models/M04/lane-5/diagnostics.png`. Pass when catalog health is visible without changing selector authority.
- [ ] Lane 6. Change fixture policy between reads. Save `/tmp/qa-models/M04/lane-6/policy-change.png`. Pass when the app updates blocked choices without claiming access.
- [ ] Lane 7. Change the test account identity. Save `/tmp/qa-models/M04/lane-7/account-change.png`. Pass when the next refresh cannot replay the prior catalog.
- [ ] Lane 8. Replace the fixture executable version. Save `/tmp/qa-models/M04/lane-8/cli-upgrade.png`. Pass when discovery invalidates identity and classifies incompatible responses.
- [ ] Lane 9. Restart offline after a prior successful catalog. Save `/tmp/qa-models/M04/lane-9/offline.png`. Pass when the app retains intent without presenting persisted account choices as fresh.
- [ ] Lane 10. Run the separately identified authenticated selection smoke. Save `/tmp/qa-models/M04/lane-10/roundtrip.png`. Pass when the receipt connects selected ID, invocation, reported evidence or explicit unknown, and stored record.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Discovery deadline, fallback behavior, process cleanup, and release asset size.
- [ ] Probe. Repeat M01 deadline and cleanup probes at trunk and head. Compare release binary and frontend gzip sizes using identical build inputs. Record real-provider results separately.
- [ ] Baseline. Record current trunk asset bytes and synthetic fallback behavior before changing rollout defaults.
- [ ] Rule. Fail on a leaked process, startup awaiting a catalog beyond 12 seconds, or account catalogs persisted across restart. Review binary growth above 1 percent and frontend gzip growth above 5 KiB.

**Review gate.** The operator reviews before merge.

- [ ] Post the relevant positive screenshots under `/tmp/qa-models/M04/review/`.
- [ ] Record a 30 to 60 second video of model selection or diagnostics. Save `/tmp/qa-models/M04/review/demo.mp4`.
- [ ] Present screenshots and video to the operator. Stop at merge-ready until that interaction receives review.

**Merge.**

- [ ] Record an independent clean verdict and protected CI at the exact head.
- [ ] Resolve review findings and finish the applicable interaction review.
- [ ] Let the parent merge only within explicit execution and merge authority. Preserve the final evidence SHA.

## Close the program

- [ ] Reconcile every completed box with exact source, test, screenshot, database, or provider evidence.
- [ ] Leave missing account and external rollout gates unchecked. Deliver completed phases without claiming a blocked promotion succeeded.
- [ ] Report provider behavior, migrations, measured changes, remaining limits, and final PR links.
- [ ] Leave release and tagging to a later explicit instruction and the existing release process.

## Appendix A. Prototype evidence

The current investigation ran no UI prototype and no authenticated generation turn.
No implementation branch was created. The pinned source revisions and local probe receipts appear in the investigation.
M03 must compare the two placements before committing to interaction design.
The first product default is one shared preference per provider, matching current Settings behavior.
A per-Chat override adds another owner and persistence rule. It remains a product extension rather than an assumed requirement.

Installed CLI observations follow.

- Codex `0.163.0` returned seven visible model entries through initialization and `model/list`.
- Claude `2.1.301` passed the existing no-prompt catalog contract with 13 entries.
- Copilot `1.0.69` connected using protocol 3 but rejected `models.list`. Local authenticated status did not establish catalog access.
- The combined ignored-test command exited 101. The failure is an investigation finding, not a green compatibility receipt.

These observations are not performance measurements, model-selection proof, or a release matrix.

## Appendix B. Alternatives rejected

| Alternative | Decision |
| --- | --- |
| Rebuild model discovery and selection | Reject. The existing implementation already owns both |
| Use the catalog default as the saved explicit model | Reject. That freezes provider-managed behavior and changes user intent |
| Edit external CLI configuration from QA Scribe | Exclude. App-owned invocation preferences meet the requested first version |
| Import T3's persistent session switching | Reject for this scope. QA Scribe launches a fresh invocation per turn |
| Add a remote model manifest | Defer. Existing CLI sources and labeled compatibility choices are simpler |
| Treat a custom ID as having the first model's capabilities | Reject. Unknown capabilities remain unknown |
| Add a generic ACP registry or JavaScript sidecar | Reject. Reuse the three current provider adapters |
| Add per-Chat settings immediately | Defer. Reuse the existing global per-provider preference owner first |
| Enable Claude and Copilot selectors together | Reject. Their compatibility and release gates differ |

## Appendix C. Risks

| Risk | Phase and response |
| --- | --- |
| Copilot Auto flag may differ on older CLI or ACP startup | M01 proves both paths at the supported floor. Preserve Default as omitted and never migrate it to Auto |
| Copilot denies catalog access despite authenticated status | M01 classifies evidence. M04 uses an authorized test account without changing credentials |
| An alias or provider fallback differs from requested ID | M02 stores requested and reported evidence separately |
| A provider exposes configuration but no serving identity | M02 labels the evidence scope and preserves unknown |
| Existing records cannot establish old provenance | M02 marks legacy values honestly |
| Model change races with Send or a pending permission | M03 captures intent per invocation and never retargets active work |
| Refresh or account changes leak stale choices | M01 and M04 retain fingerprint checks and nonpersistent account catalogs |
| Live native driver or platform unavailable | The required lane stays unverified. Screenshots from a browser mock cannot replace native proof |
| Authenticated paid-turn or platform coverage unavailable | Keep the specific compatibility claim open. Do not infer it from fixtures |
| Claude subscription discovery needs external authorization evidence | M04 keeps the existing repository publication gate. The current probe establishes no approval |
| Perf thresholds lack current baselines | Record trunk first. Thresholds here are proposed acceptance rules, not measured claims |

## Appendix D. Links and reading list

- [Investigation and source map](investigations/2026-10-16-cli-model-discovery.md).
- [Existing catalog compatibility and release contract](provider-catalog-contract.md).
- [Existing Claude and Copilot model detection plan](claude-copilot-model-detection-plan.md).
- [Release process](releasing.md).
- Read installed `skills/how/SKILL.md` for each phase. Use `skills/interrogate/SKILL.md` if a phase has a contested design.
- Follow installed `skills/show-me-your-work/SKILL.md`. Keep the current trail at `.audit/cli-model-investigation-20261016.tsv`.
- Use installed `skills/benchmark-checklist/SKILL.md` before collecting or interpreting performance samples.
- Use installed control-ui for native app proof and control-cli for provider protocol proof.
- Planning resource is `/home/vriesd/.codex/plugins/cache/pstack-for-codex-local/pstack-for-codex/0.4.0/skills/poteto-mode/playbooks/multi-phase-plan.md`.
- Runtime resource is the adjacent `references/codex-agent-runtime.md`. It governs delegation and external actions.

## Appendix E. Principles and decisions

Model the Domain led to separate requested intent and scoped runtime evidence, using the existing provider catalog types.
Experience First led to placing model selection near the next action and retaining accurate historical reports.
Sequence Work into Verifiable Units led to compatibility tests, stored evidence, UI, then provider-specific rollout.
Prove It Works led to real no-prompt probes and an explicit Copilot failure rather than a compatibility claim from source alone.
Guard the Context Window led to separate read-only app, upstream, and Copilot diagnosis slices.
Never Block on the Human led to adopting the existing global per-provider scope as the planning default.
Encode Lessons in Structure led to validating the plan with the installed check script.
