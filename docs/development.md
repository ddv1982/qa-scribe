# Development

Run the commands in this guide from the repository root. [Back to the README](../README.md).

## Requirements

- Rust toolchain pinned in [rust-toolchain.toml](../rust-toolchain.toml)
- Node.js 22.13 or newer
- Bun 1.3.5, pinned in [package.json](../package.json)
- Platform toolchain for the local Tauri target
- [cargo-binstall](https://github.com/cargo-bins/cargo-binstall#installation), used by the pinned Tauri CLI installer
- Optional authenticated local AI CLIs: `claude`, `codex`, or `copilot`

## Install dependencies

Install frontend dependencies:

```bash
bun install --cwd frontend --frozen-lockfile
bun run tauri:cli:install
```

Full verification also requires `cargo-audit`. Install the version pinned in [tool-versions.json](../scripts/tool-versions.json):

```bash
cargo binstall cargo-audit --locked --version "=$(node -p 'require("./scripts/tool-versions.json").cargoAudit')" --no-confirm
```

## Compiler and editor setup

Frontend checks and editor language features use [`tsc-rs`](https://github.com/pingdotgg/ts-rust), pinned to `0.7.0`. Both the UI and Vite configuration are checked before production builds. Vite bundles the frontend. Oxlint `1.89.0` and its Go-based `oxlint-tsgolint` `7.0.2004` engine provide typed linting. The separate Microsoft compiler SDK is not installed.

The npm package version identifies the Rust release. Its TypeScript language version, reported by `tsc-rs --version`, is `7.1.0-dev`. Builds and the editor use the same native executable. The Microsoft **TypeScript 7** extension remains the editor client.

On Linux x64, macOS Apple Silicon, or macOS Intel, a frozen frontend install prepares `frontend/node_modules/.tsc-rs-sdk` as a relative link to the installed host package's `lib` directory. Installation does not edit workspace or user settings. If lifecycle scripts were disabled or the link is missing, run the repair command explicitly:

```bash
bun run --cwd frontend sdk:prepare
```

The helper repairs only recognized helper links. It refuses foreign links, files, or directories at the reserved path. The tooling guard reports missing or stale setup without repairing it.

For VS Code, open the repository root or `frontend` directly and install the recommended **TypeScript 7** (`TypeScriptTeam.native-preview`) and **Oxc** (`oxc.oxc-vscode`) extensions. Trust your checkout through **Manage Workspace Trust**, then open a TypeScript file and click **Allow** when TypeScript 7 offers the configured SDK. Its notification can label this SDK `local`. If hidden, run **Notifications: Show Notifications** to find it.

Root settings select `./frontend/node_modules/.tsc-rs-sdk`. Frontend settings select `./node_modules/.tsc-rs-sdk`. In the **TypeScript 7** output, check that `Resolved to` identifies the checkout's `@tsc-rs/<host>/lib/tsc` executable. A Bun installation can place that package under `node_modules/.bun`. Check **Oxc (Lint)** output for the local Oxlint launcher and version `1.89.0`. Both layouts retain per-file project discovery for UI sources and `vite.config.ts`. Compiler diagnostics show `ts`; lint diagnostics show `oxc`. Formatting and save actions are unchanged.

Run the tooling guard to inspect the entire lock and installed dependency graph, verify lint coverage, and exercise deliberate lint violations. Run the compiler probe to verify that valid TypeScript and TSX pass and deliberate type errors stop builds:

```bash
bun run frontend:tooling:check
bun run frontend:compiler:check
```

The probe checks the installed package version and removes its temporary fixtures. Both verification commands and CI run the probe. Read the [migration findings](research/ts-rust-adoption.md) for compatibility evidence and scope.

Read the [Rust SDK validation record](research/tsc-rs-only-validation.md) for editor coverage, the pinned shutdown qualification, and current limits.

## Continuous checks

For continuous native checks on Linux or macOS, run `bun run frontend:typecheck:watch`. To run both checkers with Vite, run `bun run frontend:dev:checked`. From `frontend`, use `bun run typecheck:watch` or `bun run dev:checked`. Both project watchers show type errors and recover after edits. The checked session uses Vite's configured port, defaulting to 5173, and fails if it is occupied.

These opt-in watchers add resident memory. On the probe host, median additional RSS was about 296 to 349 MiB. This [watch measurement](research/typescript-7-watch-evidence.json) is conditional on that host and workload, rather than a universal memory cost.

For these development watchers, Ctrl-C stops every owned process group. A second interrupt skips the shutdown grace period. A failed or unexpectedly terminated child stops the session without restarting it. Process-group cleanup does not cover Ctrl-Z, killing the supervisor with SIGKILL, or descendants that create independent sessions. Ordinary `bun run --cwd frontend dev` runs Vite alone. Production builds and CI use their existing one-shot checks.

## Run and verify

Run the desktop app in development mode:

```bash
bun run dev
```

Build the Rust workspace and frontend:

```bash
bun run build
```

Choose one gate for the current source. Use `bun run verify:fast` during the edit loop:

```bash
bun run verify:fast
```

This checks source isolation, native tooling and compiler contracts, frontend
checks and tests, command contracts, Rust formatting, and clippy. It omits
dependency audits, Rust tests, a full build, smoke, and built-app E2E.

Before handing off a completed change, use the full local gate:

```bash
bun run verify
```

This adds audits, release-script and package metadata tests, a production build
and isolation check, bindings, Rust tests and build, and non-GUI smoke. It omits
built-app E2E, startup launches, workflow lint and online audit, platform matrix,
and installed-package checks. CI supplies those applicable obligations. Do not
run both gates and every constituent command against unchanged source. Use
focused tests while editing and the full gate when its broader proof is needed.
See the [check inventory](verification/check-inventory.md) for the exact scope.

Run the non-GUI smoke harness:

```bash
bun run smoke
```

Run the built desktop application against deterministic end-to-end workflows. On Linux, the native-close workflow requires an isolated X11 display:

```bash
GDK_BACKEND=x11 xvfb-run -a bun run e2e
```

On macOS, run `bun run e2e`. Both desktop defaults include first use, the
read-only example, Help, ordinary creation, and Copy. Each default workflow has
isolated app data and artifacts. The model evidence and selection restart pairs
intentionally share only their own state on Linux. Select one maintained spec
with `QA_SCRIBE_E2E_SPEC=first-use.e2e.mjs bun run e2e` when working on first use.
Keep `QA_SCRIBE_AC3_RECORD` unset for normal checks. CI disables this optional
Linux recorder even when inherited from the environment.

If a command fails, read `artifacts/e2e/latest-run.json` and the per-invocation
logs. Startup failures retain `artifacts/startup/startup-report.json`, including
earlier samples. A timeout is distinct from an application assertion or process
exit. These wrappers bound their direct children and do not prove descendant
cleanup. Keep isolated native runs serialized with other users of the target.

Run the reproducible large-data startup measurement (five launches by default):

```bash
bun run startup:benchmark
```

Validate package metadata JSON:

```bash
bun run package:check
```

## Related guides

- [CI](ci.md)
- [Code size guidelines](code-size-guidelines.md)
- [Architecture decisions](adr)
- [Release process](releasing.md)
