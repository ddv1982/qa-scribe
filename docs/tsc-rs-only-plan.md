# Use tsc-rs for builds and the editor

Delegation and capability fallbacks follow the installed Poteto `references/codex-agent-runtime.md`.
Give contributors one pinned compiler implementation for build checks and editor language features.
Remove the repository's Microsoft TypeScript SDK dependency without retaining an alias or compiler fallback.
Keep the TypeScript 7 VS Code extension as the client and Oxlint as the lint engine.
Execute phases 1 through 5 in one focused implementation PR, labelled RS-1 below.
The user authorized implementation, normal merge, and a new release through existing CI on 2026-10-21. Execution starts from `2b1f79abc3662f8a9bb1e32d71f66865686f165f`.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists, such as a transcript, screenshot, test result, or commit SHA. The body is a how-to. The appendices explain and record.

Run implementation through the installed `poteto-mode/playbooks/feature.md`, then Opening a PR. Use Babysit and Shipping for the authorized merge. The parent owns integration and external writes. Publish a new release through existing CI only after the final migration and merged build pass their applicable checks.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

Apply the existing project's bounded verification approach. The ten live cases below are scenario coverage in shared, sequential, disposable sessions. Do not create ten agents, ten desktop profiles, or another performance framework. The performance block checks bounded responsiveness and process health. It does not establish a speedup, a memory bound, or long-session stability.

## Program checklist

### Arm the program

- [x] Present a new plan before changing production tooling. Evidence is this file and the planning-only worktree diff.
- [ ] At execution start, fetch current `origin/main` and record its SHA. Use a fresh branch from that SHA. Do not base the migration on the older local release branch.
- [ ] Do not create a goal, heartbeat, schedule, or hourly audit for this short task. Those lifecycle objects require a separate user request. Keep the queue table in the local decision trail instead.
- [ ] Read the installed execution, control, and shipping skills. Use `git show origin/main:package.json` and the current native tooling workflow for repository commands. The skill package is not stored in this project's trunk.
- [ ] Record the allowed outcome. The installed repository graph contains no Microsoft compiler SDK and both editor layouts execute the pinned Rust binary.

### Spawn owners

- [ ] Use one OpenAI implementation owner for RS-1 in its own checkout. The parent owns plan integration, canonical validation, and any authorized publication. Do not use Claude.
- [ ] Follow the linear dependency graph. Phase 1 editor feasibility precedes phase 2 dependency removal. Phase 3 verifies the final source. Phase 4 checks hosted installations. Phase 5 closes or releases the reviewed change.
- [ ] Keep implementation writes within the RS-1 file list. Use a separate read-only reviewer at the final patch. Do not run editor sessions concurrently with comparative probes.
- [ ] Keep the throughput checkpoint in the trail. Blocking first steps are SDK resolution and extension feasibility. There are no independent implementation workstreams. The dependency lock and editor policy share one owner. One PR is the smallest safe decomposition because settings, installation, and guards must agree.

### PR mechanics, for every PR

- [ ] Use the project's normal forge and branch protection. Open and link RS-1 to this T3 thread. Record its assigned PR number separately from this plan label.
- [ ] Run affected lint and type checks before pushing. Run deslop before commits and no-comments before independent review.
- [ ] Record the head, base, stable patch-id, and command results. Triage automated comments against actual behavior.
- [ ] Keep `tsc-rs` pinned to 0.7.0 for this migration. Keep unrelated dependency and toolchain upgrades out of RS-1.

### Verdict and merge, for every PR

- [ ] Require an independent OpenAI verdict on the exact final patch, all protected CI, and resolution of proven review defects. Do not bypass protections.
- [ ] Provide real editor screenshots, a short video, selected executable identity, and cleanup receipts to the reviewer and user. Do not treat LSP handshake results as editor proof.
- [ ] Before merging, check the current execution authority and Shipping's patch retention rules. A changed patch needs matching verification.
- [ ] If a supported editor cannot execute the local Rust server reliably, leave RS-1 unmerged and report the smallest upstream blocker. Do not quietly retain the Microsoft SDK as a completed migration.

