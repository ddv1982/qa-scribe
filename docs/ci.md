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
- **Package test (Linux)** builds and validates distributable Linux artifacts
  only when a packaging input changes. It starts only after the quality gate
  succeeds.
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
Tauri CLI version resolved for the `tauri` crate in `Cargo.lock` through
`scripts/install-tauri-cli.mjs`; workflow files do not carry a second version.

`.github/actions/validate-build/action.yml` is shared by CI and tag validation.
Any new repository-wide contract added to `bun run verify` should also be added
to this action when it benefits from a separately named CI step.

Run workflow linting locally after editing Actions configuration:

```sh
actionlint .github/workflows/*.yml
uvx zizmor .github
```

The shared validation gate runs both checks in CI and before tag releases.

## Built-application and startup evidence

The Linux quality and release-validation jobs install Xvfb and run the same
shared built-app gate. `bun run e2e` uses an isolated temporary application-data
directory and a deterministic local provider fixture; it does not use accounts,
network calls, or user data. The gate restores the production frontend and
reruns `bun run e2e:isolation` after the test binary completes.

Every execution uploads a 90-day `qa-scribe-e2e-passed-*` or
`qa-scribe-e2e-failed-*` marker containing its machine-readable metadata.
Marker retention follows the E2E step outcome even when a later startup or
quality step fails, so reliability evidence measures the built-app suite rather
than the rest of the job.
`bun run e2e:reliability:check` audits those markers and refuses platform
promotion until the latest 20 runs all passed on attempt one. The audit pages
past unrelated build/package artifacts until it finds those 20 distinct E2E
runs or exhausts the retained artifact history. Full logs,
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

## Repository settings

Code cannot enforce repository policy. Configure GitHub to:

1. Protect `main` and require the **CI success** status check.
2. Require pull requests before merging and require branches to be up to date,
   or enable merge queue; the workflow supports `merge_group` checks.
3. Require Actions to be pinned to full-length commit SHAs and restrict allowed
   actions to GitHub plus the explicitly used third-party publishers.
4. Keep the default workflow token read-only; job-level write permissions in
   the release workflow are explicit.
