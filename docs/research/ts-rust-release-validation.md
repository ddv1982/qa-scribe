# Native TypeScript checker release validation

The v0.8.12 candidate starts at current main `68b8af3`, v0.8.11. Historical receipts in `ts-rust-validation.md` concern the earlier v0.7.24 checkout and do not prove this release candidate. Decision-trail rows before `release-base` belong to that historical checkout. Their full local logs remain at `/home/vriesd/projects/qa-scribe/artifacts/tsrust-research`; their small committed receipts remain available in this branch.

## Candidate preparation

The migration cherry-pick preserved newer frontend packages, application behavior, CI runners, action pins, and reviewed dependency exceptions. Both current TypeScript projects pass the native checker without source or compiler-configuration changes. The twelve compiler probes pass with Bun 1.3.5 and Node 24.22.0. The version-bump script updates all seven maintained metadata files. Its expected changelog scaffold failure is resolved with release notes.

## Local verification

`bun run verify` passes with Bun 1.3.5, Node 24.22.0, and Rust 1.97.0 on Linux x64. It covers the current audit registry, code-size policy, compiler probes, typed lint, CSS and contrast checks, 572 frontend tests, five Python package tests, 181 release-script tests, bindings, command definitions, formatting, clippy, 566 Rust workspace tests, builds, and the storage smoke harness. Three Rust tests are intentionally ignored because they require authenticated provider CLIs or an Atlassian connector. Storage smoke initializes schema version 11.

`node scripts/check-workflows.mjs` passes with actionlint 1.7.12. Authenticated online Zizmor 1.30.1 reports no new findings and retains 33 existing suppressions. Expected-tag metadata validation passes for v0.8.12. The Comment Sicko audit reports zero added comments or suppressions and no findings. The deslop pass found no additional cleanup needed in the bounded migration diff.

The current application and both configurations pass TypeScript 6, the native checker, and the matching Microsoft TypeScript 7 compiler. A clean archive of the v0.8.11 frontend builds with Bun 1.3.5 and the unchanged dependency graph. All 20 resulting production assets match the release candidate byte for byte. The committed `release-compatibility.json` and `release-assets.json` receipts record these checks.

`QA_SCRIBE_E2E_ARTIFACTS=artifacts/tsrust-release/e2e xvfb-run -a bun run e2e` passes all 18 default Linux workflow invocations. Each has completed execution evidence, at least one passing assertion, no failed assertions, and no skipped assertions. The suite covers the five critical workflows, Chat-to-Note, three provider approval protocols, native close, model management, evidence and selection persistence across restart, and the three provider qualification modes. Isolated application data was removed. The committed `release-desktop-e2e.json` receipt records the result. Full logs remain under `artifacts/tsrust-release`.

The WDIO service emits missing external driver and teardown-session diagnostics on this host. The embedded WebDriver executed the scenarios successfully. The suite's assertion lifecycle receipts and final runner status establish the pass, rather than the presence or absence of those diagnostic strings.

## Independent review and hosted results

Pending independent review of the final candidate and hosted CI. Publication requires the protected merge and successful actual release pipeline. No tag or release has been created by this preparation.

## Execution ownership

Origin CLI is unavailable, so the parent uses GitHub CLI for the normal protected PR and merge process. The read-only Poteto release-flow investigator uses inherited GPT-6.1-Sol. Its turn was interrupted by the workspace handoff and completed after one bounded retry. The read-only Comment Sicko reviewer uses the inherited model. Both write no application files. The shipping reviewer will use an isolated worktree and a separately observed model. The parent owns all candidate edits, authoritative checks, commits, and publication actions.
