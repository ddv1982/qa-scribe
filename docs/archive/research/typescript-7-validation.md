# TypeScript 7 release validation

The release candidate uses `tsc-rs` 0.7.0 for both build projects, Microsoft TypeScript 7.0.2 for VS Code, Oxlint 1.89.0, and tsgolint 7.0.2004. TypeScript 6, compatibility aliases, and legacy compiler-API lint consumers are excluded by the maintained tooling guard.

T7-1 merged in [PR #61](https://github.com/ddv1982/qa-scribe/pull/61). T7-2 merged in [PR #62](https://github.com/ddv1982/qa-scribe/pull/62). T7-3 merged in [PR #63](https://github.com/ddv1982/qa-scribe/pull/63) at `110d643fa798d054bfede5c58c64f48093916c33`.

The final T7-3 head `d5e2651c024db2998fb6f075ce31a0cb22dc0788` passed all nine hosted checks. Native Linux x64, macOS arm64, and macOS x64 each passed cold installation, exact cache restoration, and warm validation in [native run 39555769767](https://github.com/ddv1982/qa-scribe/actions/runs/39555769767). [CI run 39555769886](https://github.com/ddv1982/qa-scribe/actions/runs/39555769886) passed quality, platform, desktop, and Linux packaging validation.

Independent Codex review passed the amended editor scope at `6d80007`. Both private Linux workspace layouts passed all ten functional scenarios, three root cycles, sampled child-environment checks, and owned cleanup. A separate Codex review passed the final documentation delta. All 625 reviewed source/policy files stayed unchanged. Two builds at the code verdict and one at the final documentation head produced the same 20 asset hashes. The [editor evidence](typescript-7-editor-evidence.json) binds the exact source, reports, and limits.

The paired long-session study and later seven-pair comparison are deferred, not met. The original study remains protocol-nonconformant. Historical lane 10 stays ISSUES with unknown prior effects. The original Intel settlement-test failure remains unexplained despite later passing runs. The release makes no speedup, memory-bound, performance-equivalence, or long-session stability guarantee. Linux editor proof does not establish macOS editor behavior.

## Release candidate gates

Run canonical `bun run verify` in a clean tracked checkout, online workflow security analysis, pinned actionlint, and expected-tag metadata validation. Run the complete default desktop E2E plan through the maintained harness. Preserve the existing startup and package checks in hosted CI and release validation.

Require a fresh independent release verdict at the final head and current protected CI before merging. Main push creates the missing version tag through the existing Release workflow. A tag alone does not prove publication. Verify all validation, native packaging, signing, APT, and final publication jobs, public assets and checksums, tag identity, and deployed APT metadata.

This document records release preparation. Candidate-local command receipts live in ignored `artifacts/ts7-release`. The release PR and workflow results provide the final execution record. No release is declared published by this preparation record.
