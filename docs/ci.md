# Continuous integration

Linux CI and release validation run on `ubuntu-26.04`. Linux release builds
remain on `ubuntu-24.04` to preserve the published installer ABI baseline.
The [check inventory](verification/check-inventory.md) maps local commands,
hosted jobs, triggers, runners, proof obligations, and artifacts.

The CI workflow is deliberately divided by responsibility:

- **Quality gate (Linux)** is the authoritative repository gate. It runs the
  frontend and dependency audits, static checks, tests, release-script tests,
  production build, Tauri contracts, Rust formatting, clippy, tests, build,
  smoke harness, a built-application WebdriverIO suite, and the deterministic
  large-fixture startup budget. This job always runs so changes cannot
  accidentally fall outside a path filter.
- **Platform tests (macOS)** run native Rust tests and an Intel cross-compile
  when Rust, Tauri, frontend, icon, workflow, toolchain, or setup-helper inputs
  change. Platform-neutral frontend checks and dependency audits are not repeated here.
- **Built application E2E (macOS arm64, observational)** runs the same isolated
  critical workflows through the embedded WebDriver provider on every CI
  execution. The job is non-blocking and deliberately excluded from the
  `CI success` dependency graph while it accumulates promotion evidence.
- **Package test (Linux)** builds and validates distributable Linux artifacts
  only when a packaging input changes. It starts only after the quality gate
  succeeds. After metadata validation it installs and launches the final deb
  and executes the AppImage on Ubuntu, then mounts the same artifact directory
  into a digest-pinned Fedora 44 container where `dnf` resolves the final RPM's
  dependencies before launch. Fedora 44 matches the CI build host's glibc 2.43
  baseline. Each smoke uses isolated XDG state under Xvfb.
- **CI success** is the stable branch-protection check. It fails when any
  applicable job fails and accepts intentionally skipped platform/package jobs.

The separate `Native TypeScript tooling` workflow runs on pull requests that change
toolchain manifests, lockfiles, lint, TypeScript or Vite configuration, frontend
check helpers, native tooling checks and fixtures, probe drivers, CI, or editor
configuration. Manual dispatch remains available.
Ordinary application and Rust source changes do not create these isolated cache
proofs. Linux x64, macOS arm64, and macOS Intel each install from the frozen
lockfile with an empty lane-owned Bun cache. Each lane validates dependencies,
typed lint fixtures, native compiler diagnostics, frontend checks, and production
builds. It saves the populated cache under an exact-head, platform, lockfile,
run, and attempt key, deletes local packages and cache, then restores that exact
key and repeats the checks after another fresh installation. A hash verifies
restored cache bytes before the warm installation. Uploaded receipts name the
actual host architecture, tested commit and PR source head, cache key, cache-hit
output, cache file counts and bytes, and command logs.
This workflow publishes no release and does not replace the protected quality
gate. All three native lanes must pass before landing a tooling migration.
The full frontend behavior suite runs in the unconditional quality gate and
again in release validation. Native installation lanes do not repeat that
JSDOM suite. They prove native dependency, compiler, lint, and build behavior on
each architecture; they do not claim complete Intel UI behavior. Built-app
Linux and macOS arm64 workflows remain separate checks.
The overall job limit is thirty minutes on macOS arm64 and fifteen minutes on
Linux x64 and macOS Intel. Installation commands retain their 180-second limits.

The `changes` job only controls expensive supplementary jobs. It never controls
the quality gate. This avoids a broad change silently bypassing the primary
check and keeps a stable final check for branch protection.
Both conditional filters include `rust-toolchain.toml`. macOS also includes the
hosted Rust normalization script and the frontend postinstall SDK helpers that
its setup executes. Package routing already includes all `scripts/**` inputs.
The workflow tests read these filters and the native trigger paths from YAML,
then compare changed-path cases with literal applicable job sets. Linux quality
and observational macOS E2E still run for documentation-only changes.

## Shared setup and source-of-truth rules

`.github/actions/install-linux-validation-deps/action.yml` owns the shared Linux
desktop and test package list for CI and release validation. Packaging jobs have
additional dependencies and retain their own lists.

`.github/actions/setup-project/action.yml` owns Node, Bun, Rust, Rust-cache, and
frozen frontend dependency setup. Bun is resolved from the root
`packageManager` field, while Rust is resolved from `rust-toolchain.toml` so
local and CI lint behavior cannot drift. On disposable GitHub-hosted runners,
`scripts/normalize-ci-rust-toolchains.sh` retains the exact active pinned
toolchain and removes unused toolchains before cache restoration. It sets the
retained toolchain as the default first. Components and cross-compilation targets
belonging to that toolchain remain installed. Local and self-hosted machines skip
normalization.

After Node setup, `scripts/normalize-ci-apt-sources.mjs` selects
`https://archive.ubuntu.com/ubuntu` for GitHub-hosted Linux runners. Both the
shared action and helper require explicit `Linux` and `github-hosted` context.
The action resolves Node before invoking it through `sudo` with `/etc/apt` as the
explicit root. Local, self-hosted, and macOS runs skip this step.