### Boot recipe, for every live lane

- [ ] Use an isolated checkout of the exact candidate with a frozen frontend install and the repository's pinned Bun version. Keep extensions and user data in private task-owned directories.
- [ ] Detect `cursor-team-kit:control-ui` for the actual VS Code window and `cursor-team-kit:control-cli` for commands. Use the supported T3 browser first where applicable. A missing editor capability leaves editor proof incomplete.
- [ ] For each direct folder layout, trust the disposable checkout through the actual UI and approve its configured SDK. Inspect the final preflight result before starting a session.
- [ ] Record extension versions, effective SDK settings, canonical executable paths, package versions, and the source SHA. Verify that the extension's bundled compiler is not the active provider.
- [ ] Save actual editor screenshots and logs under the task's artifact directory. Stop only processes whose ownership is proven from their launch receipt. Never promote cleanup ownership to an ancestor process.

## Remove the Microsoft SDK and select the Rust language server (RS-1)

**Depends on.** None. Complete the five phases in order within this PR.

**Files.**

- [ ] Edit `frontend/package.json` and `frontend/bun.lock` to remove `typescript` and its resolved native compiler packages.
- [ ] Edit `.vscode/settings.json` and `frontend/.vscode/settings.json` to select one stable local Rust SDK path in both layouts.
- [ ] Create `scripts/prepare-rust-typescript-sdk.mjs` and focused behavior tests if the stable-link approach passes phase 1.
- [ ] Edit `scripts/native-tooling-inventory.mjs`, `scripts/native-tooling-policy.mjs`, and `scripts/native-tooling-editor.mjs` to enforce Rust SDK ownership.
- [ ] Edit `scripts/check-native-typescript-tooling.test.mjs`, `scripts/native-tooling-editor.test.mjs`, and `scripts/fixtures/native-tooling/editor-layouts.json` for the new ownership contract.
- [ ] Extend `scripts/check-native-tooling-installations.mjs` to prove SDK preparation and Rust server initialization after cold and warm installs. Update the native workflow's path filters for any new helper and tests.
- [ ] Update the active setup instructions in `README.md` and add final evidence under `docs/research/`. Preserve historical migration and failed verification records.

**Build.**

### Phase 1. Prove portable editor selection

- [ ] Confirm the dependency audit against fresh trunk. Record actual installed and locked runtime consumers of `typescript`, including aliases and optional dependencies.
- [ ] Compare an upstream-documented direct platform path with a stable link in a disposable installation. Approve the configured SDK through VS Code and verify actual completion plus a deliberate type error in both root and frontend layouts.
- [ ] Prefer a generated `frontend/node_modules/.tsc-rs-sdk` link to the installed host package's `lib` directory if the real extension accepts it. Root settings use `./frontend/node_modules/.tsc-rs-sdk`. Frontend settings use `./node_modules/.tsc-rs-sdk`.
- [ ] Choose the exact host tuple from an explicit supported-platform table. Require the umbrella package and matching `@tsc-rs/<platform>-<arch>` package to share version 0.7.0. Require an executable `tsc` and the package's standard libraries.
- [ ] Prove the chosen path on Linux x64 and macOS. Cover macOS arm64 and x64 installation in hosted CI. Do not add Windows support in this task.
- [ ] Use the documented direct path as a diagnostic control. If the stable link fails in an actual supported editor, preserve both results and stop for a revised portable design. Do not invent a fake `typescript` package, commit a host-specific default, or build a custom VS Code extension.

### Phase 2. Remove the SDK and enforce the new contract

