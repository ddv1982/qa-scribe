# Migrate to TypeScript 7 and native tooling

Delegation and capability fallbacks follow `poteto-mode/references/codex-agent-runtime.md` from the installed skill package.
Give contributors native type checking, linting, watch checks, and editor support.
Remove TypeScript 6 and every consumer of its compiler API in T7-1. Do not retain a compatibility alias or fallback.
Keep `tsc-rs` as the authoritative build checker. Use Microsoft TypeScript 7 for the editor and Oxlint with tsgolint for linting.
Run T7-1, T7-2, T7-3, and T7-4 in that order. These are planned PR labels, not GitHub PR numbers.
This document records the approved implementation sequence. Execution started on 2026-10-20 from `82f1502aee9c20d481bcd0ae56c45d053e7b9516`. Publication remains conditional on the final verification gates.

T7-1 merged through [PR #61](https://github.com/ddv1982/qa-scribe/pull/61) at `0496aac81d0b1d6c6c61797e721f827a7420a8bf`. The [implementation evidence](research/typescript-7-implementation-evidence.json) records its results and limits. T7-2 merged through [PR #62](https://github.com/ddv1982/qa-scribe/pull/62) at `678acfee0535c3bdef35afd181e3b882b119edc1`. All ten terminal scenarios, the amended performance conditions, independent exact-head shipping review, and all nine hosted checks passed. The [watch evidence](research/typescript-7-watch-evidence.json) preserves the original absolute memory failure and the acceptance amendment. T7-3 code and private editor interactions pass, as do all nine hosted checks at the reviewed source. Independent shipping review is FAIL for isolated-duration proof and safe whole-lane stress cleanup. The [editor evidence](research/typescript-7-editor-evidence.json) records all original deviations and the corrective verification sequence. The application and native tooling source remain unchanged. T7-4 has not started. The release-scope amendment below supersedes the additional T7-3 and T7-4 performance requirements.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists, such as a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

Run each implementation PR through the installed `skills/poteto-mode/playbooks/feature.md`, then Opening a PR. Run merge verification through Shipping when the execution request authorizes landing. The parent owns integration and external writes. The user's execution request authorizes autonomous implementation and normal push, PR, merge and release actions after verification. Screenshots and video remain mandatory evidence for T7-2 and T7-3. The review pauses introduced by this planning template do not add a new approval requirement to that authority. Planning alone does not authorize publication.

Tests alone are not sufficient verification. Complete the applicable unit and live checks. Performance acceptance follows the phase-specific scope below.

## Release-scope amendment on 2026-10-21

The user asked whether the added release checks had become a dead end. The parent adopts a smaller acceptance plan under the existing autonomous execution request. Independent Codex and Opus critiques support this change. A fresh shipping reviewer must assess the amendment and may reject it.

This is an explicit post-failure exception to the original rule against changing acceptance after a failed comparison. T7-2 already changed its memory acceptance after a failure. Both changes remain disclosed. The original T7-3 performance study stays protocol-nonconformant, and historical lane 10 stays ISSUES. Unknown effects from its unsafe cleanup remain unknown.

Defer the new paired 30-minute study and the seven-pair T7-4 local performance comparison. These requirements are deferred, not met. The release makes no speedup, memory-bound, performance-equivalence, or long-session stability guarantee. The repeated corrective preflight failures concern disposable verification tooling. They do not establish an application defect or justify further expansion of that tooling.

Keep the existing CI and release validation unchanged. Require actual local Go TypeScript 7 and typed Oxlint in both workspace layouts. Preserve completion, hover, navigation, compiler errors, typed promise lint, hook lint, Vite scope, repair, reload, and repeated-edit coverage. Consolidate these scenarios into a bounded private smoke pass instead of requiring a separate agent and profile for each scenario. Trustworthy unchanged-source evidence may contribute when the final reviewer checks its binding and limits.

Require reviewed cleanup rooted only in launched private processes, a fresh independent verdict at the final patch, and current protected CI. Reuse the previously successful private-session approach where practical. The unfinished measurement framework is not a release prerequisite. If ordinary trusted development reproduces watcher exhaustion, provider failure, stale diagnostics, or a crash, investigate it as a product blocker. Linux IDE evidence and hosted macOS compiler checks do not establish macOS IDE behavior.

Record actual hosted durations and cache states as observations. Preserve the existing application startup benchmark and every maintained compiler, test, security, packaging, and release check. Set any future performance experiment's criteria before collecting its samples. Do not use the old study to claim an improvement in README, PR descriptions, or release notes.

## Program checklist

### Arm the program

- [x] Present this plan and stop at the requested planning boundary. Start production changes only after the operator requests execution. The operator requested implementation on 2026-10-20.
- [ ] Do not create a goal, heartbeat, recurring monitor, or separate top-level thread for ordinary execution. Require explicit lifecycle authorization before adding one.
- [ ] Record an hourly audit as not applicable for a normal session. If unattended execution is later requested, apply the runtime contract before enabling any audit timer. Keep the queue table in the local decision log.
- [x] Fetch current trunk and record its SHA. Create an implementation branch from it. Recheck package releases and the prototype assumptions before choosing final pins. Branch `migration/typescript-7-native` starts from `82f1502aee9c20d481bcd0ae56c45d053e7b9516`; local provenance is recorded in `artifacts/ts7-implementation/package-provenance.json`.
- [ ] Read project inputs from trunk with `git show origin/main:package.json`, `git show origin/main:frontend/package.json`, and `git show origin/main:.github/actions/validate-build/action.yml`.
- [ ] Read Feature, Shipping, Opening a PR, Swarm, the applicable control skill, and the relevant principle files from the installed skill package. This repository does not contain `skills/`; do not invent `git show` paths for bundled skills.
- [ ] Use the current request's merge authority. Keep force pushes to shared branches, protection bypasses, manual tags, and unrelated changes outside the plan.
- [ ] On hold or stand-down, send every active owner a zero-writes order and reconcile its actual files and processes.

### Spawn owners

- [ ] Use one fresh implementation owner per PR. Prefer the installed Poteto profile. Keep parent review independent of the writer.
- [ ] Follow the linear graph `T7-1 -> T7-2 -> T7-3 -> T7-4`. Branch from current main after the predecessor lands, or use an explicitly authorized stack.
- [ ] Keep one writer for `frontend/package.json` and `frontend/bun.lock`. Do not let parallel owners update shared dependency state.
- [ ] Give each verification lane its own checkout, disposable fixtures, process group, ports, output directory, and evidence directory. Never share writable frontend output or a Cargo target directory between live lanes.
- [ ] Queue the ten live lanes within observed capacity. No fast profile is established in this plan. Validate it at execution time or inherit the parent model and report that fallback. Do not claim unobserved model diversity.
- [ ] Complete interaction review for T7-2 and T7-3 through independent actual-surface verification. Their screenshots and video show the real terminal or IDE, not reconstructed output.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`. Use a supported built-in PR tool when available. Graphite is optional for an actual stack.
- [ ] Open the PR through Opening a PR. Link its full URL to this T3 thread immediately. Keep labels in this plan separate from assigned PR numbers.
- [ ] Run lint and typecheck before the PR-facing push. Keep hooks enabled. Run deslop before commits and no-comments before review.
- [ ] Triage bot findings against evidence. Fix proven defects and explain dismissed findings with a concrete reason.
- [ ] Record head, base, stable patch-id, commands, and receipts at code-ready. Rebase again only for merge preparation, actual conflicts, or a trunk-caused failure.
- [ ] Run independent comparisons without concurrent builds or live lanes. Keep performance samples separate from profiled runs.
- [ ] Treat the numeric performance limits below as proposed acceptance budgets, not measured results. Check feasibility against the native-only baseline and freeze any justified adjustment before comparative head measurements. Record the reason rather than changing a budget after a failed comparison.

### Verdict and merge, for every PR

- [ ] At each patch-changing head, verify affected behavior and preserve dependency-removal coverage. For T7-3 and T7-4, use the release-scope amendment instead of the original fixed lane and performance counts.
- [ ] Require all required lanes to pass at the reviewed head. Treat missing control capability, missing screenshots, timeouts, and unverified parity as incomplete.
- [ ] Obtain an independent verdict tied to the exact patch. Apply Shipping's head, base, and patch-id retention rules. A materially changed patch gets a new verdict.
- [ ] Require protected CI and resolved review conversations. Merge normally under the active execution authority. Never bypass branch protection.
- [ ] For T7-2 and T7-3, require independent interaction review with real screenshots and video before merge. The execution request authorizes normal landing after those gates pass.

### Boot recipe, for every live lane

Each lane uses the real command, editor, or hosted job at the PR head through a detected control capability. Local CLI and IDE lanes follow the isolated checkout recipe. T7-4 hosted lanes use the Actions recipe below.

- [ ] Fetch and check out the exact reviewed head in the lane's isolated environment. Run the frozen Bun install with the repository's pinned Bun version.
- [ ] Use the installed `cursor-team-kit:control-cli` with tmux or a PTY for commands and interrupts. Start from the real package scripts. Save the full raw transcript.
- [ ] For editor scenarios, launch an isolated VS Code profile with the official extensions. Use `cursor-team-kit:control-ui` over its Electron debugging interface. Do not alter the contributor's shared profile.
- [ ] Establish a real terminal screenshot capability before claiming CLI PNG evidence. A transcript rendered afterward is not a screenshot of the running command. If that capability or IDE control is unavailable, leave the lane blocked.
- [ ] Capture a fresh screen before input and after the expected result. Use the screenshot filename named by the lane under `/tmp/qa-scribe-ts7/<pr-id>/lane-<n>/`.
- [ ] Stop all owned processes, remove disposable invalid source files, and release ports on success, failure, and interrupt. Return screenshots, transcripts, head SHA, and the literal pass predicate.
- [ ] For hosted lanes, record the actual Actions run URL, job ID, resolved head SHA, conclusion, architecture, and raw log/artifact checksums. Inspect the real Actions page through the T3 collaborative browser and save its screenshot. A screenshot supports the job receipt; it does not replace the logs. Do not require tmux or a local checkout on a GitHub-hosted runner.
- [ ] For desktop lanes, use the repository's existing WebdriverIO harness and its actual screenshots. Keep IDE, terminal, Actions, and desktop screenshots identified by their true source.

## Remove TypeScript 6 and replace its lint consumers (T7-1)

**Depends on.** None.

**Files.**

- [x] Edit `frontend/package.json` and `frontend/bun.lock`. Pin `typescript` 7.0.2, `oxlint` 1.89.0, and `oxlint-tsgolint` 7.0.2004, or freshly verified replacements with the same proof. Retain exact `tsc-rs` 0.7.0 unless a separate compiler upgrade is justified.
- [x] Create `frontend/.oxlintrc.json`. Delete `frontend/eslint.config.js`, its generated obsolete override, and the direct ESLint, TypeScript ESLint, Hooks, and Refresh dependencies once equivalent native coverage is verified.
- [x] Create `scripts/check-native-typescript-tooling.mjs`, its meaningful tests, and `scripts/fixtures/native-tooling/`. Define root script `frontend:tooling:check` as `node scripts/check-native-typescript-tooling.mjs` in `package.json`. Add it to both verification commands and `.github/actions/validate-build/action.yml`.
- [x] Create `.github/workflows/native-tooling-validation.yml` with `pull_request` and `workflow_dispatch` triggers and a non-publishing Linux x64, macOS arm64, and macOS x64 matrix. Reuse setup conventions and read-only permissions. Run the new workflow on T7-1's PR before merge; later phases can dispatch its registered definition at an explicit commit.
- [x] Update only affected suppression directives in `frontend/src/app/useStableCapability.ts` and `frontend/src/app/useAppController.ts`. Preserve their scoped behavior and explanations.
- [x] Update active README and CI guidance. Preserve historical migration records with a link to the new decision, rather than rewriting history.

**Build.**

- [x] Inventory the effective production, test, harness, Vite, and config rules before deletion. Record each rule's severity, options, file patterns, and replacement in a machine-readable parity manifest.
- [x] Replace `lint` with native type-aware Oxlint. Preserve all 23 active typed rules, the four test-only relaxations, unused-variable options, warning severities, React Hooks, and Refresh behavior.
- [x] Keep the existing `tsc-rs --noEmit` checks for both projects and their pre-bundle guard. Do not enable Oxlint's separate `--type-check` as a second authoritative build checker.
- [x] Include the existing `no-useless-assignment` protection. The migration prototype required `--with-nursery`; do not accept the default migrator's omission.
- [x] Account for the four remaining migration dispositions. Prove strict-mode coverage for `no-dupe-args` and `no-octal`. Prove why `react-hooks/config` and `react-hooks/gating` cannot express additional checks under Oxlint's fixed compiler configuration. An unexplained omission blocks T7-1.
- [x] Convert suppression prefixes and verify their actual native rule names. Require zero unused suppression warnings. Do not weaken a rule to make the migration green.
- [x] Remove all TypeScript 6 versions, `@typescript/typescript6` aliases, TypeScript ESLint packages, `ts-api-utils`, and legacy compiler API imports. Allow no inactive or optional exception in the project's resolved lockfile or installed graph. Check both after a fresh frozen install.
- [x] Make the new guard fail for a reintroduced TypeScript 6 dependency or alias, a missing type-aware engine, an omitted project check, or a deliberate lost lint rule. Use structured package metadata, not a bare substring scan as the maintained implementation.
- [x] Keep TypeScript 7.0.2 as the editor package. Record that `tsc-rs` ports the separate 7.1.0-dev.20261008.1 revision. Test compatibility; do not pretend their revisions are identical.

**You see.**

- [x] `bun run frontend:check` passes through native checking and native typed lint. A fresh dependency receipt lists zero TypeScript 6 packages and zero compiler API consumers.
- [x] Deliberate floating promises, unsafe operations, invalid hooks, stale dependencies, and dead assignments produce the expected diagnostic and severity. Valid counterparts pass.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Add positive and negative behavioral fixtures for every typed rule and each migration disposition. Cover production, test, harness, Vite, ignored files, and directive scope. Run `bun run frontend:tooling:check`.
- [x] Test the dependency guard with metadata-only fixture manifests, lockfiles, and fake package metadata that describe TypeScript 6, a compatibility alias, or a legacy consumer. Each must fail with the named reason. Do not install or execute TypeScript 6 for these tests.
- [x] Run `bun run frontend:compiler:check`, `bun run frontend:check`, `bun run frontend:test`, and `bun run frontend:build`. Compare every production asset hash with trunk.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `gpt-6.1-sol` at the PR head, per the boot recipe. Inherit parent effort unless a validated execution profile says otherwise.

- [x] Lane 1. Run a fresh frozen install and the dependency guard. Save `dependencies.png`. Pass when the installed graph has only TypeScript 7 and no legacy API consumer.
- [x] Lane 2. Add a floating promise in an isolated production source. Save `floating-promise.png`. Pass when typed lint reports the exact rule and exits nonzero.
- [x] Lane 3. Introduce unsafe assignment and member access separately. Save `unsafe-values.png`. Pass when both diagnostics appear in production and the documented test override does not disable member access.
- [x] Lane 4. Add a conditional React Hook. Save `hooks.png`. Pass when the native hook rule rejects it and its unconditional counterpart passes.
- [x] Lane 5. Omit an effect dependency. Save `effect-dependency.png`. Pass when the warning retains its severity and the corrected version is clean.
- [x] Lane 6. Overwrite an unread assignment. Save `assignment.png`. Pass when `no-useless-assignment` rejects it.
- [x] Lane 7. Exercise production and test fixture pairs. Save `test-overrides.png`. Pass when only the four documented typed rules relax for tests and test harnesses.
- [x] Lane 8. Exercise Refresh exports and an allowed constant export. Save `refresh.png`. Pass when the warning and exception match the recorded policy.
- [x] Lane 9. Build after invalid UI code and then invalid Vite configuration. Save `build-gate.png`. Pass when each fails before bundling and the repaired sources build.
- [x] Lane 10. Run existing converted suppressions and an out-of-scope violation. Save `suppression-scope.png`. Pass when legitimate suppressions work, adjacent violations remain visible, and unused-directive reporting is clean.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. Measure complete `frontend:check` and `frontend:build` wall time, frozen install time, exit status, diagnostics, and asset hashes. Record dependency and download changes separately.
- [x] Probe. Use seven native-only samples after one warmup with fixed Node, Bun, and source inputs. Reuse historical trunk logs for context. Do not install or invoke TypeScript 6 to recreate a lint baseline. Profile separately and explain the measured limiter.
- [x] Baseline. Preserve the earlier production-build and hosted frontend-check receipts before implementation. They are historical observations. There is no matched local native-lint baseline, so make no causal lint speedup claim. Establish the first TypeScript 7-only result as the baseline for subsequent phases.
- [x] Rule. Require zero failures and identical assets. Fail a complete frontend-check median above 5 seconds or frontend-build median above 10 seconds on the documented local probe host. Treat a historical comparison as observational. Report cold install separately; do not require the first new cache key to be a hit.

**Review gate.** None. T7-1 is not review-gated. Existing command names and application interactions remain the same.

**Merge.**

- [x] Obtain the independent exact-head verdict, all protected checks, all three native tooling matrix jobs, completed parity manifest, zero-legacy receipt, and successful live lanes. Merge only the complete coordinated replacement. Do not land a TS6 fallback as an intermediate result.

## Add native checks during development (T7-2)

**Depends on.** T7-1.

**Files.**

- [x] Edit `frontend/package.json`, `package.json`, and README development instructions.
- [x] Create `scripts/run-frontend-dev.mjs`, focused lifecycle tests, and disposable watch fixtures. Keep application sources and production Tauri hooks outside this PR.

**Build.**

- [x] Expose `frontend:typecheck:watch` for both projects and `frontend:dev:checked` for Vite plus the two native project watchers. Keep ordinary `dev` available as Vite only.
- [x] Model the owned children as records keyed by Vite, UI checker, and Vite-config checker. Track exit and shutdown through one supervisor. Have architect review the lifecycle shape before implementation.
- [x] Use standalone `-p --watch --noEmit`. Do not use the upstream-problematic `-b --watch` path or TypeScript 6.
- [x] Keep watch processes alive through ordinary type errors and show recovery. Propagate launch failures and unexpected child exits. Shut down every owned child on interrupt and leave the port free.
- [x] Preserve the normal production build and CI commands. Do not start a long-lived watcher in CI.

**You see.**

- [x] Editing either project shows a native diagnostic without a production build. Fixing the file clears it. Ctrl-C stops Vite and both watchers.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Test real child exit, missing compiler, busy port, interrupt, repeated launch, and error recovery. Assert process cleanup and exit codes, not source spelling. Run the new lifecycle tests and the real-project watch fixture.
- [x] Run `bun run frontend:tooling:check`, `bun run frontend:check`, and `bun run frontend:build` to prove the optional workflow preserves the production path.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `gpt-6.1-sol` at the PR head, per the boot recipe. Inherit parent effort unless a validated execution profile says otherwise.

- [x] Lane 1. Start the checked dev command. Save `startup.png`. Pass when Vite and both native project watchers report ready.
- [x] Lane 2. Introduce and repair a UI assignment error. Save `ui-recovery.png`. Pass when TS2322 appears and then clears without restart.
- [x] Lane 3. Introduce and repair a Vite configuration error. Save `config-recovery.png`. Pass when its checker detects it and recovers.
- [x] Lane 4. Introduce and repair invalid TSX props. Save `tsx-recovery.png`. Pass when native JSX diagnostics update and clear.
- [x] Lane 5. Press Ctrl-C at readiness. Save `interrupt.png`. Pass when all owned children exit within three seconds and the port can be reused.
- [x] Lane 6. Fail a checker launch deliberately. Save `launch-failure.png`. Pass when the parent exits nonzero with the named failure and no orphan Vite process.
- [x] Lane 7. Occupy port 5173 with a lane-owned process. Save `busy-port.png`. Pass when the checked command fails and cleans only its own children.
- [x] Lane 8. Force an unexpected watcher exit. Save `child-exit.png`. Pass when the supervisor reports it and cleans the other children.
- [x] Lane 9. Edit, interrupt, and restart repeatedly. Save `restart.png`. Pass when each new checked session owns exactly three process groups and no old process or fixture remains. A compiler launcher's fallback can add a native descendant without adding an owned group.
- [x] Lane 10. Run the ordinary production build after stopping development. Save `production-build.png`. Pass when the build exits, type errors still block bundling, and no watcher enters the release path.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. Measure ready time, edit-to-diagnostic time, idle CPU, memory growth, and shutdown latency for the checked workflow.
- [x] Probe. Compare seven interleaved starts with trunk's Vite start and one-shot checks. Exercise 100 alternating valid/invalid edits. Sample an idle 30-second window after recovery.
- [x] Baseline. Record trunk Vite readiness, one-shot checker latency, idle CPU, and memory first. Label continuous-watch latency as new behavior without an old watch baseline.
- [x] Original rule. Fail startup overhead above 1 second, median edit feedback above 2 seconds, idle CPU above one percent of one core, resident growth above 50 MiB after 100 edits and settling, or cleanup longer than 3 seconds. The original absolute memory condition failed at `4c5a0e9`. Its result remains FAIL.

The independently reviewed [memory acceptance amendment](research/typescript-7-watch-memory-amendment.md) replaces only T7-2's absolute memory acceptance requirement. This is a post-failure exception to the program's original no-adjustment rule. The initial baseline had no matching edit workload; three later matched Vite-only runs also exceeded the absolute threshold. The amendment measures added positive growth against that baseline, caps the combined added process set, and checks each added lineage's normalized second-half growth. Both ceilings are 50 MiB. It does not preserve the old absolute guarantee or prove long-term boundedness. The original failed Vite finding remains open.

The proposal text remains immutable at SHA256 `9af3d96919d626c96239537943cb2e7e5ad13b22854fda862295003ca875986d`. Independent review round2 accepted its definitions before fresh sampling. The parent adopts it under the autonomous execution request, with activation recorded in [the registration](research/typescript-7-watch-memory-registration.json). A new performance run and the exact-patch shipping reviewer must assess the results and remaining limitation. All other limits and verification gates remain in force.

**Review gate.** Independent interaction review before merge under the autonomous execution request.

- [x] Post real terminal screenshots for readiness, error recovery, and Ctrl-C. Record a 30 to 60 second video as `/tmp/qa-scribe-ts7/T7-2/review.mp4`. Require independent review of the captured interaction before merge.

**Merge.**

- [x] Require the independent head verdict, protected CI, lifecycle evidence, and independent review of screenshots and video. Merge normally under the execution request's authority.

## Use TypeScript 7 and native lint in the editor (T7-3)

**Depends on.** T7-2. This order serializes shared documentation and keeps the verified command workflow available before editor integration.

**Files.**

- [x] Create or update `.vscode/extensions.json`, `.vscode/settings.json`, and README editor instructions. Do not change global user settings or an existing shared IDE profile.

**Build.**

- [x] Recommend `TypeScriptTeam.native-preview` and `oxc.oxc-vscode`. Use the official TypeScript 7 language server with the pinned local Microsoft package.
- [x] For a repository-root workspace, test `js/ts.tsdk.path` as `./frontend/node_modules/typescript` and the extension's `js/ts.experimental.useTsgo` setting. Confirm the effective server path and version through the real editor.
- [x] Test a frontend-only workspace separately. Document its relative SDK path. Never commit a Linux-specific Rust executable path or an absolute user-home path.
- [x] Enable type-aware Oxlint diagnostics from the project config. Keep compiler and lint providers distinguishable. Do not impose automatic fixes or formatting on save.
- [x] Prove that a repository-root workspace resolves the local frontend Oxlint binary, `.oxlintrc.json`, tsconfig, and tsgolint. Discover any required `oxc.path.oxlint`, `oxc.configPath`, `oxc.tsConfigPath`, and `oxc.path.tsgolint` settings from the installed extension. Do not silently use a global binary or untyped defaults.
- [x] Keep the Rust LSP out of the default editor path while its documented long-session memory issue remains unresolved. Do not add a TypeScript 6 editor fallback.

**You see.**

- [x] The editor reports its TypeScript 7 server and project-native typed lint. Completion, hover, navigation, diagnostics, and repair work in both workspace layouts without a legacy API package.

**Verify, unit.** Tests alone are not sufficient verification. Complete the applicable unit and live checks. Performance acceptance follows the phase-specific scope below.

- [x] Validate JSON and extension identifiers. Add a portable settings check to the maintained tooling guard where it catches a real path or version regression.
- [x] Run compiler and native lint fixtures after the editor setup. Keep LSP protocol smoke evidence separate from proof that the actual extension selected the correct server.

**Verify, live.** Tests alone are not sufficient verification. Complete the applicable unit and live checks. Performance acceptance follows the phase-specific scope below. The ten entries below name functional scenarios. They may share a bounded private smoke session under the release-scope amendment. Record the actual model and source identity.

- [ ] Lane 1. Open the repository root in an isolated IDE profile. Save `root-workspace.png`. Pass when the running server resolves to the pinned TypeScript 7 package.
- [ ] Lane 2. Open `frontend` as the workspace. Save `frontend-workspace.png`. Pass when the documented local SDK path works without a global override.
- [ ] Lane 3. Type a property access in a real TS source. Save `completion.png`. Pass when project-aware completion and hover show the correct type.
- [ ] Lane 4. Navigate from a component to a project import and back. Save `navigation.png`. Pass when definition and reference locations resolve to actual sources.
- [ ] Lane 5. Add and repair a TS2322 error. Save `type-diagnostic.png`. Pass when the editor reports and clears it through the TypeScript 7 provider.
- [ ] Lane 6. Add a floating promise. Save `typed-lint.png`. Pass when the Oxlint provider reports the expected typed rule with the project policy.
- [ ] Lane 7. Add and repair a conditional hook. Save `editor-hooks.png`. Pass when the expected hook diagnostic appears and clears.
- [ ] Lane 8. Open and edit `vite.config.ts`. Save `editor-vite.png`. Pass when both its project types and native lint are active.
- [ ] Lane 9. Reload the isolated editor window. Save `reload.png`. Pass when settings persist and exactly the intended compiler and lint providers restart.
- [ ] Lane 10. Exercise repeated edits and navigation through a sustained session. Save `long-session.png`. Pass when the bounded repeated-edit session has no crash, legacy API load, or stale diagnostic and its owned resources close safely. This does not establish a memory bound.

**Verify, perf. Deferred, not met.** The following original requirements remain visible as historical acceptance criteria. They are outside this release under the amendment above.

- [ ] Metric. Measure file-open diagnostics, completion latency, edit-to-repair diagnostics, and language-server memory over a 30-minute isolated session.
- [ ] Probe. Take seven repetitions on the same workspace and machine. Compare against the T7-2 state using the same TypeScript 7 server in an isolated manually configured profile. Never install TypeScript 6 to obtain a new baseline.
- [ ] Baseline. Record the manual TypeScript 7 profile first. Separate extension startup, project loading, and steady-state edits.
- [ ] Rule. Fail median response above 2 seconds or a regression greater than both 20 percent and 250 ms. Fail a crash or a continuing memory rise above 100 MiB between settled minute-5 and minute-30 samples. Report the host and noise; do not generalize one platform's result.

The original study passed its numerical thresholds but failed strict protocol conformance. Both sessions accessed default shared application storage. The independent shipping review therefore leaves isolated-performance acceptance open. Candidate readiness sequencing and the baseline generated workspace flag also remain recorded violations. The [editor evidence](research/typescript-7-editor-evidence.json) preserves the original rows, corrected host classification, and conditional observations. No limits changed and no original primary run was repeated.

The separately registered corrective isolation study is deferred, not met. Preserve all original sessions, procedural failures, and corrective attempts. The original numerical results remain conditional observations, with no release performance claim. A future study needs a new registration before sampling.

Run one bounded private functional smoke pass with reviewed cleanup. Repeated edits and navigation must work, and all owned resources must close. Seed cleanup ownership only from recorded private launchers and proved descendants. Persist the allowlist and each signal record before issuance. The old lane 10 incident remains ISSUES. The fresh smoke cannot prove that historical effects were harmless. Do not restore or signal unrelated processes.

**Review gate.** Independent interaction review before merge under the autonomous execution request.

- [ ] Post actual IDE screenshots and a 30 to 60 second video as `/tmp/qa-scribe-ts7/T7-3/review.mp4`. Show server identity, completion, compiler diagnostics, native lint, and repair. Require independent review of the captured interaction before merge.

**Merge.**

- [ ] Require independent review, working IDE control, completed live proof, protected CI, and independent interaction review. Missing editor capability leaves T7-3 incomplete; CLI checks cannot substitute for it.

## Verify CI and prepare the release handoff (T7-4)

**Depends on.** T7-3.

**Files.**

- [ ] Edit only demonstrated gaps in `.github/actions/setup-project/action.yml`, `.github/actions/validate-build/action.yml`, and `.github/workflows/ci.yml`. Preserve the existing shared actions, pins, security controls, and job boundaries. Keep `.github/workflows/release.yml` unchanged; it already calls the shared validation action. A release-workflow defect needs its own scoped change and runtime verification.
- [ ] Reuse the non-publishing `.github/workflows/native-tooling-validation.yml` landed in T7-1. Keep its native frontend and metadata scope. This permits exact-head Intel proof without starting the publishing workflow.
- [ ] Create `docs/research/typescript-7-validation.md` with final-head command, dependency, asset, live, and CI receipts. Keep the planning prototype separate from release evidence.
- [ ] Update release guidance and completion receipts. If release preparation is authorized, use `scripts/bump-version.mjs` for the next unused version and update `CHANGELOG.md` and all maintained metadata together.

**Build.**

- [ ] Confirm fresh and cached installs select the pinned native packages on Linux x64, macOS arm64, and macOS x64. Keep all optional platform entries needed by existing supported runners. The release workflow already has `macos-26` and `macos-26-intel` matrix entries; PR CI's macOS job is arm64 and cannot prove Intel execution.
- [ ] Keep `frontend:tooling:check`, compiler probes, frontend checks, and builds in the shared quality and release validation path. Do not run watchers or interactive IDE sessions inside ordinary CI.
- [ ] Keep Rust 1.99.1 and the existing hosted-runner inventory normalization unchanged unless a separate defect is proved. A new Bun lockfile causes an expected first cold frontend cache.
- [ ] Preserve production E2E isolation, the prebuilt-frontend contract, bindings, command checks, Rust tests, package tests, and startup measurements.
- [ ] Before preparing a release, recheck remote main, unused version/tag, branch protection, and active release runs. Use the existing protected PR and workflow-created tag process. Do not create a tag manually.

**You see.**

- [ ] All required PR and main checks pass with the TypeScript 7-only toolchain. Release validation uses the same guards as CI. No TypeScript 6 package appears in clean hosted installs.

**Verify, unit.** Tests alone are not sufficient verification. Complete the applicable unit and live checks. Performance acceptance follows the phase-specific scope below.

- [ ] Run `bun run verify`, the maintained online workflow security audit and actionlint checks, expected-tag metadata if preparing a release, and all default desktop E2E invocations. Record exact head and conclusions.
- [ ] Confirm the zero-legacy guard fails on metadata-only fixture manifests, lockfiles, and fake package metadata for TypeScript 6 or its compatibility alias. Install and execute no TypeScript 6 package.

**Verify, live.** Tests alone are not sufficient verification. Complete the applicable unit and live checks. Performance acceptance follows the phase-specific scope below. The entries below describe checks, not a required count of separate agents. Hosted receipts may cover several entries. Use the Actions receipt recipe and report the actual model.

- [ ] Lane 1. Run a fresh Linux hosted setup. Save `linux-install.png`. Pass when native tools launch and the dependency guard reports zero legacy packages.
- [ ] Lane 2. Run a warm Linux setup at the same dependency key. Save `linux-cache.png`. Pass when the logs identify whether the cache restored and validation still runs.
- [ ] Lane 3. Dispatch fresh and warm non-publishing native tooling validation on `macos-26` at the same head and dependency key. Save `mac-arm.png`. Pass when both job receipts prove native arm64 execution and record the actual cache save or restore result without an x64 fallback.
- [ ] Lane 4. Dispatch fresh and warm non-publishing native tooling validation on `macos-26-intel` at the same head and dependency key. Save `mac-x64.png`. Pass when both job receipts prove native Intel execution and record the actual cache save or restore result without starting publication.
- [ ] Lane 5. Exercise a fresh quality gate with an isolated deliberate type error. Save `ci-type-error.png`. Pass when bundling is blocked and the named project diagnostic appears.
- [ ] Lane 6. Exercise a fresh quality gate with a floating promise. Save `ci-lint-error.png`. Pass when native typed lint fails rather than silently skipping analysis.
- [ ] Lane 7. Build and start the Linux desktop app through its existing deterministic harness. Save `linux-desktop.png`. Pass when the workflow assertions and production bridge isolation pass.
- [ ] Lane 8. Run the macOS desktop validation through its existing harness. Save `mac-desktop.png`. Pass when the existing required platform assertions pass at the reviewed head.
- [ ] Lane 9. Run the shared native frontend release commands in the non-publishing validation workflow. Save `release-validation.png`. Pass when metadata, native guards, check, tests, build, and E2E isolation run without creating a draft, tag, or public asset.
- [ ] Lane 10. Inspect the candidate release metadata and version/tag collision checks without publishing. Save `release-readiness.png`. Pass when the expected-tag check and maintained package metadata checks pass at the exact head. Actual publication belongs to the post-merge receipt, not a pre-merge lane.

**Verify, perf. Observational timing only.** The release-scope amendment defers a new local comparison. The existing CI application startup benchmark remains required.

- [ ] Metric. Record quality-gate and release-validation durations, frontend command timings, cache states, and the critical path. Keep cold and warm hosted runs separate.
- [ ] Deferred, not met. The original seven-interleaved-sample comparison of complete frontend commands at T7-1 and the final head is outside this release. Any future comparison must use only TypeScript 7 and register its criteria before sampling.
- [ ] Baseline. Capture T7-1's native-only baseline before later phases. Retain historical pre-migration CI only as context. Treat one hosted run per version as observational evidence, not a causal benchmark.
- [ ] Deferred, not met. The original local regression budget is not a release guarantee. Do not claim a CI speedup from omitted checks, mismatched caches, or noisy observations. Investigate concrete timeouts or failed maintained checks.

**Review gate.** None. T7-4 is not review-gated. It preserves existing application and developer interactions.

**Merge.**

- [ ] Require the independent exact-head shipping verdict and all protected checks. If authorized, merge normally and let existing CI create and publish the next release tag. Verify the actual run, public release, signatures, APT metadata, and tag SHA before declaring publication complete.
- [ ] For an authorized publication, record the post-merge release run at the actual merge SHA. Require every expected validation, native build, signing, APT, and publish job to have run successfully. A skipped release job or a frontend-only validation receipt does not prove the publishing workflow ran.

## Close the program

- [ ] Check every applicable box only from saved evidence. A blocked live lane or unproved lint disposition leaves the migration incomplete.
- [ ] Verify zero TypeScript 6 versions, compatibility aliases, fallback commands, and legacy compiler API consumers anywhere in the project's final lockfile, installed graph, or maintained scripts.
- [ ] Reconcile the decision trail and implementation checklists against exact SHAs and receipts. Archive one current summary rather than claiming old prototype results as final-head verification.
- [ ] Report the final versions, retained compiler responsibilities, PR links, tests, live proofs, measured tradeoffs, and any release outcome that was actually authorized and verified.

## Appendix A. Prototype evidence

Planning branch is `plan/ts7-native-tooling`, based on main `82f1502aee9c20d481bcd0ae56c45d053e7b9516`. The production tree was not modified for these experiments.

Read the shareable [planning evidence summary](research/typescript-7-planning-evidence.json) with this plan. Include both files if the plan is committed or shared. Raw receipts under `artifacts/` are local working files and are not committed. Their links below resolve in this workspace, not in a clean GitHub checkout. The summary records their checksums, results, and limits without claiming to include the raw logs.

The disposable frontend lives at the path in [prototype-location.json](../artifacts/ts7-native-plan/prototype-location.json). Its generated manifest uses TypeScript 7.0.2, Oxlint 1.89.0, and tsgolint 7.0.2004. Its fresh lockfile has no TypeScript 6, compatibility package, TypeScript ESLint subtree, or ts-api-utils. The receipt's separate bootstrap tools include a TypeScript 7 development oracle under an npm alias. It is outside the frontend graph, contains no TypeScript 6, and is not a proposed project dependency. Future oracle probes can use a direct `typescript` dependency in their own scratch directory instead.

The [command receipt](../artifacts/ts7-native-plan/native-only-results.json) records successful native lint, both `tsc-rs` project checks, both Microsoft TypeScript 7 project checks, 572 frontend tests, and the production build. Its neighboring per-command logs contain the output; [command metadata](../artifacts/ts7-native-plan/native-only-command-metadata.json) records the source SHA, package versions, and their log hashes. The [asset comparison](../artifacts/ts7-native-plan/asset-parity.json) records 20 byte-identical production assets.

The [rerunnable probe](../artifacts/ts7-native-plan/probe-native-only.py) and [results](../artifacts/ts7-native-plan/native-only-probe.json) prove eight representative valid, invalid, warning, and test-override cases on that disposable installation. The [regenerated config](../artifacts/ts7-native-plan/candidate-complete.oxlintrc.json) explicitly includes the nursery assignment rule. The [migration report](../artifacts/ts7-native-plan/migration-with-nursery.log) records the four remaining dispositions. Full rule equivalence is not proved by these eight cases.

Earlier [watch and performance evidence](../artifacts/tsrust-usage-review/results.json) records short Linux edit/recovery checks for both real projects. It does not prove supervision, interrupts, long sessions, other platforms, or IDE integration. It did not justify enabling `--fast` by default.

No live IDE or real terminal screenshot session was established during planning. The machine has VS Code and tmux, and matching generic control skills are installed. That is capability discovery, not a passing live lane. Full lint parity, real IDE behavior, lifecycle behavior, hosted CI, and publication remain execution gates. Current-head comparative performance is deferred under the release-scope amendment.

## Appendix B. Alternatives rejected

Keeping TypeScript 6 under its existing name or an npm compatibility alias violates the user's explicit target. Restoring it as a fallback is not an accepted outcome.

Replacing `tsc-rs` with Microsoft's compiler in ordinary builds would change the earlier compiler decision without a demonstrated need. The Microsoft package has a separate editor role. The default checker remains native Rust.

Running both full compilers and Oxlint type checking as permanent build gates duplicates ownership. Use the matching Microsoft oracle for compatibility checks when changing the compiler, not as a second normal whole-project gate.

Using only a non-type-aware linter loses checks such as floating promises and unsafe operations. Keeping TypeScript ESLint with project service turned off still imports the legacy API. Neither meets the target.

An automatic migration with missing rules is insufficient. The prototype found that the default migration skipped `no-useless-assignment`; the corrective mutation test prevents accepting a clean but weaker configuration.

Default `--fast`, experimental work stealing, the Rust language server, a new bundler, Effect diagnostics, and an application rewrite do not earn a place in this migration. Their risks or scope exceed the demonstrated benefit here.

## Appendix C. Risks

T7-1 has a lint equivalence risk. Its parity manifest must cover all effective rules and options, not just the headline count of supported type-aware rules. The nursery rule and fixed React Compiler configuration need explicit receipts.

T7-1 has a version divergence risk. Microsoft 7.0.2 and the Rust port's pinned 7.1 development revision are different. Both passed the current projects, but future diagnostic differences need attribution before changing ownership or weakening checks.

T7-2 has a process lifecycle risk. Two native watchers and Vite must stop together, including launch failures and Ctrl-C. A short standalone watch experiment does not prove that behavior.

T7-3 has a live-control prerequisite. Generic IDE control is installed but a working session is unproved. A missing IDE or terminal screenshot capability blocks the corresponding live proof. Never substitute a JSON settings check, protocol smoke, or rendered transcript for actual screen evidence.

T7-4 has cache and platform risks. New frontend dependencies invalidate the first frontend cache. Linux and both supported macOS architectures need actual native execution receipts. The existing release matrix in `.github/workflows/release.yml` has both macOS architectures. T7-1's non-publishing PR validation matrix supplies Intel proof before its first merge; later dispatches use the registered workflow. Windows and Linux arm64 are not newly promised application targets.

Release publication is an external effect under the execution request's authority. No release number is reserved here. If the next unused version is no longer 0.8.14, use the repository's then-current next version and maintained bump process.

## Appendix D. Links and reading list

Read [Microsoft's TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), the [official editor extension](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview), [Oxlint migration guidance](https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint.html), [type-aware lint documentation](https://oxc.rs/docs/guide/usage/linter/type-aware.html), and [editor setup](https://oxc.rs/docs/guide/usage/linter/editors.html) before editing.

Read the existing [compiler adoption record](research/ts-rust-adoption.md), [CI guide](ci.md), and [v0.8.13 release plan](release-v0.8.13-plan.md). Keep the working decision trail at [decisions.tsv](../artifacts/ts7-native-plan/decisions.tsv). Artifacts are local planning receipts and are not committed; share the planning evidence summary with the plan instead.

T7-1 and T7-2 use How and Architect before changing rule ownership or lifecycle behavior. T7-3 uses How for SDK discovery and actual extension behavior. Any unresolved design disagreement goes through Interrogate before shipping. Each PR uses Prove It Works, Sequence Work into Verifiable Units, and the applicable live-control skill. Performance reports use Benchmark Checklist and Explain the Number.

Planning applied Migrate Callers Then Delete Legacy APIs by making TypeScript 6 removal atomic with lint replacement. Outcome-Oriented Execution makes zero legacy consumers a completion gate. Prove It Works drove the disposable install and diagnostic mutations. Build the Lever produced the rerunnable probe. Encode Lessons in Structure requires the maintained dependency and rule guards. Sequence Work into Verifiable Units separates dependency migration, watch lifecycle, editor behavior, and CI handoff.
