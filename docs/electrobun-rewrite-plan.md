# Electrobun Rewrite Plan

Research date: 2026-06-18

## Decision Summary

Rewrite qa-scribe from Electron to Electrobun, targeting `electrobun@1.18.1`.

`1.18.1` is the current npm `latest` stable dist-tag. A newer `1.18.4-beta.6` exists, but it is beta-tagged and should not be used for the stable rewrite baseline.

The migration is feasible, but it should be treated as a shell/runtime rewrite rather than a simple package swap. The renderer and domain/service model can mostly survive. The risky surfaces are the host bridge, SQLite driver, packaged subprocess behavior, and release packaging expectations.

## Current State

qa-scribe is currently an Electron/Vite/React desktop app:

- Electron shell and app lifecycle live in `src/main/index.ts`.
- Electron IPC and native utility handlers live in `src/main/ipc.ts`.
- The renderer sees a narrow `window.qaScribe` bridge from `src/preload/index.ts`.
- The service layer owns SQLite, attachments, AI provider CLI execution, generation, and exports under `src/main/services`.
- SQLite uses `better-sqlite3` and `drizzle-orm/better-sqlite3`.
- Packaging uses `electron-builder`, Electron rebuild scripts, ASAR config, and platform-specific package targets in `package.json`.

Key local evidence:

- `package.json` scripts currently run `electron-vite`, `electron-builder`, `electron-rebuild`, and `npm rebuild better-sqlite3`.
- `src/main/index.ts` imports `app`, `BrowserWindow`, `screen`, and `shell` from Electron.
- `src/main/ipc.ts` defines 30 request/response IPC handlers.
- `src/preload/index.ts` exposes 30 method-oriented `QaScribeApi` calls.
- `src/main/db/client.ts` uses `better-sqlite3`; migrations use `pragma`, `exec`, and transactions.
- `src/main/services/ai/commandRunner.ts` depends on `node:child_process`, stdin/stdout/stderr streams, timeouts, cwd, env, and GUI-app PATH hydration.

## Target Architecture

Use Electrobun as the desktop shell and Bun runtime:

- Host entrypoint: new `src/bun/index.ts`.
- Renderer view: move from Electron renderer output to an Electrobun `views://mainview/index.html` view.
- Host/renderer bridge: replace Electron `ipcMain.handle` plus preload `ipcRenderer.invoke` with Electrobun typed RPC.
- Renderer compatibility: preserve `window.qaScribe` initially by building a browser-side adapter over `Electroview` RPC. This avoids rewriting 35 direct renderer call sites immediately.
- Persistence: replace `better-sqlite3` with Bun SQLite and `drizzle-orm/bun-sqlite`, pending spike.
- Native utilities: use Electrobun `Utils` for file dialog, external URL opening, clipboard PNG bytes, and app-scoped user data paths.
- Window utilities: use Electrobun `BrowserWindow` and `Screen`; implement manual display matching if no direct `screen.getDisplayMatching` equivalent exists.

## API Mapping

| Current Electron usage | Electrobun/Bun direction | Notes |
| --- | --- | --- |
| `BrowserWindow` creation | `BrowserWindow` from `electrobun/bun` | Supports title, frame, URL, title bar style, visibility/focus, movement/resize events, and RPC. |
| `app.getPath('userData')` | `Utils.paths.userData` | Scoped by app identifier and channel. This changes the exact on-disk path and needs migration/compatibility thought. |
| `screen.getDisplayMatching(bounds)` | `Screen.getAllDisplays()` plus local matching | No direct equivalent verified. Manual intersection/containment is acceptable. |
| `shell.openExternal(url)` | `Utils.openExternal(url)` | Keep the current `http`, `https`, `mailto` allowlist. |
| `dialog.showOpenDialog` | `Utils.openFileDialog` | Verify `allowedFileTypes` syntax with qa-scribe's Evidence filter. |
| `clipboard.readImage().toPNG()` | `Utils.clipboardReadImage()` | Returns PNG bytes or `null`. Convert `Uint8Array` to `Buffer` where existing service code expects `Buffer`. |
| `nativeImage.createFromBuffer` + `clipboard.writeImage` | `Utils.clipboardWriteImage(Uint8Array)` | Native image object is no longer needed if the source bytes are PNG. |
| `ipcMain.handle` / `ipcRenderer.invoke` | `BrowserView.defineRPC` / `Electroview.defineRPC` | Current bridge is request/response only, so typed RPC is a good fit. |
| Electron sandboxed preload | Trusted Electrobun RPC view | Electrobun `sandbox: true` disables RPC, so do not port Electron's sandbox setting literally for the main trusted UI. |
| `electron-builder` package config | `electrobun.config.ts` | App metadata, views, copied assets, icons, signing, Linux renderer choice, release base URL, and artifacts move here. |