- [ ] Define one SDK resolution record before writing logic. Include platform, architecture, package identity, package version, canonical library directory, executable, and local link. Reuse that record in preparation and validation.
- [ ] Make SDK preparation idempotent and local to the frontend installation. Add it to the frontend installation lifecycle and expose an explicit repair command. Verify that the pinned Bun executes it during a normal frozen install.
- [ ] Use a relative symlink inside `node_modules`. Resolve its target from installed package metadata. Do not modify vendor bytes, hardlinked package contents, global SDKs, user settings, or tracked workspace settings during installation.
- [ ] Replace only a stale helper-owned symlink. Fail on an unexpected real directory or file at the output path. Validate the new target before replacing a link. Do not delete arbitrary installation contents.
- [ ] Remove `typescript` from the manifest and regenerate the lock with pinned Bun. Require no installed or locked Microsoft compiler SDK packages, including legacy and native-preview identities or aliases. Do not ban unrelated packages just because they use the `@typescript` scope.
- [ ] Remove mandatory `typescript` resolution and its 7.x allowance from the inventory and policy. Keep the runtime compiler API import audit and all existing compiler, lint, and project-scope obligations.
- [ ] Validate the Rust platform package through metadata, its canonical executable, and library files. Do not require a platform-package `bin` field or a manifest inside its `lib` directory. Do not confuse npm version 0.7.0 with the TypeScript language version.
- [ ] Preserve build scripts, Vite bundling, both compiler projects, the checked watcher lifecycle, Oxlint's 23 typed rules, and its existing local launchers.

### Phase 3. Verify the complete contributor workflow

- [ ] Run the unit and live blocks below against a fresh installation with the Microsoft SDK absent. Repair deliberate errors before completing the session.
- [ ] Use independent actual editor proof on macOS in addition to Linux. If no macOS IDE host is available, report that gate as blocked. Hosted compiler jobs do not count as macOS IDE proof.
- [ ] Record the old SDK's absence and the Rust executable identity after editor reload and after installation repair. State any extension notification that labels the SDK as `local` rather than showing a version.

### Phase 4. Validate hosted installations

- [ ] Run the existing native tooling matrix on Linux x64, macOS arm64, and macOS x64 at the PR head. Require cold install, restored-cache install, SDK link resolution, Rust LSP initialization, frontend checks, tests, and build to pass.
- [ ] Extend the existing installation receipt with selected compiler package and executable identities. Do not add a second matrix or change cache policy as part of this migration.
- [ ] Run `bun run verify` and maintained workflow validation for changed workflows. Keep the existing desktop, security, packaging, and release checks applicable to the final change.

### Phase 5. Review and close

- [ ] Update README to name `tsc-rs` as the compiler and language server. Describe the retained Microsoft editor client and Go typed lint engine accurately.
- [ ] Obtain the final independent verdict and inspect exact-head CI. Merge only under execution authority. Use the existing CI process for a later authorized release and tag.
- [ ] If a new release is requested, select an unused version at that time. Preview it with `bun run bump <new-version> --dry-run`, then use the maintained bump command. Validate expected-tag metadata and publish through the repository's workflow. Verify the merged build, generated tag, public assets, signatures, and APT metadata. Do not create a tag manually.

**You see.**

- [ ] A frozen install selects the host's Rust SDK without editing tracked files. Both root and frontend workspaces run the same pinned native binary used by the build checker.
- [ ] Completion, imports, navigation, rename, compiler diagnostics, and typed lint work after removal of `typescript`. Logs identify the local `@tsc-rs` executable.
- [ ] The repository's installed and locked dependency graph has no Microsoft compiler SDK. The recommended editor client and separate lint engine remain identifiable.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Test both layouts, every supported tuple, missing packages, version mismatch, missing executable or library, foreign symlink, stale link replacement, unexpected output directory, repeated setup, and relocation. Run the focused Node tests through the existing script-test conventions.
- [ ] Add negative dependency fixtures for direct, nested, optional, and aliased Microsoft SDKs. Preserve coverage that ignores upstream installed packages' own uninstalled development metadata.
- [ ] Run `bun run frontend:tooling:check`, `bun run frontend:compiler:check`, `bun run frontend:check`, `bun run frontend:test`, `bun run frontend:build`, and `bun run release:script-tests`. Save complete results at the final patch.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head are the scenario labels below. Consolidate them into bounded sequential editor sessions rather than ten agents.

