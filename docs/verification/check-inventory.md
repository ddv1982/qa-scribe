# Check inventory

This inventory describes the declared checks, not execution timings. Commands run
from the repository root with the pinned tools and frozen frontend dependencies.
The workflow YAML and `package.json` remain authoritative.

## Local feedback and gates

| Command | Trigger and runner | Proof | Evidence |
| --- | --- | --- | --- |
| `bun run verify:fast` | Local edit loop on Linux or macOS | Size, terminology, source E2E isolation, native tooling and compiler contracts, frontend checks and tests, command surface, Rust format and clippy. Ensures frontend output exists. Omits dependency audits, Rust tests, full build, smoke, and built-app E2E. | Command output |
| `bun run verify` | Local full gate on the host platform | Dependency audits, static checks, frontend and release-script tests, production build and isolation, Tauri contracts and bindings, Rust format, clippy, tests, build, and non-GUI smoke. Omits workflow lint, online Actions audit, built-app E2E, platform matrix, and package installation. | Command output |
| `node --test scripts/check-workflows.test.mjs` and `node scripts/check-workflows.mjs` | Workflow edits on Node 24 with pinned actionlint | YAML routing contracts, lint adapter behavior, and all declared workflows. Routing cases are source contracts, not hosted PR events. | Test and lint logs |
| Authenticated Zizmor command in [CI](../ci.md#shared-setup-and-source-of-truth-rules) | Workflow edits locally and in the shared validation action | Maintained online Actions security audit | Audit output and Actions log |
| `bun run frontend:test`, `bun run release:script-tests`, and `bun run linux:metadata:test` | Focused edits on the host platform | Frontend behavior, orchestration contracts, and package metadata units respectively | Test output |
| `bun run e2e` and `bun run startup:benchmark` | Built-app changes on an isolated supported host | Deterministic desktop workflows and startup budgets. Linux uses Xvfb. | `artifacts/e2e`, `artifacts/startup` |

## Hosted checks

| Workflow and jobs | Trigger and runner | Proof and commands | Artifacts |
| --- | --- | --- | --- |
| CI `changes`, `quality-linux`, `ci-success` | Every PR to main, push to main, and merge group. Ubuntu 26.04. | Changed-file outputs, unconditional `.github/actions/validate-build`, and stable required aggregation. The shared gate adds workflow lint, online Actions audit, built-app E2E, and startup budgets to repository validation. | Actions logs and summary, `qa-scribe-e2e-passed-*` or `qa-scribe-e2e-failed-*`, failure evidence |
| CI `rust-macos` | Platform input changes detected by `changes`. macOS 26 arm64. | Frontend build, prebuilt contract, `cargo test --workspace`, and Intel `cargo check`. Includes toolchain and setup helpers. | Actions log |
| CI `package-linux` | Package input changes after successful Linux quality. Ubuntu 26.04 and digest-pinned Fedora 44. | Package build, artifact and metadata checks, deb and AppImage launch, dependency-resolving RPM installation and launch, APT generator and installer checks. | Actions log, metadata report and summary |
| CI `e2e-macos` | Every CI execution. macOS 26 arm64. | Shared built-app gate, observational with `continue-on-error`. Excluded from `ci-success`. | `qa-scribe-e2e-macos-passed-*` or `qa-scribe-e2e-macos-failed-*`, failure evidence |
| Native TypeScript tooling `native-tooling` | PR tooling inputs or manual dispatch. Ubuntu 24.04 x64, macOS 26 arm64, and macOS 26 Intel. | Cold and exact-cache warm installs, SDK, lint, compiler, frontend checks and tests, metadata, production build, and isolation. Actual editor smoke on arm64. | `native-tooling-*`, `native-editor-smoke-*` |
| Release `release-context`, `validate-release`, `create-release` | Main pushes and authorized `v*` tags. Ubuntu 24.04. Publication proceeds only for an eligible version. | Resolve version and tag, metadata validation, same shared validation action, draft release notes. | Actions logs, validation E2E and startup evidence |
| Release `build-macos-release`, `build-linux-release` | Eligible release after validation and draft creation. macOS 26 arm64 and Intel, Ubuntu 24.04, Fedora 43 container. | Platform packaging, signed and notarized macOS installers, Linux packages and signed APT metadata, final installer launch checks. | Staged release assets and APT Pages artifact |
| Release `publish-release-assets`, `sign-release-checksums`, `publish-apt-repository`, `publish-release` | Successful eligible release build dependencies. Ubuntu 24.04. | Upload assets, signed checksums, monotonic APT deployment, and final publication. Signing and write privileges remain scoped to their existing jobs. | Public release assets, checksums and signatures, APT Pages |

CI declares six jobs. Four apply regardless of changed paths, including
observational macOS E2E and the final aggregation with its cancellation guard.
Two supplement them when declared inputs change. Native tooling declares one job
with three matrix lanes. Release declares nine jobs and expands to ten with the
two macOS architectures. These counts describe applicability, not successful
hosted executions or a timing improvement. They can be regenerated from `jobs`
and `strategy.matrix.include` in the three workflow YAML files.

## Routing and intentional repetition

`scripts/check-workflows.test.mjs` reads CI filters and native workflow paths from
the actual YAML. Its changed-path table asserts literal applicable job sets for
toolchain, setup-helper, Vite, frontend, packaging, and documentation changes.
Linux quality remains unconditional. Ordinary app and Rust source changes do not
need isolated native installation or editor proofs unless tooling inputs change.
Native probe drivers and frontend check helpers are tooling inputs. Release
metadata files and app source remain covered by unconditional quality and applicable
platform or package jobs.

Cold native installation proves an empty cache works. Warm installation proves
the exact saved cache restores and works after local packages are discarded.
Neither replaces the other. The production frontend build after E2E proves the
isolated test build did not contaminate distributable output, even on a failed
E2E run. Release validation repeats the shared quality gate at the release commit
and Ubuntu 24.04 ABI baseline before signing or publication. Those duties are
intentional. Local fast and full gates overlap for different feedback needs;
running both and every constituent command against unchanged source adds no
separate proof. Startup budgets and first-attempt reliability policy remain in
[CI](../ci.md#built-application-and-startup-evidence).