The helper replaces only `http://azure.archive.ubuntu.com/ubuntu` and
`https://azure.archive.ubuntu.com/ubuntu`, with an optional trailing slash, and the
default `mirror+file:/etc/apt/apt-mirrors.txt` selector, including its triple-slash spelling.
It inspects `sources.list` and immediate `.list` and `.sources` files in
`sources.list.d`. Only active legacy source URI positions and enabled Deb822
`URIs` values change. Suites, components, architectures, signing keys, comments,
file modes, and ownership remain intact. Security and ports hosts, third-party
repositories, and other mirror-list references remain unchanged. An eligible
Azure archive URI retains its security suite when normalized.

This selects the official archive after slow Azure HTTP package downloads
exhausted Linux CI budgets. It adds no retry, probe, or APT trust override.
Existing TLS, signature, hash, and expiry checks still apply. Logs report changed
file and URI counts without source contents. Hosted package throughput remains
unproved until the fixed source completes the existing CI and release jobs.
The current affected Linux callers use x64. This does not establish archive
compatibility for future Ubuntu ports or ARM runners.

The pinned Rust cache action hashes every installed compiler. Normalization
prevents an unused preinstalled compiler update from invalidating the cache.
Compiler identity, operating system, architecture, environment, configuration,
and dependency hashes remain enabled. Upgrading the project compiler still
causes a legitimate cold cache.

Release and packaging jobs install the
exact Tauri CLI tool version from `scripts/tool-versions.json` through
`scripts/install-tauri-cli.mjs`. The installer rejects a pin whose major/minor
does not match the `tauri` runtime resolved in `Cargo.lock`; patch versions are
allowed to differ because the runtime and CLI are published independently. The
same tool-version source pins `cargo-audit`, and the shared CI/release validation
action installs that exact version through `scripts/install-cargo-audit.mjs`.
It also pins actionlint 1.7.12 and Zizmor 1.30.1 in the same tool-version source.
`scripts/check-workflows.mjs --github-output` validates those pins before emitting
the `actionlint` and `zizmor` outputs consumed by the shared validation action.

Both Rust setup steps pin the upstream `dtolnay/rust-toolchain` master commit
`7e38f4b43b4db5c8dd498af069a4f6196df1d067` (2026-10-01). Its reachability from
upstream master was verified, unlike the previous stable-branch SHA flagged by
the authenticated online audit. This changes the action implementation pin,
not the Rust channel, components, or additional targets.

`.github/actions/validate-build/action.yml` is shared by CI and release validation.
Its `runner-class` input defaults to `ubuntu-24.04-github-x64` for releases.
CI passes `ubuntu-26.04-github-x64` so reports identify their actual host.
`.github/actions/run-built-app-e2e/action.yml` owns built-app execution,
independent production-frontend verification, summaries, and reliability artifacts for Linux and
macOS so their safety and evidence behavior cannot drift. Any new
repository-wide contract added to `bun run verify` should also be added to the
validation action when it benefits from a separately named CI step.

The shared gate also runs `bun run frontend:tooling:check`. It rejects legacy
TypeScript dependencies in all lock records and installed packages, including
aliases and optional records. Installed upstream development-only declarations
are not runtime dependencies. The guard checks runtime TypeScript peer ranges,
literal runtime compiler API imports, retained lint rules, options, scopes, and
behavioral fixtures. Computed dynamic imports cannot be proved absent by a
static literal-import check. Review new compiler consumers when changing dependencies.
Historical migration evidence remains in the [TypeScript 7 plan](typescript-7-native-tooling-plan.md).

Run workflow linting locally after editing Actions configuration:

```sh
node scripts/check-workflows.mjs
GH_TOKEN="$(gh auth token)" uvx --from zizmor==1.30.1 zizmor .github
```

Install actionlint at the pinned version before running the checker locally.
The Zizmor command uses authenticated online audits, not an offline or older
compatible profile. CI explicitly enables online audits and disables only SARIF
upload (`advanced-security: false`), not security checks.

All eleven same-repository `uses` references now use GitHub's `$/` syntax.
GitHub supports it in workflows and composite actions on runner 2.336.0 or newer
(the reviewed hosted runner was 2.337.0). Released actionlint 1.7.12 does not yet
understand that syntax. The mandatory `Lint Workflows` step therefore runs the
repository checker after Raven installs the pinned binary and dependencies with
`flags: '-version'`. The install step is not workflow validation.

The pinned actionlint release predates the hosted `ubuntu-26.04` label.
`.github/actionlint.yaml` adds that exact label through actionlint's
`self-hosted-runner.labels` configuration. This is the tool's label-extension
mechanism; the workflow still selects GitHub-hosted runners. Other unknown
labels remain errors. Remove this extension when a released actionlint version
recognizes the label.

