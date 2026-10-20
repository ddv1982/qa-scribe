# ts-rust adoption findings

Research date is 2026-10-20. The implementation plan is [Migrate TypeScript checking to tsc-rs](../ts-rust-migration-plan.md).

## The linked repository provides a compiler

[`pingdotgg/ts-rust`](https://github.com/pingdotgg/ts-rust) ports Microsoft's native TypeScript compiler to Rust. The published package is `tsc-rs`. It checks TypeScript and can emit JavaScript. It does not translate TypeScript application logic into Rust, provide a desktop framework, or replace React.

QA Scribe already uses Rust for its domain logic, SQLite persistence, managed attachments, AI subprocesses, and Tauri host. React, TipTap, and TypeScript implement its webview UI. Adopting the linked compiler changes development tooling. Calling that adoption a complete application rewrite would be inaccurate.

The autonomous implementation uses the linked repository for the work it supports. A native Rust UI rewrite remains a separate product decision because it requires another UI framework and a replacement for TipTap's editing behavior.

## The release and language versions differ

The npm registry and GitHub release both identify `tsc-rs` 0.7.0 as the current release. The npm package records source commit `3644f3244d9a93082c69e6691e8b280a0ccc98d0`. The researched repository HEAD was `780dc512d64f40afebffa6a7028207649fb7ed1c`.

The [release's provenance document](https://github.com/pingdotgg/ts-rust/blob/3644f3244d9a93082c69e6691e8b280a0ccc98d0/UPSTREAM.md) pins Microsoft TypeScript commit `fed0bf24149fb1ed36039212648bafdafc1ea10e`. Its matching npm compiler is `typescript@7.1.0-dev.20261008.1`. QA Scribe's existing JavaScript compiler resolves to TypeScript 6.0.3.

`tsc-rs --version` prints `Version 7.1.0-dev`. Read `tsc-rs/package.json` to identify the package release. Pin `tsc-rs` exactly so a compiler upgrade is deliberate.

## Compiler ownership is concentrated in two scripts

The only direct application compiler calls are `frontend/package.json` scripts `typecheck` and `build`. Root scripts, the Tauri frontend build hook, CI validation, package builds, and release builds reach those scripts.

The UI project includes `frontend/src`, including its tests and generated Specta bindings. `frontend/tsconfig.node.json` includes `vite.config.ts`. The UI config references the Node config, but a direct project check does not recursively check the reference. Both projects need explicit checks.

The source scan found no direct application imports of the TypeScript compiler API. Typed ESLint rules do require it. `frontend/eslint.config.js` enables `recommendedTypeChecked` and `projectService`. Keep the `typescript` dependency for [typescript-eslint's project service](https://typescript-eslint.io/packages/parser/#projectservice). The Rust compiler's unstable API is not a compatible replacement for that consumer.

## Compatibility probes passed before implementation

The baseline `bun run frontend:typecheck` and `bun run frontend:build` both passed at QA Scribe commit `3ba0a22`. The baseline production assets are saved locally under `artifacts/tsrust-research/baseline-dist`.

A disposable installation under `/tmp/qa-scribe-tsrust-research` ran `tsc-rs@0.7.0` against both existing configs with `--noEmit --pretty false`. Both returned zero without diagnostics. The matching Microsoft TypeScript 7 compiler also returned zero for both configs. No language compatibility fix or relaxed compiler option was needed. The original runs appear in the task transcript. A later replay saves six successful compiler/project results in `artifacts/tsrust-research/compatibility-replay.json`. Both configurations and application sources remain unchanged from the baseline.

These results establish compatibility for this checkout. They do not establish general compiler equivalence. Positive and deliberately invalid fixtures must prove that the installed checker accepts valid inputs and rejects errors.

## Packaging supports the existing build hosts

The npm wrapper depends on six optional native packages for Linux x64 and arm64, macOS x64 and arm64, and Windows x64 and arm64. Linux x64 was executed locally. Existing CI covers macOS arm64. The release matrix also builds on native Intel macOS. Neither remote workflow has run for this branch. Linux arm64 and Windows packages have no configured native execution gate.

The [package launcher source](https://github.com/pingdotgg/ts-rust/blob/3644f3244d9a93082c69e6691e8b280a0ccc98d0/npm/getExePath.js) resolves the current platform package. Bun blocked the optional postinstall during the disposable install, but the standard JavaScript launcher still executed the native checker successfully. The [postinstall source](https://github.com/pingdotgg/ts-rust/blob/3644f3244d9a93082c69e6691e8b280a0ccc98d0/npm/install.js) optimizes startup and preserves the JavaScript launcher when optimization cannot run. No trust-list change is required.

The compiler is a development dependency. Vite remains responsible for bundling the webview assets. Tauri continues to compile and package Rust through Cargo. No compiler crate belongs in the application workspace.

## Several upstream features do not belong in this migration

The [npm package documentation](https://github.com/pingdotgg/ts-rust/blob/3644f3244d9a93082c69e6691e8b280a0ccc98d0/npm/tsc-rs-readme.md) records an internal error in build watch mode and memory growth during long editor sessions. Keep Vite's development server and editor configuration unchanged.

Use normal compiler mode. Upstream documents diagnostic and resource differences for some `--fast` cases. This migration makes no local performance claim. Effect diagnostics are irrelevant because QA Scribe does not use Effect.

The documented monorepo duplicate-path and unordered project-output issues do not match this frontend's structure. Explicit no-output project checks avoid introducing a new build-reference dependency.

## Alternatives considered

Replacing all React code with native Rust has no implementation path in this compiler repository. It would also require replacing the editor, DOM rendering, accessibility behavior, UI tests, and desktop parity checks.

Removing `typescript` would break the typed lint dependency. Keeping two permanent CLI checking pipelines would leave ambiguous ownership. Use `tsc-rs` for project checking and JavaScript TypeScript only where tools require its API.

Embedding the compiler in Cargo would add a large unrelated compiler implementation to the product. The published, platform-selected development package is sufficient.

Changing to build mode or a platform-specific editor SDK would introduce separate lifecycle and portability risks. Neither is required for adoption.

## Evidence can be regenerated

Run these commands from the repository root to repeat the discovery checks.

```bash
npm view tsc-rs version dist-tags bin optionalDependencies --json
npm view typescript@7.1.0-dev.20261008.1 gitHead --json
rg -n 'tsc|typescript|typecheck' frontend/package.json frontend/eslint.config.js package.json scripts .github
```

Use the plan's verification commands to repeat implementation checks. Local receipts live in `artifacts/tsrust-research`. The decision trail is `docs/research/ts-rust-decisions.tsv`.