- [ ] Lane 1. Open the repository root after fresh install and approve the SDK. Save `root-rust-sdk.png`. Pass when the active process resolves to the pinned local Rust binary.
- [ ] Lane 2. Open frontend directly in a separate private profile. Save `frontend-rust-sdk.png`. Pass when it selects the same Rust package without user-level SDK overrides.
- [ ] Lane 3. Request completion, hover, and definition navigation in a TSX source. Save `language-features.png`. Pass when results refer to the actual project symbols.
- [ ] Lane 4. Accept an auto-import and rename a disposable cross-file symbol. Save `imports-rename.png`. Pass when the import and references change correctly.
- [ ] Lane 5. Insert and repair a deliberate UI type error. Save `ui-diagnostic-repair.png`. Pass when the expected compiler diagnostic appears and then clears.
- [ ] Lane 6. Insert and repair a Vite configuration type error. Save `vite-diagnostic-repair.png`. Pass when the correct Vite project reports and clears it.
- [ ] Lane 7. Insert and repair a floating promise and hook violation. Save `typed-lint-repair.png`. Pass when typed and hook lint remain active alongside the Rust provider.
- [ ] Lane 8. Reload the editor and repeat completion plus diagnostic repair. Save `reload-rust-sdk.png`. Pass when the same Rust executable remains active with no bundled Microsoft compiler fallback.
- [ ] Lane 9. Remove only the task-owned SDK link in the disposable checkout, run the repair command twice, and reopen the file. Save `sdk-repair.png`. Pass when setup is idempotent and language features recover.
- [ ] Lane 10. Run repeated edits, then close the owned session. Save `repeat-edits.png`. Pass when the bounded response rule passes and cleanup verifies that owned processes stopped.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record completion responses, deliberate-error appearance and repair, server exits, and restarts in the actual editor. Record RSS as context only. Do not claim a memory bound.
- [ ] Probe. Use the same project, extensions, host, and scenarios for trunk first and candidate second. Run 20 edit-and-repair cycles in each direct folder layout. Limit each session to ten minutes. Keep builds and profiling out of these sessions.
- [ ] Baseline. Capture trunk's selected provider and raw functional results before the candidate. This is a compatibility reference, not a speedup study. Do not reuse the earlier nonconformant primary sessions.
- [ ] Rule. Require zero crashes, zero unexplained provider restarts, and zero unresolved edit cycles. Each requested completion or diagnostic update must finish within ten seconds. On failure, preserve the run and investigate once. Do not relax the rule after failure or rerun until green. Long-session memory and comparative speed remain unproven.

**Review gate.** Require independent editor interaction review before merge under the active execution authority.

- [ ] Post actual screenshots and a 30 to 60 second video for the operator and independent reviewer. Include Linux and macOS evidence with its real scope. A future explicit autonomous implementation request can authorize normal merge after these gates pass.

**Merge.**

- [ ] Require the independent exact-patch verdict, all protected checks, and completed review triage. If publication is outside the active request, stop at the authorized boundary.
- [ ] Preserve the prior working release if a Rust editor defect blocks migration. Any rollback restores the complete prior tooling change, rather than leaving a hidden dual compiler setup.

## Close the program

- [ ] Check each applicable box only against evidence. Mark a blocked or deferred requirement explicitly. Do not call missing proof a pass.
- [ ] Report the final compiler, language server, editor client, lint engine, CI result, and any authorized release URL separately.
- [ ] Leave no task-owned editor, watcher, terminal, or CI polling process running. Keep raw failures and final receipts.

## Appendix A. Prototype evidence

Planning inspected local commit `8d4f229aa10d5da4430b6f26cd1bb060b9823ce9` on the completed release branch. Implementation must start from fresh trunk.