## Required Spikes

Do these before a broad rewrite branch. They are small enough to fail fast.

1. SQLite parity spike
   - Create a Bun SQLite version of `createDbClient`.
   - Replace `better-sqlite3` with `bun:sqlite` and `drizzle-orm/bun-sqlite`.
   - Validate `user_version`, WAL/foreign-key pragmas, `.returning().all()`, `.get()`, raw `prepare`, `.exec`, and transaction behavior against `SessionService` tests.

2. Electrobun RPC bridge spike
   - Define a shared RPC schema for the current 30 `QaScribeApi` methods.
   - Keep zod validation on the Bun host side.
   - Expose a browser-side `window.qaScribe` compatibility object backed by `Electroview`.
   - Prove file dialog import, clipboard screenshot import, copy image, generation run, and export still work through the bridge.

3. Window lifecycle spike
   - Recreate the main window with saved bounds, hidden-inset title bar, show timing, close/move/resize persistence, and external URL denial.
   - Implement display fitting with `Screen.getAllDisplays()`.
   - Decide how to handle minimum window size and background color, since direct equivalents were not verified in docs.

4. Provider CLI subprocess spike
   - Run `runCommand` and `runCodexModelListSession` inside Electrobun dev and packaged builds.
   - Verify ENOENT detection, stdin, stdout/stderr streaming, timeout kill, cwd, login-shell PATH hydration, and environment overrides.
   - Repeat on macOS first; then Windows/Linux before release parity claims.

5. Renderer build spike
   - Prove Bun/Electrobun can bundle React 19, Tiptap, CSS imports, and `streamdown` in a view.
   - Decide whether Vite remains for tests/story tooling or is removed.

## Implementation Phases

### Phase 1: Prepare the Codebase

- Add an Electrobun branch and keep Electron working until the Electrobun shell can run.
- Introduce `src/bun/index.ts` and `src/renderer-view` or equivalent view entrypoints.
- Add `electrobun.config.ts` with:
  - `app.name: "qa-scribe"`
  - `app.identifier: "com.qa-scribe.app"`
  - `app.version` read from `package.json`
  - `build.bun.entrypoint`
  - `build.views.mainview.entrypoint`
  - `build.copy` for `index.html` and CSS/assets
  - `build.linux.bundleCEF: true` and `build.linux.defaultRenderer: "cef"` unless a Linux native renderer spike says otherwise
  - placeholder icon/signing/release fields

### Phase 2: Port Host Composition

- Replace Electron `app.whenReady` composition with Bun entrypoint initialization.
- Instantiate the DB with `Utils.paths.userData`.
- Instantiate `SessionService` with `join(Utils.paths.userData, "attachments")`.
- Create the main `BrowserWindow` with `url: "views://mainview/index.html"` and RPC.
- Implement window state read/write under `Utils.paths.userData`.
- Replace external URL handling with `Utils.openExternal` and keep the protocol allowlist.
- Add `ApplicationMenu.setApplicationMenu` with Edit roles so copy/paste/select-all shortcuts keep working.

### Phase 3: Port the Bridge

- Convert each `ipcMain.handle` channel to an RPC request handler.
- Preserve method names in a renderer adapter matching `QaScribeApi`.
- Keep all existing zod parses in the host handler layer.
- Use `Utils.openFileDialog`, `Utils.clipboardReadImage`, and `Utils.clipboardWriteImage` for native attachment flows.
- Do not expose filesystem, subprocess, or clipboard primitives directly to React.

### Phase 4: Port Persistence

- Switch from `better-sqlite3` to `bun:sqlite`.
- Switch Drizzle import from `drizzle-orm/better-sqlite3` to `drizzle-orm/bun-sqlite`.
- Rewrite `pragma` usage as Bun SQLite-compatible SQL or API calls.
- Keep schema files as-is unless the driver forces type-level changes.
- Run the complete service test suite against the new driver before removing `better-sqlite3`.

### Phase 5: Port Build and Packaging

