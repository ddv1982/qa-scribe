# Migrate TypeScript checking to tsc-rs

This document records the historical v0.7.24 migration checkout. See [v0.8.12 release validation](research/ts-rust-release-validation.md) for current-main release evidence.

This plan adopts `pingdotgg/ts-rust` through its published `tsc-rs` package. QA Scribe keeps its existing Rust/Tauri application and TypeScript UI. Read the [research findings](research/ts-rust-adoption.md) for the scope decision and primary sources.

## How to run this plan

Use the Poteto `figure-it-out` workflow. Verify each phase before starting its dependent phase. Record decisions and receipts in `docs/research/ts-rust-decisions.tsv` and `artifacts/tsrust-research`. The user has authorized implementation after research and planning. No additional approval checkpoint is required for local work.

The completion predicate is explicit. Both TypeScript projects use the pinned Rust checker in normal checks and builds. Deliberate type errors fail. Typed ESLint still works. The production assets match the baseline. Application tests, Rust checks, and the available desktop smoke workflows pass, or a specific prerequisite failure is recorded.

## Phase 1. Establish the supported target

- [x] Read the reference repository, package README, launcher code, release metadata, and upstream provenance.
- [x] Inventory compiler callers, project configs, typed lint, CI, and release paths.
- [x] Obtain an independent Poteto review of the inventory and scope.
- [x] Resolve the application rewrite premise. The linked repository provides a compiler, not a native UI framework.
- [x] Preserve existing untracked audit and investigation work. Create branch `migration/tsc-rs`.

Exit when the research document explains what can be implemented and every direct compiler caller is identified.

## Phase 2. Prove compatibility before changing commands

- [x] Run the existing frontend typecheck and production build.
- [x] Save the baseline assets under `artifacts/tsrust-research/baseline-dist`.
- [x] Test `tsc-rs@0.7.0` against both existing configs from a disposable installation.
- [x] Compare both successful checks with the matching Microsoft TypeScript 7 compiler.
- [x] Add a reusable probe with valid and invalid inputs for both project configurations.

Exit when the checker accepts valid TypeScript and TSX and rejects deliberate assignment, property, and JSX errors. The probe must use fresh temporary files and clean them up. A successful process without diagnostic assertions is insufficient.

## Phase 3. Change the compiler entry points

- [x] Add exact development dependency `tsc-rs@0.7.0` and update the Bun lockfile.
- [x] Keep JavaScript `typescript` for typed ESLint.
- [x] Make frontend `typecheck` explicitly check `tsconfig.json` and `tsconfig.node.json` with `tsc-rs --noEmit`.
- [x] Make frontend `build` call that single typecheck script before Vite.
- [x] Run a frozen install and confirm the native launcher works with Bun's default script trust policy.
- [x] Verify optional platform packages remain in the lockfile.

Exit when `bun run frontend:typecheck` passes and there are no remaining direct `tsc` script invocations. Do not weaken strictness or add a silent fallback compiler.

## Phase 4. Add a repeatable adoption check

- [x] Keep the compiler behavior probe in `scripts/check-typescript-compiler.mjs`.
- [x] Expose the probe as `bun run frontend:compiler:check`.
- [x] Wire the probe into local verification commands and the shared CI/release action. Run the probe locally.
- [x] Prove that both the typecheck command and production build reject disposable invalid application code.
- [x] Prove that a disposable Vite configuration type error fails the production build before bundling.

Exit when these checks use the installed native compiler and cannot pass if checking is disabled. Keep any build-failure experiments isolated from tracked sources.

## Phase 5. Verify application parity

- [x] Run `bun run frontend:check`, `bun run frontend:test`, and `bun run frontend:build`.
- [x] Compare every generated production asset byte for byte with the Phase 2 baseline.
- [x] Run `bun run e2e:isolation` and `bash scripts/check-tauri-prebuilt-frontend.sh`.
- [x] Run bindings, command checks, Rust formatting, clippy, workspace tests, build, and smoke. Run individual checks when aggregate commands are blocked.
- [x] Run the built desktop E2E workflows if this host has their prerequisites.
- [x] Record platform checks that still depend on Linux or macOS CI rather than claiming a local cross-platform result.

Exit when the available checks pass and the receipt names every blocked check. This migration makes no performance claim and adds no performance gate.

## Phase 6. Document and review the result

- [x] Update README development guidance with compiler ownership and the new probe command.
- [x] Review the actual diff and confirm that app code, schema, provider behavior, and generated bindings did not change.
- [x] Request independent review of the implementation and decision trail.
- [x] Resolve findings and rerun affected checks.
- [x] Update this checklist with the actual results and link the validation receipt.

Exit when the user can repeat the checks and distinguish compiler migration completion from the unsupported claim of a full native application rewrite.

## Throughput checkpoint

Blocking work is the compiler scope investigation and positive compatibility probes. They precede implementation. The parent owns research documents and authoritative verification. One Poteto delegate owns the compiler scripts, lockfile, CI hook, and README as a single coupled change. These file sets do not overlap.

Only one writer owns dependency state. Only one Cargo writer may modify `target/debug/qa-scribe-tauri` during desktop tests. Compiler probes use disjoint scratch directories and may run alongside an already-built desktop app. Parallel design candidates are unnecessary because the supported interface is a concrete CLI replacement. The independent investigator tests that interpretation before implementation.

## Rollback

Revert this migration's tracked changes to restore the prior checker commands and dependency graph. Run `bun install --cwd frontend --frozen-lockfile`. No application data migration or database change is involved.

## Validation status

Read the [validation receipt](research/ts-rust-validation.md) for results. Compiler and frontend migration checks pass. All five built desktop workflows pass after a clean rerun. Existing expired code-size and Rust advisory reviews block the aggregate repository gates. Native macOS execution remains unverified locally.
