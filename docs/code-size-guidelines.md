# Code Size Guidelines

qa-scribe uses file size as a maintainability signal, not as a mechanical rewrite rule. A large file becomes actionable when it is maintained by humans and has separable responsibilities.

## Threshold

- Split maintained source and test files above 500 physical lines when there is a cohesive module seam. After Phase 4 of `docs/refactoring-roadmap.md`, exceeding this threshold requires an explicit exception.
- Treat 300-500 physical lines as a watch range. Leave cohesive files alone until a real responsibility split appears.
- Exclude generated files, binary assets, lockfiles, packaged icon outputs, and release metadata where splitting would reduce clarity.
- Prefer behavior-preserving extractions with unchanged public exports, Tauri command names, storage schemas, and product language.

## Exception Policy

An exception above 500 lines must record:

- the exact file;
- why the file remains cohesive;
- why splitting it would reduce clarity or increase coupling;
- a review date and the event that should trigger an earlier review.

Operational packaging/release files may be excluded when they have no useful responsibility seam. Those reviewed exclusions carry the same rationale, split-cost, review-date, and early-review-trigger metadata as an exception; the repository check rejects missing or expired metadata. Generated files, lockfiles, binary assets, and packaged icon outputs do not need individual exceptions. The 300-500 watch range is reported for review but does not fail validation.

## Evidence

- ESLint's `max-lines` rule exists to aid maintainability and reduce complexity. Its documented default maximum is 300 lines, and external summaries of the same rule note common recommendations in the 100-500 line range.
- Rust Clippy's `too_many_lines` configuration defaults to 100 lines for a function or method, which supports watching long routines even when a file remains cohesive.
- External maintainability guidance commonly treats files around 400-500 lines as worth reconsidering, while also warning against splitting cohesive modules into overly small fragments.

## Rust Unit Test Placement

- Inline `#[cfg(test)] mod tests` blocks are idiomatic for small Rust unit tests that document nearby private behavior.
- Move larger inline unit-test blocks into sibling child modules such as `mod tests;` plus `tests.rs` when the test block is the reason a maintained source file enters the watch range or crosses the split threshold.
- Keep these as unit tests, not integration tests, when they need private access through `use super::*` or focused `use super::{...}` imports.
- Do not move every inline test module mechanically; prefer the smallest change that improves the production file's readability without changing public exports, command names, storage schemas, or behavior.

## Historical Audit

Line counts were measured with tracked plus untracked workspace files that exist on disk. The implementation target is maintained source and test files above 500 physical lines.

| File | Lines | Classification | Action |
| --- | ---: | --- | --- |
| `src-tauri/src/commands/ai.rs` | 2091 | Tauri AI command source | Split command DTOs, prompt preferences, job execution, and tests into submodules. |
| `frontend/src/App.tsx` | 1266 | React app shell | Split shell/sidebar/workflow helpers while preserving visible behavior. |
| `crates/qa-scribe-core/tests/session_storage.rs` | 1170 | Integration tests | Split fixtures/helpers from scenario groups. |
| `src-tauri/src/commands/providers.rs` | 1118 | Tauri provider readiness source | Split DTOs, probing, detection, model descriptors, and tests. |
| `crates/qa-scribe-core/src/services/session_service.rs` | 867 | Core persistence service | Split settings, sessions, entries, findings, drafts, AI runs, and attachments methods. |
| `scripts/build_apt_repository.py` | 662 | Packaging script | Watch for future cleanup; not primary app source in this pass. |
| `scripts/validate_linux_package_metadata.py` | 647 | Packaging script | Watch for future cleanup; not primary app source in this pass. |
| `crates/qa-scribe-core/src/domain/mod.rs` | 589 | Core domain model | Split domain records by Session, Entry, Finding, AI, settings, and validation. |
| `crates/qa-scribe-core/src/generation/mod.rs` | 554 | Generation module tests | Move tests out of the public module file. |
| `frontend/src/tauri.ts` | 502 | Frontend Tauri bridge | Split exported DTO types from command wrappers while preserving `./tauri` imports. |

Generated assets and lockfiles are intentionally excluded, even when they exceed 500 lines.

## v0.7.10 Post-Split Result

At v0.7.10, no maintained app source or test file remained above 500 physical lines. The remaining text files above 500 lines were packaging or release surfaces:

- `scripts/build_apt_repository.py`
- `scripts/validate_linux_package_metadata.py`
- `.github/workflows/release.yml`

These remained watch-list items rather than automatic split targets because they are operational packaging/release code, not primary app source, and no low-risk cohesive split seam was identified.

## Current Audit

Measured on 2026-07-13 at v0.7.13, four maintained Rust test files have grown above the threshold:

| File | Lines | Classification | Required action |
| --- | ---: | --- | --- |
| `crates/qa-scribe-core/src/generation/tests.rs` | 746 | Generation unit tests | Split by prompt, projection, response repair, and managed-image behavior while retaining private access. |
| `crates/qa-scribe-core/tests/session_storage/migrations.rs` | 711 | Migration integration tests | Split schema fixtures from migration-version and integrity scenarios. |
| `crates/qa-scribe-core/src/generation/workflow/tests.rs` | 673 | Generation workflow unit tests | Split preparation, completion, stale-write, and evidence scenarios into sibling test modules. |
| `crates/qa-scribe-core/tests/session_storage/generation_and_relationships.rs` | 539 | Storage integration tests | Split AI Run/Draft lifecycle from Evidence relationship scenarios. |

This is documentation and test-organization drift, not a production-source regression. Phase 4 of `docs/refactoring-roadmap.md` owns the cleanup.

## Enforcement Target

Phase 4 adds a repository check with these semantics:

- fail on a maintained source or test file above 500 physical lines unless it has a current exception;
- report, but do not fail, maintained files in the 300-500 watch range;
- ignore generated files, binary assets, lockfiles, packaged icons, and release metadata;
- include explicitly reviewed operational-script exclusions;
- run in both the shared CI and release validation action.

The check should measure physical lines consistently and print the classification and remediation for every failure. Do not introduce arbitrary file splitting solely to satisfy the number; an exception is preferable when the file is genuinely cohesive.