The throwaway probe is `/tmp/qa-scribe-tscrs-only-plan-20261021/probe.py`. Its `lsp-probe.json` records successful `initialize` replies from installed tsc-rs 0.7.0 through both the direct platform directory and a stable symlink. Both report language server version `7.1.0-dev`. Both owned processes stopped. This establishes binary and link feasibility on Linux x64. It does not establish actual VS Code compatibility, macOS behavior, rename correctness, or memory stability.

The read-only dependency audit found no locked or installed runtime dependency requiring the Microsoft SDK. It found no runtime compiler API imports through the existing audit. Our own SDK policy and editor guard still require the Microsoft package. The umbrella Rust package and native platform package have different layouts, so a name-only substitution is insufficient.

The installed Rust package records upstream revision `3644f3244d9a93082c69e6691e8b280a0ccc98d0`. Current upstream documentation explicitly describes directing the TypeScript 7 extension to the platform package's `lib` directory. The extension's current resolver canonicalizes a configured path and can accept a directory containing the native executable. The installed extension must still be tested rather than inferred from upstream main.

## Appendix B. Alternatives rejected

- Keep two standalone SDKs. This misses the user's requested outcome and retains the build-editor compiler mismatch.
- Alias the Rust package as `typescript`. This obscures identity and does not prove SDK detection or native platform resolution.
- Commit a Linux-only platform path as the shared default. This breaks the supported macOS contributor path.
- Copy binaries or libraries into a custom SDK distribution. This adds duplicate artifacts and update obligations when a validated local link can suffice.
- Replace Oxlint with the compiler. Compiler diagnostics do not supply the retained lint rule coverage. This task keeps the Go typed lint engine deliberately.
- Build another measurement system. The earlier study remains deferred. This migration claims compiler ownership and functional compatibility, not a speedup.

## Appendix C. Risks

- Rust LSP is early upstream software. The upstream README reports memory growth during long editor sessions. A short smoke pass cannot resolve that limitation.
- The editor extension can fall back to its bundled compiler when local selection fails. Runtime path evidence is required after approval and reload. Removing repository packages does not remove extension-bundled Microsoft code.
- Installation lifecycle scripts can be disabled. The explicit repair command and tooling check must diagnose the missing link. Do not download a fallback SDK.
- A new SDK path may show version `local` in the editor. Use package and executable identity rather than that label as proof.
- SDK integration with future extension APIs may change. Pin and record the extension used for proof and repeat the bounded checks after relevant upgrades.
- Linux IDE proof and macOS compiler CI are different evidence. Missing macOS editor access blocks a claim of verified macOS editor support.
- `oxlint-tsgolint` remains Go-based. The outcome is Rust compilation and language service with a separate lint engine, not an entirely Rust-authored toolchain.

## Appendix D. Links and reading list

- Read [upstream tsc-rs editor setup and known problems](https://github.com/pingdotgg/ts-rust/blob/main/npm/tsc-rs-readme.md).
- Read [the editor SDK resolver](https://github.com/microsoft/TypeScript/blob/main/packages/vscode-typescript/src/util.ts) and [workspace SDK approval](https://github.com/microsoft/TypeScript/blob/main/packages/vscode-typescript/src/session.ts).
- Read [the current frontend package](../frontend/package.json), [editor guard](../scripts/native-tooling-editor.mjs), [native package policy](../scripts/native-tooling-policy.mjs), and [native installation workflow](../.github/workflows/native-tooling-validation.yml).
- Read [the shipped validation scope and limits](research/typescript-7-validation.md) and the release-scope amendment in [the preceding plan](typescript-7-native-tooling-plan.md).
- Use the installed `how`, `technical-writing`, `unslop`, and `show-me-your-work` skills for RS-1. Use `architect` before changing shared SDK interfaces and `interrogate` only for unresolved contested design.
- Keep this planning decision trail at `artifacts/tscrs-only-plan/decisions.tsv`. This local trail records the planning scope, evidence, and review limits.
