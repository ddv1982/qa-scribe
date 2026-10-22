# Improve first use, creation, and CI predictability

Plan from protected main at `00b342b5d198016784422f699b4434d62a5198e9`, released as v0.8.16.
Make ordinary creation the default, keep AI optional, and use Copy as the clipboard label.
Help unfamiliar QA engineers finish useful work and choose to return.
Make checks easier to understand and failures easier to diagnose without weakening release protection.
Deliver AC-1, AC-2, AC-3, and AC-4 as separate changes. AC-5 is the final authorized release preparation.
These are planning labels, not GitHub PR numbers. The user now authorizes implementation, normal PRs and protected merges, and one final release through existing CI. Use OpenAI models only.

## Delivery status

AC-1 through AC-4 landed through protected CI and independent OpenAI review:

| Phase | Delivery |
| --- | --- |
| AC-1 | [PR #72](https://github.com/ddv1982/qa-scribe/pull/72) adds the check inventory and tested routing contracts. |
| AC-2 | [PR #73](https://github.com/ddv1982/qa-scribe/pull/73) makes ordinary creation primary and simplifies Copy. |
| AC-3 | [PR #74](https://github.com/ddv1982/qa-scribe/pull/74) adds the read-only example, Help, quick start, and pilot guide. |
| AC-4 | [PR #75](https://github.com/ddv1982/qa-scribe/pull/75) adds bounded diagnostics, fixes autosave layout movement, and separates behavior tests from native installation proof. |

AC-5 first merged [PR #76](https://github.com/ddv1982/qa-scribe/pull/76), which created the v0.8.17 tag but did not publish an installer release. Two main CI attempts exhausted Linux job budgets during slow Ubuntu package downloads. The Intel release build also timed out; its precise cause remains unproved.
The next candidate is v0.8.18. It carries the same product improvements and a focused hosted Ubuntu archive-selection correction. The v0.8.17 tag remains unchanged. Fresh protected CI and complete release publication are still required.
The checklist below retains the original verification scope. Human recruitment,
repeat-use outcomes, and actual reporting-tool paste remain unverified. The
public wiki draft is held until the new app release succeeds. The example stays
a read-only preview; explicit Start creates a blank Session rather than cloning
sample data.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists.
Run the installed `poteto-mode/playbooks/feature.md` for implementation, followed by `poteto-mode/playbooks/opening-a-pr.md`.
Use the installed `poteto-mode/playbooks/babysit.md` to resolve reviews and checks. Use `poteto-mode/playbooks/shipping.md` for an authorized merge. The parent owns integration, checks, PR registration, and authorized publication.
Run required CI checks. Verify changed behavior on its real surface. Reuse unchanged evidence.
Measure performance only for a changed runtime path or an explicit performance claim. Use existing startup checks where applicable. Do not invent a benchmark to fill the template.
Apply the user's simpler-checks priority over fixed verification counts. Run the affected scenarios in one owned environment, rather than ten agents or ten mandatory repetitions.
Keep one independent OpenAI review per final implementation patch. For metadata-only release preparation, review the metadata diff and reuse unchanged interaction evidence. Reopen only affected review scope for a new defect or changed behavior.
The body is an execution checklist. The appendices hold findings, limits, and source references.

## Program checklist

### Arm the program

- [x] Confirm the outcome and wording from the conversation. Creation is the normal flow. AI is optional. Use Create finding, Create test cases, Copy, and Copied.
- [x] Confirm the source baseline with `git ls-remote origin refs/heads/main`. Main matches v0.8.16 at the SHA above. The current checkout remains on the older release branch.
- [ ] On an explicit implementation request, fetch main and create a fresh implementation checkout. Record its SHA and compare it with this plan's baseline.
- [ ] Create the check inventory before changing workflows. Record each command, job, trigger, runner, proof purpose, and artifact in `docs/verification/check-inventory.md`.
- [ ] Read current contracts using `git show origin/main:package.json`, the shared actions, `docs/ci.md`, and `docs/releasing.md`. Read skills from their installed paths, not nonexistent repository skill paths.
- [ ] Do not create a goal, schedule, or hourly audit for this bounded work without a separate request. Keep the queue table and decisions in a local audit trail.
- [ ] Keep Windows support, compiler upgrades, provider protocols, database migrations, a new design system, paid-provider CI, and new packaging formats outside this plan.

### Spawn owners

- [ ] Use one OpenAI implementation owner at a time for shared source, dependency, desktop, and Cargo writes. Use a separate read-only OpenAI reviewer after the patch is ready.
- [ ] Follow `AC-1`, then `AC-2`, then `AC-3`, then `AC-4`. Prepare AC-5 only after the implementation is accepted and a new release is requested.
- [ ] Allow documentation research during a code phase only with separate file ownership. Do not run competing builds or native sessions against shared outputs.
- [ ] Record the throughput checkpoint at each boundary. Name blocking checks, independent read-only work, shared writable files, and the smallest useful owner scope.

### PR mechanics, for every PR

- [ ] Keep each PR within its file boundary. Preserve unrelated work and historical failed evidence.
- [ ] Use the available forge and protected main. Register every created or worked-on PR with the T3 thread. Record the actual PR number beside its AC label.
- [ ] Run focused checks during edits. Run the affected static checks once before the PR-facing push. Keep hooks enabled.
- [ ] Use the maintained fast and full commands according to the check inventory. Do not run fast, full, every constituent command, and all native scenarios again against unchanged bytes.
- [ ] Keep an exact-head evidence index with base, head, patch-id, commands, exit status, relevant screenshot paths, and limitations. Reuse existing receipts rather than copying the same evidence into many reports.
- [ ] Remove unused code, accidental formatting, and comments that only narrate the code before committing. Review new suppression comments and triage automated findings against actual behavior. Do not add a separate comment-review agent for documentation-only changes.

### Verdict and merge, for every PR

- [ ] Require protected CI and the applicable independent OpenAI review. Implementation review covers the exact patch. A metadata-only release needs focused metadata review, not another product review. State observational jobs separately.
- [ ] Review affected desktop interactions through screenshots and a short video. CI-only changes need workflow and failure artifacts, not artificial desktop recordings.
- [ ] Preserve the first failure. Perform one bounded diagnosis. Rerun only when a specific external condition or correction justifies it. Report an unchanged retry separately from a root-cause fix.
- [ ] Do not add general retries, raise every timeout, suppress security findings, or mark a required failure observational to obtain a green result.
- [ ] Merge only within the authority active at execution. Do not infer a new merge or release request from publication of v0.8.16.

### Boot recipe, for every live lane

- [ ] Use the exact candidate source, frozen frontend dependencies, pinned tools, disposable application data, and deterministic fixture providers.
- [ ] Reuse `cursor-team-kit:control-ui` and the maintained `e2e/wdio.conf.mjs` desktop harness. Use T3 preview for web documentation when available.
- [ ] Record the actual viewport. Check the affected UI in both themes at 1280 by 720 and 1024 by 768, then do one narrow-layout reachability check. Qualify platform differences.
- [ ] Reuse an existing scenario or extend the affected workflow. Do not add a second automation framework. Keep real CLI accounts, connectors, and customer data outside automated checks.
- [ ] Save screenshots, the bounded interaction video, command receipts, and failures under `artifacts/adoption-ci-execution/<AC-id>/`. Stop only task-owned processes.

## Make check selection explicit and safe (AC-1)

**Depends on.** None. Complete the check inventory first.

**Files.**

- [ ] Inspect and, where needed, edit `.github/workflows/ci.yml`, `.github/workflows/native-tooling-validation.yml`, and `scripts/check-workflows.test.mjs`.
- [ ] Update `docs/ci.md` and create `docs/verification/check-inventory.md`.

**Build.**

- [ ] Map existing checks into local feedback, ordinary PR quality, platform and package coverage, native tooling compatibility, and release publication.
- [ ] Add missing `rust-toolchain.toml` inputs to platform and package routing. Include setup helpers where those jobs execute them.
- [ ] Classify Vite configuration as an input to the cross-platform native build proof. Check other probe inputs against the workflow path list.
- [ ] Add table-driven routing checks for toolchain-only, setup-helper-only, Vite-only, frontend-only, package-script-only, and docs-only changes.
- [ ] Keep Linux quality unconditional and retain the stable CI success result. Keep macOS E2E observational until its existing promotion conditions are met.
- [ ] Document that ordinary app changes do not need isolated native installation and editor proofs unless a tooling input changes.

**You see.**

- [ ] A reviewer can identify which jobs apply and why. A toolchain-only change cannot skip applicable macOS and package checks.

**Verify, unit.** Run the affected checks and retain exact-source evidence.

- [ ] Run `node --test scripts/check-workflows.test.mjs` and `node scripts/check-workflows.mjs` with the pinned actionlint installed. Require every routing case to match its literal expected job set.
- [ ] Use the maintained authenticated online security audit for workflow changes. Do not substitute an older or offline tool and claim equivalent proof.

**Verify, live.** Run the affected checks and retain exact-source evidence.

- [ ] Inspect the candidate PR's actual Actions graph and changed-file routing. Save `routing-and-jobs.json`. Pass when all applicable jobs appear and required failures propagate.
- [ ] Check source-level routing contracts for the cases that the candidate cannot exercise as actual separate PR events. Save `routing-contracts.log`. Do not call those cases hosted executions.

**Verify, perf.** Not applicable to path selection and documentation. Record job counts in the check inventory. Do not claim faster execution from a routing change that adds needed coverage.

**Review gate.** None. AC-1 changes check selection and documentation, not an app interaction.

**Merge.**

- [ ] Require workflow lint, authenticated audit, routing contracts, exact-patch review, applicable hosted checks, and the existing user merge authorization.

## Use ordinary creation and neutral copy labels (AC-2)

**Depends on.** AC-1 for the check inventory. Preserve the existing persistence and generation contracts.

**Files.**

- [ ] Edit `frontend/src/views/SessionEditorView.tsx`, `frontend/src/views/RecordCollectionView.tsx`, `frontend/src/views/RichRecordView.tsx`, and the corresponding controller wiring in `frontend/src/app/AppShell.tsx`.
- [ ] Inspect `frontend/src/app/commandRegistry.ts`, `frontend/src/app/recordActions.ts`, and `frontend/src/app/generationActions.ts`. Change only the creation entry points that need alignment.
- [ ] Update affected component and controller tests, `e2e/specs/clipboard.workflow.mjs`, and existing native creation scenarios.

**Build.**

- [ ] Trace the existing create-on-open persistence before adding another route. Model any new creation intent by record kind, source Session identity, and explicit edit or AI choice. Reuse existing identities and avoid scattered mode flags.
- [ ] Make Create finding and Create test cases start the regular editable workflow from the Note and their respective collection. Remove Manual from buttons, accessible names, success notices, and empty states. Retain internal handler identifiers.
- [ ] Keep the Findings and Test cases tabs as navigation. Align their create actions with the Note actions rather than creating a second editor.
- [ ] Offer Create finding with AI and Create test cases with AI as separate secondary actions on both Note and collection surfaces. Keep Summarize notes a direct AI action with its existing preflight.
- [ ] Ensure ordinary creation works without an authenticated provider. Explain how to enable only the unavailable AI option.
- [ ] Keep ordinary creation and AI generation as separate existing paths. Choose AI before ordinary creation, so it cannot leave a blank record behind. Do not convert an existing edited record into a generation target. Preserve authored content, cancellation, and navigation protection.
- [ ] Rename visible text and accessible labels to Copy, Copying, Copied, and Copy failed across Notes, records, and libraries. Retain screenshot-specific labels and content-scoped feedback.
- [ ] Keep Copy visible while editing. Copy an immutable snapshot of the visible title and content without saving, navigating, generating, or changing dirty state. Mark library copying as saved-content copying in Help.
- [ ] Preserve the existing rich HTML and plain-text clipboard formats. Keep Copy first screenshot separate. Do not rename internal Jira-specific functions or storage identifiers solely for this label change.
- [ ] Keep prefill optional. Explain that prefill is a template from the Note. Disclose any existing truncation instead of implying that all evidence or formatting transfers.

**You see.**

- [ ] Both creation routes open the same editing experience. AI runs only after an explicit choice. Copy is visible and its success follows the exact content copied.

**Verify, unit.** Run the affected checks and retain exact-source evidence.

- [ ] Extend existing controller tests for provider-unavailable creation, matching destination identity, cancellation, stale navigation, and zero unintended blank or duplicate records. Check visible and accessible creation wording, including success notices.
- [ ] Extend `frontend/src/views/CopyControls.test.tsx` and existing copy tests for the new labels, visible edited-content snapshots, unchanged dirty state, failure, and scoped success.
- [ ] Run `bun run frontend:check` and `bun run frontend:test`. Preserve the current literal clipboard serialization expectations.

**Verify, live.** Run the affected checks and retain exact-source evidence.

- [ ] Create a Finding and a test case from the Note with all providers unavailable. Repeat from their collections. Save `creation-defaults.png`. Pass when each opens the correct editable record without an AI request.
- [ ] Choose optional AI using fixtures. Complete one result and cancel another. Save `optional-ai.png`. Pass when generation remains explicit and separate from ordinary creation, authored content survives, and record counts show no unintended blank or duplicate output.
- [ ] Copy a Note, an unsaved record edit, and a saved library record. Save `copy-actions.png` and clipboard readback. Pass when text and HTML match each selected snapshot and copying performs zero saves or navigation changes.
- [ ] Copy the first screenshot separately and check keyboard access in the existing laptop layouts. Save `copy-screenshot-keyboard.png`. Pass when the correct image reaches the clipboard and controls remain reachable.

**Verify, perf.** No separate benchmark for labels and action routing. The unit and live checks above cover side effects. Keep existing startup budgets if the implementation changes boot behavior.

**Review gate.** Review the changed interaction before merge.

- [ ] Give the operator screenshots and one 30 to 60 second video of creation, optional AI, and Copy. Record the independent verdict and any operator feedback. Do not add repeated review rounds for unchanged bytes.

**Merge.**

- [ ] Require focused behavior proof, applicable protected CI, exact-patch review, and the existing user merge authorization. Retain the generation and clipboard safety contracts.

## Help a new tester finish useful work (AC-3)

**Depends on.** AC-2 so examples and instructions describe the final creation flow.

**Files.**

- [ ] Create `docs/getting-started.md` and `docs/user-research-pilot.md`. Update `README.md` and `docs/ai-providers.md`.
- [ ] Add a Help command and extend the existing empty Session view and overlay wiring in `frontend/src/views/SessionEditorView.tsx`, `frontend/src/app/commandRegistry.ts`, `frontend/src/app/AppOverlays.tsx`, and `frontend/src/app/AppShell.tsx`.
- [ ] Create `frontend/src/onboarding/exampleSession.ts`, `frontend/src/onboarding/assets/example-evidence.png`, and focused tests. Reuse existing creation and attachment commands only if the user explicitly chooses a persisted example.

**Build.**

- [ ] Explain the payoff in the empty state. Offer Start a Session and Explore an example. Keep returning users in their existing Session.
- [ ] Make the example clearly labelled and user initiated. Bundle a project-owned synthetic screenshot created for the example, with no customer content. Show it with a short Note and finished Finding. Do not seed real user storage or run AI automatically.
- [ ] Show the example read-only first. If a user chooses to use it, create its Session and image through existing validated commands and preserve normal deletion behavior.
- [ ] Put a task-focused quick start before development instructions. Walk through installation, evidence capture, a Finding, Copy, separate screenshot copying, and reopening saved work.
- [ ] Add Help with that workflow, data location and existing recovery limits, AI setup, and a feedback link. Make feedback submission explicit and keep report contents editable. Do not upload Notes or diagnostics automatically.
- [ ] Add provider-specific setup instructions that distinguish installed, authenticated, and usable. Keep the no-AI path visible. Correct stale Chat labels in the AI guide.
- [ ] Prepare the research script and a minimal result log. Separate install, first-task completion, reporting handoff, and repeat-use questions.
- [ ] Treat a public wiki update as a separately scoped documentation write. Record its reviewed content and destination before publication. Do not silently edit the external wiki during this planning task.

**You see.**

- [ ] A new tester can identify the outcome, explore an example without side effects, create a real Session, and find help without a compiler toolchain or CLI account.

**Verify, unit.** Run the affected checks and retain exact-source evidence.

- [ ] Cover empty-library and returning-user behavior, example selection, zero automatic provider calls, duplicate-click prevention, and explicit Help or feedback actions in existing component and controller tests.
- [ ] Run `bun run frontend:check` and `bun run frontend:test`. Check documentation links and every described action against the built app. Do not write tests that merely mirror prose.

**Verify, live.** Run the affected checks and retain exact-source evidence.

- [ ] Launch with a fresh owned data directory and no ready provider. Save `first-use.png`. Pass when the explanation and both starting choices are reachable and opening an example performs zero provider calls or real Session writes.
- [ ] Follow the quick start using a disposable task. Save `first-use-output.png`. Pass when a Finding can be edited, copied, and reopened without undocumented assistance.
- [ ] Reopen a populated profile and inspect Help with the keyboard. Save `returning-user-help.png`. Pass when no onboarding intercepts existing work and feedback opens only on an explicit action.

**Verify, perf.** Reuse the maintained startup check only if the boot path changes. Require zero automatic example writes and zero new provider requests through the behavior checks above. Measure first-task success in the human pilot, not an app benchmark.

**Review gate.** Review the changed interaction before merge.

- [ ] Give the operator screenshots and one short video of first use and returning use. Have the reviewer follow the instructions independently. Record limitations without adding another UI framework.

**Merge.**

- [ ] Require applicable CI, the demonstrated quick start, exact-patch review, and the existing user merge authorization. Keep a public documentation change linked to its reviewed source.

## Diagnose failures and remove justified repetition (AC-4)

**Depends on.** AC-1 technically. Schedule after AC-3 to keep one writer and avoid concurrent edits to scripts and check documentation.

**Files.**

- [ ] Inspect and edit as needed `scripts/run-e2e.mjs`, `scripts/run-e2e.test.mjs`, `scripts/check-native-tooling-installations.mjs`, `scripts/run-startup-benchmark.mjs`, and `scripts/write-quality-summary.mjs`.
- [ ] Edit `package.json`, `.github/actions/validate-build/action.yml`, `.github/actions/setup-project/action.yml`, `.github/actions/run-built-app-e2e/action.yml`, and caller workflows only where the inventory proves a useful simplification.
- [ ] Update `docs/ci.md`, `docs/development.md`, and the check inventory with the final supported commands and evidence contracts.

**Build.**

- [ ] Record failed stage, command, exit status, signal, spawn error, elapsed time, and timeout before returning failure. Preserve partial startup samples and native installation receipts.
- [ ] Bound subprocess lifetimes using existing process ownership and cleanup mechanisms. Choose limits from observed stage durations. Keep original failures distinguishable from wrapper timeouts.
- [ ] Investigate the retained short startup-assertion failures once. If a fixed sleep is proven to be the cause, replace it with an awaited readiness condition. Preserve real failure behavior with a deterministic delayed or failed-boot case.
- [ ] If the original macOS failure remains unreproduced, state that it is unresolved. Do not label improved diagnostics a root-cause repair or raise all test limits.
- [ ] Keep one documented local fast check, one full verification command, and focused test commands. State exactly what each proves and what it omits.
- [ ] Reassign repeated execution only after the inventory names its authoritative proof owner and the platform coverage tradeoff. Keep the full frontend suite mandatory in unconditional quality and release validation. Native cold/warm lanes own installation and native tooling proof. Prefer deleting unnecessary repetition over creating a new check framework.
- [ ] Preserve independent production-build isolation after E2E, real package install and launch, audits, native cold and warm installation, platform checks, and signing checks. They answer different questions.
- [ ] Keep the intentional exact-run native cache restore separate from reusable Rust caches. Report cold or missed cache honestly. Never broaden cache keys across incompatible tools or platforms just to force hits.
- [ ] Add concise check summaries with stage, duration, cache outcome, first failure, and artifact links. Preserve first-attempt results when a justified retry occurs.

**You see.**

- [ ] A failed run identifies where it stopped and retains useful partial evidence. A developer can choose the correct command without running every command in sequence.

**AC-4 scope amendment, 2026-10-22.** Retained cold/warm receipts show moving
Intel JSDOM failures across unrelated tests. The native installation driver no
longer repeats the full frontend behavior suite six times. That suite stays
unchanged in unconditional quality and release validation. All three native
architectures still prove frozen installation, exact cache restoration, SDK,
compiler, lint, frontend checks, metadata, production build, and isolation.
This intentionally removes the macOS JSDOM matrix signal; it does not claim
equivalent Intel UI coverage. Individual test limits and worker policy remain
unchanged. Existing failed evidence remains failed.

**Verify, unit.** Run the affected checks and retain exact-source evidence.

- [ ] Run affected script tests, including `node --test scripts/run-e2e.test.mjs scripts/startup-benchmark-budget.test.mjs`, and then `bun run release:script-tests` once for the final script patch.
- [ ] Add deterministic spawn-error, timeout, partial-report, and process-cleanup cases at existing test seams. Preserve original exit status and later E2E invocation semantics.
- [ ] If workflows change, run `node scripts/check-workflows.mjs`, its focused contracts, and the maintained authenticated online audit.

**Verify, live.** Run the affected checks and retain exact-source evidence.

- [ ] Exercise an owned failing fixture command and timeout. Save `failure-and-cleanup.json`. Pass when the first error and partial receipts remain, the job fails, and only owned child processes stop.
- [ ] Inspect the candidate's actual hosted quality run and relevant native jobs. Save `hosted-check-summary.json`. Pass when normal work completes, failures are actionable, and applicability matches AC-1.
- [ ] Run the maintained built-app suite for the changed orchestration once. Save the normal invocation receipt. Pass when default invocations remain accounted for and production isolation still passes.

**Verify, perf.** Run the affected checks and retain exact-source evidence.

- [ ] Metric. Compare end-to-end feedback time, execution time, queue time, command counts, and first-attempt failures separately. Record runner, source scope, and cache state.
- [ ] Probe. Use existing Actions timings and summaries for comparable changes. Run a bounded paired probe only for a specific claimed optimization, under the benchmark-checklist skill.
- [ ] Baseline. Capture available pre-change timings and command counts before the simplification. Mark missing comparable evidence explicitly.
- [ ] Rule. Require zero lost validation obligations and zero added blind retries. Report a speedup only with comparable baseline and candidate evidence. Accept clearer commands and diagnostics as the outcome if no safe runtime reduction is demonstrated.

**Review gate.** None. AC-4 changes developer checks and failure reporting, not an app interaction.

**Merge.**

- [ ] Require focused failure proof, workflow checks when applicable, the maintained native orchestration result, exact-patch review, and the existing user merge authorization. Retain existing observational promotion policy.

## Prepare one release after acceptance (AC-5)

**Depends on.** AC-1 through AC-4. The implementation request now authorizes one final release. Verify the next unused version at preparation.

**Files.**

- [ ] Use the maintained bump script to update `package.json`, `frontend/package.json`, `Cargo.toml`, `Cargo.lock`, `src-tauri/tauri.conf.json`, `CHANGELOG.md`, and `build/linux/io.github.ddv1982.qa-scribe.metainfo.xml`.

**Build.**

- [ ] Check current main and unused versions at execution. Use the next appropriate SemVer version. Do not assume v0.8.17 remains available.
- [ ] Prepare one changelog covering the user-visible changes and check improvements. Use `bun run bump <version> --dry-run`, then the maintained write path.
- [ ] Run the full integrated local gate once if current integrated evidence is missing. Keep required hosted validation at the release head. Reuse source-bound tests and native evidence for unchanged product behavior after metadata-only changes. Review the release diff rather than commissioning another full product review.
- [ ] After an authorized protected merge, let the existing CI create the tag and publish. Verify the successful merge build and actual Release run before reporting publication.

**You see.**

- [ ] One coherent release explains ordinary creation, optional AI, Copy, first use, and CI changes. The public installers match the reviewed merge.

**Verify, unit.** Run the affected checks and retain exact-source evidence.

- [ ] Run `node scripts/check-release-metadata.mjs --expected-tag <tag>` at the release head. Run `bun run verify` only if the final integrated product lacks a valid full local receipt. Preserve the source manifest, unchanged-product comparison, original failures, and required hosted validation.

**Verify, live.** Run the affected checks and retain exact-source evidence.

- [ ] Audit the maintained Linux and macOS native receipts for the integrated candidate and changed interactions. Save `integrated-native-evidence.json`. Run missing applicable coverage once and qualify platform limitations.
- [ ] After authorized publication, verify the exact tag and merge SHA, public non-draft release, existing asset inventory, signatures, and live APT version. Save `publication-verification.json`. Do not add an unmaintained portable archive requirement.

**Verify, perf.** Not applicable to metadata-only preparation. Reuse accepted runtime evidence. Record actual release execution and queue times observationally without commissioning a performance study.

**Review gate.** None. AC-5 is version and release metadata preparation. AC-2 and AC-3 own interaction review.

**Merge.**

- [ ] Require focused metadata review, protected CI, and explicit current release authority. Reuse accepted product review and unchanged interaction evidence. Use the existing tag and publication process. Never force, bypass protection, or create a routine manual tag.

## Close the program

- [ ] Check implementation evidence against each applicable box. Mark missing or inapplicable proof with a reason. Do not call this plan or its lint results implementation verification.
- [ ] Deliver the accepted changes and their CI results. If release is authorized, include the actual public release URL and publication evidence.
- [ ] Arrange a small pilot with about five unfamiliar exploratory testers who use a supported OS. The operator recruits participants and obtains permission for any recording. Do not contact people without a separate instruction.
- [ ] Observe one first-use task with neutral outcome instructions. Record assistance, usable output, and successful paste into the actual reporting tool. Separate participants who need AI setup from those using the ordinary workflow.
- [ ] Invite voluntary use over two weeks. Record return use among participants who had another suitable testing task, support needs, and reasons for returning to previous tools. Use a simple research log first.
- [ ] Treat the pilot as qualitative evidence, not a statistical adoption claim or a new mandatory CI gate. Do not hold a safe bug-fix release for two weeks solely to collect retention evidence.
- [ ] Fix the strongest observed barriers in a bounded follow-up. Broaden distribution with a task demonstration and clear download instructions only after there is useful first-task and repeat-use evidence.
- [ ] Leave no task-owned apps, recorders, watchers, schedules, or polling commands running. Retain original failures and unrelated files.

## Appendix A. Prototype evidence

No new runtime prototype, performance measurement, or human session was run for this planning request.
The source audit reads v0.8.16 directly because the local checkout is older. Protected remote main matched that release when this plan was written.
The user supplied the Note, Test cases, and Findings tab screenshot and confirmed ordinary creation as the intended default.
The existing handlers establish ordinary creation, separate AI generation, and immutable clipboard snapshots. AC-2 keeps those separate creation paths.
AC-2 live proof checks action routing, cancellation, and record counts at the candidate SHA. No draft-conversion design or new creation state machine is assumed.
The first-use example, edited-record Copy visibility, real Jira paste, and unfamiliar-user success remain unverified. Their named checks belong to AC-2, AC-3, and the pilot.

## Appendix B. Alternatives rejected

- Add Manual to action labels. The user explicitly rejected that wording.
- Leave Create finding as a direct AI action while the collection offers ordinary editing. The same task would retain inconsistent defaults.
- Keep Jira in the Copy label or rename internal storage and clipboard code for consistency. Use neutral product wording and preserve compatible internals.
- Add paid-provider calls, automatic telemetry, or customer-content uploads to CI. Deterministic fixtures and voluntary research suffice for this scope.
- Replace the CI framework or remove security, cold-install, production-isolation, or signed-package checks without evidence. These prove different obligations.
- Treat a cache miss as a defect or promise the next release is faster. Cache identity and runner conditions determine reuse.
- Require ten parallel agents, a new benchmark per PR, an hourly audit, or repeated reviews of unchanged source. These conflict with the user's simpler-checks priority.
- Enforce arbitrary adoption percentages from five participants. Use observed behavior and opportunities to return as directional evidence.

## Appendix C. Risks

- AC-1 can miss shared action inputs or silently skip a platform. Test routing against actual declared workflow paths and retain unconditional Linux quality.
- AC-2 can create unwanted blanks if an implementation starts ordinary creation before an AI choice. Keep those paths separate and check creation counts.
- AC-2 can copy stale content or show success on another record. Keep immutable target and content snapshots, scoped feedback, and actual clipboard readback.
- AC-3 can seed user data or call AI merely by showing an example. Keep the example read-only until explicit creation and verify zero incidental effects.
- AC-3 public documentation can drift. Treat the user quick start as the maintained source and record any external wiki update separately.
- AC-4 can hide the first failure or terminate another process. Keep structured partial evidence and task-owned cleanup.
- The original macOS startup assertion failures have no established root cause. An unchanged retry is evidence of eventual passage, not a diagnosed repair.
- Some cold and warm installation work is intentionally repetitive. Remove only work whose proof obligation is demonstrably covered elsewhere.
- Tooling and signing are not the main product value for a new tester. Keep the work bounded and stop adding checks once the stated obligations pass.
- Human recruitment and repeat-use outcomes cannot be completed by code review or an autonomous agent. Report that dependency without inventing adoption evidence.

## Appendix D. Links and reading list

Read `CONTEXT.md`, `docs/ci.md`, `docs/development.md`, `docs/releasing.md`, and the existing `docs/ux-workflow-improvement-plan.md` from current main before implementation.
Read `frontend/src/app/recordActions.ts`, `frontend/src/app/copyActions.ts`, `frontend/src/app/commandRegistry.ts`, `frontend/src/views/SessionEditorView.tsx`, and `frontend/src/views/RichRecordView.tsx` for AC-2.
Read `frontend/src/app/useAppStartup.ts`, the provider settings helpers, and the public wiki Getting started page for AC-3.
Read `.github/actions/validate-build/action.yml`, `.github/actions/setup-project/action.yml`, `.github/actions/run-built-app-e2e/action.yml`, all caller workflows, and `scripts/run-e2e.mjs` for AC-1 and AC-4.
Trace the callers, state ownership, and effects before changing shared flows. Compare designs only if a real unresolved decision remains. Preserve the existing separate creation handlers by default.
Prioritize no-account creation and a completed first task. Reuse existing handlers and remove only commands whose proof is already covered.
Verify each implementation change separately. Encode workflow input routing in contract tests and preserve the first failure in structured receipts.
Keep the planning trail in `artifacts/adoption-ci-plan/decisions.tsv`. Keep execution receipts separate from planning receipts.
Research method references are [moderated usability testing](https://www.gov.uk/service-manual/user-research/using-moderated-usability-testing) and [planning user research](https://www.gov.uk/service-manual/user-research/plan-user-research-for-your-service).
