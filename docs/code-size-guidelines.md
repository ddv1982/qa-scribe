# Code Size Guidelines

qa-scribe uses file size as a maintainability signal, not as a mechanical rewrite rule. A large file becomes actionable when it is maintained by humans and has separable responsibilities.

## Threshold

- Split maintained source and test files above 500 physical lines when there is a cohesive module seam.
- Treat 300-500 physical lines as a watch range. Leave cohesive files alone until a real responsibility split appears.
- Exclude generated files, binary assets, lockfiles, packaged icon outputs, and release metadata where splitting would reduce clarity.
- Prefer behavior-preserving extractions with unchanged public exports, Tauri command names, storage schemas, and product language.

## Evidence

- ESLint's `max-lines` rule exists to aid maintainability and reduce complexity. Its documented default maximum is 300 lines, and external summaries of the same rule note common recommendations in the 100-500 line range.
- Rust Clippy's `too_many_lines` configuration defaults to 100 lines for a function or method, which supports watching long routines even when a file remains cohesive.
- External maintainability guidance commonly treats files around 400-500 lines as worth reconsidering, while also warning against splitting cohesive modules into overly small fragments.

## Initial Audit

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

## Post-Split Result

After the source/test split pass, no maintained app source or test file remains above 500 physical lines. The remaining text files above 500 lines are packaging or release surfaces:

- `scripts/build_apt_repository.py`
- `scripts/validate_linux_package_metadata.py`
- `.github/workflows/release.yml`

These remain watch-list items rather than automatic split targets because they are operational packaging/release code, not primary app source, and no low-risk cohesive split seam was needed for this pass.
