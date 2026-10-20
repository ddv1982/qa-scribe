# Release v0.8.13 with pinned Rust and stable CI caches

End users receive a build made with Rust 1.99.1. Maintainers retain an exact compiler pin and avoid cache invalidation caused by unused toolchains on disposable hosted runners. Application behavior and dependency versions stay in scope only if compiler verification requires a correction.

## Phase 1. Establish the baseline

- [x] Fetch protected main and confirm the latest public release is v0.8.12 at `c790de8`.
- [x] Start `release/v0.8.13` from that exact main commit.
- [x] Pass the existing fast verification gate before changing the compiler.
- [x] Confirm how the pinned Rust cache action hashes installed toolchains and choose a normalization boundary.

## Phase 2. Upgrade and normalize

- [x] Change the exact Rust pin from 1.97.0 to 1.99.1. Retain Clippy, rustfmt, and caller-requested targets.
- [x] Pass formatting, Clippy, tests, and build on the new compiler. Fix only compiler-related failures.
- [x] Normalize the installed toolchain set before cache restore on disposable GitHub-hosted runners. Preserve the active pinned toolchain and all existing cache-key safety inputs.
- [x] Prove that unused toolchain changes no longer change the compiler inventory and that a real compiler change still does.
- [x] Verify that local and self-hosted environments cannot lose their toolchains.
- [x] Commit the compiler upgrade and cache maintenance separately.

## Phase 3. Validate the release candidate

- [x] Confirm v0.8.13 is unused. Run the maintained version-bump script and replace its changelog placeholder.
- [ ] Pass full `bun run verify`, workflow lint, and authenticated online workflow security analysis.
- [ ] Exercise the maintained deterministic desktop suite with only one Cargo writer.
- [x] Review the diff for unnecessary comments and suppressions.
- [ ] Obtain an independent isolated-worktree verdict bound to the exact head, base, and stable patch ID.
- [ ] Open the release PR and require fresh Linux, macOS, and packaging CI. Inspect observational macOS E2E as well as required checks.

## Phase 4. Publish through protected main

- [ ] Verify the independent verdict still matches the patch and all applicable CI jobs passed at the current head.
- [ ] Merge normally through branch protection. Do not push a manual tag or bypass a check.
- [ ] Verify the existing Release workflow creates v0.8.13 at the merge commit and passes both macOS packaging jobs, Linux packaging, signing, and APT publication.
- [ ] Verify the public release assets, signed checksums, and deployed APT package version.

## Verification rules

Done means a public v0.8.13 tag at the reviewed merge commit, successful release jobs, valid signed installers and APT metadata, and no unresolved correctness finding. Green unit tests alone do not satisfy this rule.

The Rust upgrade legitimately changes the cache key once. The cache change must prevent unrelated preinstalled compiler churn without disabling compiler, platform, flags, or dependency hashes. No build-time improvement is claimed without a separate measurement. Hosted cache restoration is assessed from the actual workflow logs.

There is no application interaction change or operator UI review gate. Existing desktop automation and package launch checks exercise the actual application. The independent reviewer verifies the setup CLI behavior in an isolated environment.

## Throughput checkpoint

- Blocking first steps. Establish the baseline, inspect the shared setup and cache implementation, and settle the hosted-runner boundary before editing.
- Independent workstreams. One read-only flow investigator shares this checkout. The parent owns implementation and authoritative validation. A later independent reviewer gets a separate worktree.
- Shared mutable state. The parent is the only dependency, Cargo, Git, and release metadata writer. Compiler installation precedes compiler validation. Desktop builds run after production checks.
- Smallest safe decomposition. One parent implements the two small maintenance changes in order. No parallel writers or new architectural layer are needed. Architect skipped because this is a mechanical setup change with a concrete installed-toolchain set and a single active compiler.

## Evidence

The local append-only decision log and command receipts live in ignored `artifacts/rust-ci-release`. This checklist records the candidate before publication. The final report reconciles PR, workflow, tag, release, and APT outcomes without a post-release documentation commit.
