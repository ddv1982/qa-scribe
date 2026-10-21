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

Frontend type checks use the Rust compiler [`tsc-rs`](https://github.com/pingdotgg/ts-rust), pinned to version `0.7.0`. Both the UI and Vite configuration are checked before production builds. Vite bundles the frontend. Microsoft TypeScript `7.0.2` supplies the native editor SDK. Oxlint `1.89.0` and its Go-based `oxlint-tsgolint` `7.0.2004` engine provide typed linting. TypeScript 6 and its compiler API consumers are removed.

`tsc-rs` ports TypeScript `7.1.0-dev.20261008.1`, so its revision differs from the stable editor SDK. `bun run frontend:check` requires native checking and typed lint to pass. The Rust compiler remains the authoritative build checker.

For VS Code on Linux or macOS, open the repository root or `frontend` directly and install the recommended **TypeScript 7** (`TypeScriptTeam.native-preview`) and **Oxc** (`oxc.oxc-vscode`) extensions. Trust your checkout through **Manage Workspace Trust**, then open a TypeScript file and click **Allow** when TypeScript 7 offers the configured `7.0.2` SDK. If the notification is hidden, run **Notifications: Show Notifications**, then click **Allow** on the TypeScript 7 SDK notification. Root settings select `./frontend/node_modules/typescript`. Frontend settings select `./node_modules/typescript`.

Check the **TypeScript 7** output for `Resolved to` inside this checkout's `frontend/node_modules/@typescript/` package. Check **Oxc (Lint)** output for the local Oxlint launcher and version `1.89.0`. Both folder layouts select the local `oxlint-tsgolint` package launcher for typed lint and keep per-file project discovery for UI sources and `vite.config.ts`. If runtime identities differ, inspect the effective `oxc.path.tsgolint` setting and the editor's `OXLINT_TSGOLINT_PATH` environment value. Compiler diagnostics show `ts`; lint diagnostics show `oxc`. The committed settings do not enable the experimental Rust TypeScript language server or change formatting and save actions.

Run the tooling guard to inspect the entire lock and installed dependency graph, verify lint coverage, and exercise deliberate lint violations. Run the compiler probe to verify that valid TypeScript and TSX pass and deliberate type errors stop builds:

```bash
bun run frontend:tooling:check
bun run frontend:compiler:check
```

The probe checks the installed package version and removes its temporary fixtures. Both verification commands and CI run the probe. Read the [migration findings](research/ts-rust-adoption.md) for compatibility evidence and scope.

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

Run the broad verification gate (typecheck, lint, tests, bindings check, release metadata, frontend build, `cargo fmt`/`clippy`/`test --workspace`, smoke run):

```bash
bun run verify
```

Run the fast local-loop subset (typecheck, lint, frontend tests, `cargo fmt --check`, `cargo clippy`, without the full build, Rust tests, smoke run, or dependency audits):

```bash
bun run verify:fast
```

Run the non-GUI smoke harness:

```bash
bun run smoke
```

Run the built desktop application against deterministic end-to-end workflows. On Linux, the native-close workflow requires an isolated X11 display:

```bash
GDK_BACKEND=x11 xvfb-run -a bun run e2e
```

On macOS, run `bun run e2e`.

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
