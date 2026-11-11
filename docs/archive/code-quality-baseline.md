# v0.7.13 Code Quality Baseline

Date: 2026-07-13. Commit: `a39eada7` (`Prepare v0.7.13 release`). Host used for reconstruction: local macOS arm64.

This is the fixed pre-roadmap comparison point. Source and frontend build/test results were reconstructed from the untouched commit in a temporary directory; dependency versions came from the committed lockfiles.

## Verification and coverage

- The initial `bun run verify:fast` gate was green.
- Frontend: 16 Vitest files, 131 tests passing.
- Rust workspace: 223 registered tests across unit, integration, and documentation targets; the full workspace suite was green.
- Production frontend: Vite 7.3.5, 1,885 transformed modules, no chunk-size warning.

## Production bundle

Vite-reported production output:

| Asset group | Raw | Gzip |
| --- | ---: | ---: |
| Application | 99.74 kB | 28.05 kB |
| Vendor | 270.22 kB | 89.74 kB |
| Rich editor | 393.27 kB | 119.35 kB |
| Icons | 8.58 kB | 3.43 kB |
| JavaScript total | 771.81 kB | 240.57 kB |
| CSS | 38.26 kB | 6.93 kB |

The ongoing large-fixture report records exact byte totals and per-chunk names, so comparisons after this baseline do not depend on Vite's rounded console output.

## Structural hotspots

| File at `a39eada7` | Physical lines |
| --- | ---: |
| `crates/qa-scribe-core/src/generation/tests.rs` | 746 |
| `crates/qa-scribe-core/src/generation/workflow/tests.rs` | 673 |
| `crates/qa-scribe-core/tests/session_storage/migrations.rs` | 711 |
| `crates/qa-scribe-core/tests/session_storage/generation_and_relationships.rs` | 539 |
| `frontend/src/app/useAppController.ts` | 347 |
| `frontend/src/app/types.ts` | 78 |

The frontend workflow boundary was the more important structural baseline than controller line count: workflow factories shared one `AppWorkflowContext` with nearly 50 fields. The roadmap measures its removal by capability contract width and ownership, not by forcing the controller below an arbitrary smaller line count.

## Startup instrumentation inventory

The baseline emitted frontend measures from `qa-scribe:startup:boot-start` to settings loaded, Sessions loaded, first Session or empty library ready, boot busy cleared, first paint, Fast provider status, and explicit Deep provider refresh. Backend logs covered app-data setup, storage initialization phases, database open, orphan AI Run recovery, SessionService readiness, and total setup.

No reproducible large-data startup or editor-input timing existed at the baseline. That gap is why Phase 6 introduced the versioned fixture and named-runner measurement instead of presenting an ad hoc local interaction as a regression budget; the first fixture-backed editor numbers are the forward comparison point.
