# Release v0.8.12 with the Rust TypeScript checker

Ship the compiler migration on top of v0.8.11. End users keep the same application behavior. Maintainers get a pinned native checker for application and Vite configuration, with deliberate-error checks in local verification, CI, and release validation.

## Execution checklist

- [x] Fetch protected main and inspect current releases, open PRs, and branch protection.
- [x] Preserve the historical migration branch and unrelated local files. Start this release worktree at `68b8af3`.
- [x] Confirm v0.8.12 has no remote branch or tag. Build v0.8.11 and save its production assets.
- [x] Port migration commit `ad30a39` onto current main without replacing intervening application or CI changes.
- [x] Install the frozen lockfile with the repository-pinned Bun 1.3.5 and pass native checker probes against the current application.
- [x] Use the maintained version-bump script, replace its changelog placeholder, and validate all release metadata.
- [x] Pass the broad local gate, workflow lint, online workflow security audit, and production asset comparison.
- [x] Exercise the maintained deterministic desktop suite with a single Cargo writer.
- [ ] Complete comment review and independent worktree review of the exact release diff.
- [ ] Push the intended release branch and open its protected PR.
- [ ] Confirm exact-head hosted CI and independent verdict, then merge normally without bypassing protection.
- [ ] Confirm the merge-triggered Release run creates v0.8.12 at its merge SHA and publishes the expected signed installers and APT repository.

## Throughput checkpoint

The parent owns the release worktree, dependency state, Cargo output, authoritative validation, commits, and external writes. The release-flow delegate is read-only. The independent shipping reviewer uses a separate worktree. No shared Cargo directory has concurrent writers. Compiler probes use isolated scratch directories. Production builds and asset comparisons finish before desktop E2E rebuilds the frontend with its test bridge.

## Release conditions

Use the existing GitHub process in [Release workflow](releasing.md). Protected main requires the current `CI success` check with a current base. The normal merge triggers the tag and release. Do not manually push a tag, bypass protection, or publish a release before its platform and APT jobs succeed.

Current main already contains the reviewed Rust-advisory and packaging-size exceptions due on 2026-11-14. This release retains those reviewed constraints and the current CI runner/tool changes. The previous migration receipts describe the historical v0.7.24 checkout. New release evidence is recorded in [Release validation](research/ts-rust-release-validation.md) and `artifacts/tsrust-release`.

The committed checklist records the candidate before hosted outcomes. Final delivery reconciles external rows using the actual PR, run, tag, release, and Pages results. Do not make a post-release documentation commit merely to tick those rows.
