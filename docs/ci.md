# Continuous integration

The CI workflow is deliberately divided by responsibility:

- **Quality gate (Linux)** is the authoritative repository gate. It runs the
  frontend and dependency audits, static checks, tests, release-script tests,
  production build, Tauri contracts, Rust formatting, clippy, tests, build,
  smoke harness, a built-application WebdriverIO suite, and the deterministic
  large-fixture startup budget. This job always runs so changes cannot
  accidentally fall outside a path filter.
- **Platform tests (macOS)** run native Rust tests and an Intel cross-compile
  when Rust, Tauri, frontend, icon, or workflow inputs change. Platform-neutral
  frontend checks and dependency audits are not repeated here.
- **Built application E2E (macOS arm64, observational)** runs the same isolated
  critical workflows through the embedded WebDriver provider on every CI
  execution. The job is non-blocking and deliberately excluded from the
  `CI success` dependency graph while it accumulates promotion evidence.
- **Package test (Linux)** builds and validates distributable Linux artifacts
  only when a packaging input changes. It starts only after the quality gate
  succeeds. After metadata validation it installs and launches the final deb
  and executes the AppImage on Ubuntu, then mounts the same artifact directory
  into a digest-pinned Fedora 43 container where `dnf` resolves the final RPM's
  dependencies before launch. Each smoke uses isolated XDG state under Xvfb.
- **CI success** is the stable branch-protection check. It fails when any
  applicable job fails and accepts intentionally skipped platform/package jobs.

The `changes` job only controls expensive supplementary jobs. It never controls
the quality gate. This avoids a broad change silently bypassing the primary
check and keeps a stable final check for branch protection.

## Shared setup and source-of-truth rules

`.github/actions/setup-project/action.yml` owns Node, Bun, Rust, Rust-cache, and
frozen frontend dependency setup. Bun is resolved from the root
`packageManager` field, while Rust is resolved from `rust-toolchain.toml` so
local and CI lint behavior cannot drift. Release and packaging jobs install the
exact Tauri CLI tool version from `scripts/tool-versions.json` through
`scripts/install-tauri-cli.mjs`. The installer rejects a pin whose major/minor
does not match the `tauri` runtime resolved in `Cargo.lock`; patch versions are
allowed to differ because the runtime and CLI are published independently. The
same tool-version source pins `cargo-audit`, and the shared CI/release validation
action installs that exact version through `scripts/install-cargo-audit.mjs`.

`.github/actions/validate-build/action.yml` is shared by CI and tag validation.
`.github/actions/run-built-app-e2e/action.yml` owns built-app execution,
independent production-frontend verification, summaries, and reliability artifacts for Linux and
macOS so their safety and evidence behavior cannot drift. Any new
repository-wide contract added to `bun run verify` should also be added to the
validation action when it benefits from a separately named CI step.

Run workflow linting locally after editing Actions configuration:

```sh
actionlint .github/workflows/*.yml
uvx zizmor .github
```

The shared validation gate runs both checks in CI and before tag releases.

## Built-application and startup evidence

The Linux quality and release-validation jobs install Xvfb and run the shared
built-app gate as a required control. The observational macOS arm64 job invokes
the same shared action without Xvfb. `bun run e2e` uses an isolated temporary
application-data directory and a deterministic local provider fixture; it does
not use accounts, network calls, or user data. The E2E frontend is built into
that temporary root and never replaces `frontend/dist`. Every gate reruns
an independent production frontend build and `bun run e2e:isolation` after the
test binary completes.

Every Linux execution uploads a 90-day `qa-scribe-e2e-passed-*` or
`qa-scribe-e2e-failed-*` marker containing its machine-readable metadata. macOS
uses the separate `qa-scribe-e2e-macos-passed-*` and
`qa-scribe-e2e-macos-failed-*` namespaces.
Marker retention follows the E2E step outcome even when a later startup or
quality step fails, so reliability evidence measures the built-app suite rather
than the rest of the job.
`bun run e2e:reliability:check` audits Linux markers, while
`bun run e2e:reliability:check:macos` audits macOS markers. Promotion is refused
until the latest 20 platform-specific runs all passed on attempt one. Each audit
pages past unrelated and other-platform artifacts until it finds those 20
distinct E2E runs or exhausts the retained artifact history. Full logs,
screenshots, and startup reports are uploaded for 14 days when validation
fails.

The startup step reuses the E2E binary, creates the versioned synthetic fixture,
and launches the app three times against the same database. It enforces the
3-second first-paint budget on `ubuntu-24.04-github-x64`, proves initial Session
hydration remains bounded, rejects an automatic Deep provider refresh, and
records production JavaScript raw/gzip sizes. E2E and startup measurements are
also written to the GitHub job summary, together with observational p50/p95
latency for an edit in the large active Note Entry.

## Release privilege boundaries

Build jobs have read-only repository permissions. They stage assets with the
GitHub Actions artifact service. A small downstream job with `contents: write`
publishes the completed asset set to the draft GitHub Release. This prevents a
long-running compiler, package script, or signing step from unnecessarily
holding a repository write token.

The Pages deployment job alone receives `pages: write` and `id-token: write`.
Signing jobs receive only the secrets they use. All third-party actions are
pinned to full commit SHAs, and Dependabot checks GitHub Actions updates weekly.

Release artifact smoke does not change those privilege boundaries. Linux
package installation uses the disposable runner's existing `sudo` access, and
the build job remains `contents: read`. RPM installation instead runs as root
inside a disposable, digest-pinned Fedora 43 container and uses `dnf` without
`--nodeps` before installing the Xvfb launch harness; the repository, final
artifacts, and host Bun executable are mounted read-only. The release job also installs the exact
generated APT setup deb, verifies the installed keyring and Deb822 source bytes,
mode, and ownership, then purges it. macOS mounts each signed/notarized DMG,
copies its app bundle to a temporary directory, and launches the copied
executable only after the temporary signing keychain, certificate, and API key
have been removed, and before the artifact is staged for publication. Signing,
notarization, checksum, and Gatekeeper checks still run independently.

## Repository settings

Code cannot enforce repository policy. Configure GitHub to:

1. Protect `main` and require the **CI success** status check.
2. Require pull requests before merging and require branches to be up to date,
   or enable merge queue; the workflow supports `merge_group` checks.
3. Require Actions to be pinned to full-length commit SHAs and restrict allowed
   actions to GitHub plus the explicitly used third-party publishers.
4. Keep the default workflow token read-only; job-level write permissions in
   the release workflow are explicit.
