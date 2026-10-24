# Tauri service diagnostic backport

`@wdio/tauri-service@1.2.0.patch` backports upstream
[78a5c771](https://github.com/webdriverio/desktop-mobile/commit/78a5c771ea7a8b7eb6dabbeb5f11f2b6d4b43416)
(#618/#619), first published in 1.4.0. Both distributed ESM and CJS runtimes
forward merged launcher options and recognize the embedded provider before
checking for an external driver. External driver failures remain errors.

The project retains its pinned native ecosystem. Service 1.4.0 also changes
native-core/spy/types/utils and WDIO dependencies; its native-utils 2.7.0
requirement differs from our 2.5.0 override. Validate that broader upgrade
before removing this backport. Driver startup, readiness, window handling,
permissions and logging behavior are otherwise unchanged.

Install from `frontend/` with Bun 1.3.5 and `bun install --frozen-lockfile`.
Bun owns patch application through `patchedDependencies` and the lockfile.
The read-only preinstall check pins the patch's SHA-256 because Bun 1.3.5
accepted edited patch content in a warm-cache frozen-install control.
Update that checksum only with a reviewed patch change. Do not edit installed
bundles or add a postinstall rewrite. `--ignore-scripts` intentionally bypasses
lifecycle checks and is not the maintained installation route.

The actual launcher diagnostic regression tests are in
[`scripts/tauri-provider-diagnostics.test.mjs`](../../scripts/tauri-provider-diagnostics.test.mjs).
ESM uses the real logger. CJS captures diagnostic results with a test-only
logger adapter because its pinned logger/chalk interop already fails before
diagnostics; this is not a CJS runtime certification or a shipped logger fix.