- Replace npm/Electron scripts with Bun/Electrobun scripts:
  - `dev`: `electrobun dev --watch`
  - `start`: `electrobun run`
  - `build:dev`: `electrobun build`
  - `build:canary`: `electrobun build --env=canary`
  - `build:stable`: `electrobun build --env=stable`
  - keep `lint` and test scripts after runner decision
- Remove Electron packages only after the Electron shell files are deleted:
  - `electron`
  - `electron-vite`
  - `electron-builder`
  - `@electron-toolkit/*`
  - Electron rebuild tooling
- Remove `better-sqlite3` and related rebuild scripts only after the SQLite spike passes.
- Replace `package-lock.json` with Bun lockfile if the repo decides to fully move to Bun as package manager.

### Phase 6: Release Engineering

- Replace electron-builder artifact expectations with Electrobun artifacts.
- Build per host OS/architecture in CI; do not assume one machine can build every production target.
- Decide release hosting and set `release.baseUrl` before enabling the updater.
- Decide canary/stable channel policy.
- Add macOS signing/notarization only once app id, certificates, and secrets are ready.
- Document that Windows/Linux installer formats change from current `nsis`, `AppImage`, and `deb` targets to Electrobun's artifact model unless custom packaging is added later.

## Test Plan

- Keep current Vitest service and renderer tests green during the transition where practical.
- Add Bun/Electrobun smoke tests for:
  - app launch
  - view loading
  - RPC request/response
  - file import dialog cancellation and success
  - clipboard screenshot import
  - SQLite open/migrate/session CRUD
  - provider CLI detection with fake and real commands
- Run manual packaged smoke tests on macOS before claiming release readiness.
- Add CI matrix jobs later for macOS, Windows, and Linux stable builds.

## Risks and Mitigations

- Electrobun sandbox differs from Electron sandbox: use trusted RPC for the main app view; use sandbox only for untrusted remote content.
- SQLite migration is not drop-in: isolate it behind `DbClient`, spike first, and keep schema unchanged until proven otherwise.
- Provider CLI subprocesses may behave differently in packaged Bun/Electrobun apps: run dev and packaged spikes before migrating generation UI.
- Linux behavior differs: plan for bundled CEF unless native GTKWebKit is proven sufficient.
- Packaging outputs change: release docs and CI should be updated before replacing Electron packaging.
- User data path may change due to `Utils.paths.userData` channel scoping: decide whether to migrate existing Electron data or treat Electrobun as a new data root during early builds.

## Source Notes

Sources used through Exa:

- https://docs.electrobunny.ai/electrobun/
- https://docs.electrobunny.ai/electrobun/guides/quick-start/
- https://docs.electrobunny.ai/electrobun/guides/hello-world/
- https://docs.electrobunny.ai/electrobun/guides/architecture/overview/
- https://docs.electrobunny.ai/electrobun/guides/changelog/v1-18-1/
- https://docs.electrobunny.ai/electrobun/apis/browser-window/
- https://docs.electrobunny.ai/electrobun/apis/browser/electroview-class/
- https://docs.electrobunny.ai/electrobun/apis/utils/
- https://docs.electrobunny.ai/electrobun/apis/application-menu/
- https://docs.electrobunny.ai/electrobun/apis/bundled-assets/
- https://docs.electrobunny.ai/electrobun/apis/cli/cli-args/
- https://docs.electrobunny.ai/electrobun/guides/cross-platform-development/
- https://docs.electrobunny.ai/electrobun/guides/code-signing/
- https://docs.electrobunny.ai/electrobun/apis/updater/

Sources used through Ref:

- https://docs.electrobunny.ai/electrobun/guides/changelog/v1-18-1/
- https://orm.drizzle.team/docs/connect-bun-sqlite
- https://github.com/oven-sh/bun/blob/main/docs/runtime/sqlite.mdx?plain=1#L166#query
- https://github.com/oven-sh/bun/blob/main/docs/runtime/sqlite.mdx?plain=1#L526#transactions
- https://github.com/oven-sh/bun/blob/main/docs/api/node-api.md?plain=1#L1#entire-document

Additional local verification:

- `npm view electrobun version dist-tags time repository homepage bugs --json`
- `npm pack electrobun@1.18.1` and inspection of package type/source files under `/tmp/electrobun-1.18.1-inspect`
- Full local reads of the Electron shell, IPC, preload, DB, service, provider, and relevant test files.