The checker parses YAML and gives actionlint a temporary stdin view that changes
only actual same-repository `uses` values from `$/` to `./`. It retains original
filenames for diagnostics and all other fields and lint checks. It never rewrites
source files or adapts away reported failures. YAML anchors and aliases are
unsupported by this compatibility view and fail closed. Remove the view only
after an official actionlint release supports `$/` natively and passes the
repository's checker contracts; an unreleased upstream change is insufficient.
Upstream tracking: [issue 711](https://github.com/rhysd/actionlint/issues/711) and
[PR 732](https://github.com/rhysd/actionlint/pull/732).

The earlier actionlint 1.7.12 / Zizmor 1.29.0 local review was historical evidence
only. The later authenticated audit `d1efc80d-3320-4eab-9046-ab017ed1e399` exited
14 with two HIGH Rust SHA findings and eleven LOW `self-repository` findings.
The reachable Rust pin, eleven `$/` references, and narrow lint view resolve the
configuration causes, without new ignores, severity thresholds, or downgrades.
A passing current authenticated audit and hosted gate must still be recorded
for the integrated revision. See the [1.30 release notes](https://github.com/zizmorcore/zizmor/releases/tag/v1.30.0)
and [GitHub self-repository announcement](https://github.blog/changelog/2026-07-30-reference-same-repository-actions-with-self-repository-syntax/).

## Built-application and startup evidence

The Linux quality and release-validation jobs install Xvfb and run the shared
built-app gate as a required control. The observational macOS arm64 job invokes
the same shared action without Xvfb. `bun run e2e` uses an isolated temporary
application-data directory and a deterministic local provider fixture; it does
not use accounts, network calls, or user data. The E2E frontend is built into
that temporary root and never replaces `frontend/dist`. Every gate reruns
an independent production frontend build and `bun run e2e:isolation` after the
test binary completes.

The default invocation plan in `scripts/run-e2e.mjs` also registers
`first-use.e2e.mjs` on Linux and macOS. It uses its own home, app data, fixtures,
and artifacts. `latest-run.json` records the planned IDs and completed invocations;
compare these arrays rather than relying on a historical hardcoded count.
Every invocation still requires a completed machine receipt with positive passed
count and zero failed or skipped tests. Linux model restart pairs and their lane
receipts remain required. Optional first-use recording stays off in CI. The
first-use macOS resize helper calibrates its initial host height ceiling; source
registration alone does not establish successful macOS execution.

Command receipts are written before spawning and after completion. Each contains
`stage`, `command`, `status`, `exitCode`, `signal`, `spawnError`, `timeoutMs`,
`timedOut`, and `elapsedMs`. E2E records the first failed command and retains
completed invocations even if a later command fails. It continues later workflow
invocations and returns the first failure's exit code, or 1 for a signal, spawn
error, timeout, or missing execution evidence.

E2E caps frontend build at 180 seconds, native build at 600 seconds, fixture
seeding at 30 seconds, and WDIO at 180 seconds per invocation. UI polish has 420 seconds to cover its
existing 60-, 180-, and 120-second tests plus startup and teardown. Startup caps
fixture preparation and production build at 180 seconds each. A startup launch
has 240 seconds when reusing the binary, or 1020 seconds when its first launch
also needs the isolated builds. The latter includes the nested build limits and
180-second WDIO limit with reporting headroom. Existing installation command
limits remain 180 seconds. The full frontend behavior suite belongs to the
shared quality and release gate, rather than the installation driver.

These are outer command limits within the existing job limits, not replacements
for individual test or startup budgets. The retained macOS ten-invocation run
lasted about 348 seconds; a focused Linux build and invocation lasted about
107 seconds. Those aggregate observations do not calibrate each command, so
retain stage receipts before tuning the caps. Several consecutive timeouts can
still exhaust a job. Timeout termination targets the owned direct child with
SIGKILL. Descendant cleanup is not established by this wrapper, and no global
process scan or retry is added.

Installation receipts append a running cold, discard, or warm stage before work,
then retain completed commands and SDK evidence on failure. The original cache
hash and exact-restore checks still run. Startup writes a partial report before
commands and preserves every readable sample, including one written by a failed
launch, before throwing. The summary accepts incomplete reports and shows the
first failure, stage durations, cache outcome, and artifact location.

The retained one-second frontend boot assertions in record-editing titles and
refresh already await `activeSession`. Their cause remains unresolved. This
change neither lengthens those waits nor claims a root-cause repair. The later
macOS stale-element failure is a separate test-handle issue.

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
and launches the app three times against the same database. It records all
samples before enforcing a 4-second process-cold first-paint budget and a
3-second budget for every warm sample. CI reports use
`ubuntu-26.04-github-x64`; release-validation reports use
`ubuntu-24.04-github-x64`. The Ubuntu 26.04 migration starts a new runner history
without changing either budget or recalibrating earlier measurements. The gate
proves initial Session hydration remains bounded, rejects an automatic Deep
provider refresh, and records production JavaScript raw/gzip sizes. The job
summary includes those measurements and observational p50/p95
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

The APT publication job holds the fixed `qa-scribe-apt-publication` concurrency
group across both the live-version monotonicity check and Pages deployment.
`cancel-in-progress: false` protects a running publication; GitHub's default
single pending slot can still be replaced by a later queued job. Each job must
recheck the live index after acquiring the group because tag dispatch order
does not establish version order. Expensive platform builds retain their
separate per-tag concurrency. This configuration uses supported actionlint
syntax without suppressing workflow checks.

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
