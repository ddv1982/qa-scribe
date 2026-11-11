# Codebase Remediation Plan

Date: 2026-07-20. Evidence boundary:
`docs/codebase-audit-2026-07-20.json`.

The canonical renderer result and runtime-attested audit checks are recorded in
`docs/codebase-audit-validation-2026-07-20.md`. The prerequisite
`evidence-backed-codebase-audit` Flow feature passed its independent detailed
review before this plan was created.

## Outcome

Resolve the audit's confirmed correctness and robustness risks first, restore
trust in validation and release tooling, then make bounded complexity reductions
without changing the SQLite schema, Tauri command names, generated binding
compatibility, provider authentication assumptions, or authoritative product
language.

This document is an implementation plan, not authorization to edit product
code. Each slice requires a later approved Flow feature, source-bound
validation, and independent review.

## Ordering Principles

1. Repair nondeterministic or moving validation before relying on those gates
   for behavioral refactors.
2. Protect authored Session data and user intent before performance or
   maintainability work.
3. Keep frontend request ordering local to the capability that owns it; do not
   introduce a global store or reducer.
4. Preserve process-tree cleanup, output bounds, transaction boundaries,
   sanitization allowlists, and stale-write guards while fixing adjacent logic.
5. Treat package installation coverage as release hardening, not proof that a
   current package is broken.
6. Implement low-priority cleanup only after the related correctness slices are
   stable and covered.

## Wave 0: Trustworthy Gates

### RP-01: Make provider temporary-file tests deterministic

- Findings: `AUD-008`.
- Outcome: Tauri provider cleanup tests assert only paths they own and cannot
  fail because another parallel test created a same-prefix directory.
- Targets: `src-tauri/src/commands/providers/tests/mod.rs`,
  `src-tauri/src/commands/providers/probe/command.rs`, and focused tests.
- Depends on: none.
- Review depth: standard.
- Validation: repeatedly run the previously failing full
  `cargo test -p qa-scribe-tauri` suite and the focused probe tests; do not
  accept rerun-until-green behavior.
- Non-goals: no production cleanup-policy or provider-protocol changes.

### RP-02: Isolate E2E workflows and make cancellation deterministic

- Findings: `AUD-014`.
- Outcome: every critical workflow starts from independent application data,
  and the fake provider waits for an explicit cancellation/release condition
  instead of a 350-1050 ms race.
- Targets: `scripts/run-e2e.mjs`, `e2e/wdio.conf.mjs`,
  `e2e/specs/critical-workflows.e2e.mjs`, `e2e/fixtures/bin/codex`, and E2E
  reliability checks.
- Depends on: none.
- Review depth: detailed because this changes the required release gate.
- Validation: source isolation check, repeated first-attempt built-app E2E runs,
  forced failure of one case proving no later-case contamination, and production
  frontend restoration.
- Non-goals: no additional production Tauri permissions or real-provider calls.

### RP-03: Pin the audit executable used by authoritative validation

- Findings: `AUD-017`.
- Outcome: CI and tag validation install a reviewed exact `cargo-audit` version
  from the repository's tool-version source.
- Targets: `scripts/tool-versions.json`,
  `.github/actions/validate-build/action.yml`, Rust-audit script tests, and
  `docs/ci.md`.
- Depends on: none.
- Review depth: standard.
- Validation: installer/unit tests, `bun run rust:audit`, workflow static checks,
  and a clean shared validation-action invocation.
- Non-goals: no advisory-registry or Rust dependency changes in the same slice.

## Wave 1: Data And Intent Integrity

### RP-04: Reconcile recovered Summary completion safely

- Findings: `AUD-001`.
- Outcome: recovered Summary completion cannot leave an editable stale Note or
  overwrite generated content through a later autosave; dirty local edits remain
  recoverable.
- Targets: `frontend/src/app/generationActions.ts`, Session workspace/save
  ownership, the Tauri job result/status contract only if required, and focused
  lifecycle/autosave tests.
- Depends on: `RP-02` for deterministic cross-layer coverage.
- Review depth: detailed because authored Note content is at risk.
- Validation: deterministic ordering tests for hydrate-before-completion and
  completion-before-hydrate, dirty-local-edit preservation, restart
  reconciliation, focused frontend tests, Rust Summary stale-write tests, and
  one built-app recovery scenario.
- Non-goals: no global frontend state framework and no SQLite schema migration
  unless a separate architecture decision proves revision storage necessary.

### RP-05: Make blank Session-title state explicit and protected

- Findings: `AUD-004`.
- Outcome: clearing a Session title produces a visible validation state and
  cannot be silently discarded or labelled autosaved during navigation or
  close.
- Targets: `frontend/src/app/sessionActions.ts`,
  `frontend/src/app/useAppController.ts`,
  `frontend/src/app/usePendingChangeProtection.ts`, Session editor feedback,
  and close/autosave tests.
- Depends on: `RP-04` because both change Session save coordination.
- Review depth: detailed because close protection and authored state interact.
- Validation: focused blank/whitespace autosave, navigation, browser unload,
  native close, save-failure, discard, and restoration tests.
- Non-goals: no backend relaxation of required Session titles.

### RP-06A: Enforce latest-intent ordering for Session navigation

- Findings: `AUD-002`.
- Outcome: stale Session and cross-Session library responses cannot replace a
  newer navigation choice.
- Targets: `frontend/src/app/sessionActions.ts`,
  `frontend/src/app/useOutputLibraries.ts`, linked library navigation in the app
  controller, and focused race tests.
- Depends on: `RP-05` to avoid overlapping Session-controller edits.
- Review depth: detailed because navigation crosses Session save and Record
  hydration ownership.
- Validation: reversed-promise-order tests for Session opens and library loads;
  verify operation-scoped busy/error state, focused Record hydration, and latest
  navigation intent.
- Non-goals: no generic request framework, provider-discovery changes, or
  application-wide reducer.

### RP-06B: Enforce monotonic provider-discovery ordering

- Findings: `AUD-003`.
- Outcome: older or shallower provider observations cannot replace newer deep
  discovery results.
- Targets: `frontend/src/hooks/useSettingsController.ts`, startup provider
  loading, Settings discovery, generation preflight refresh, and focused tests.
- Depends on: `RP-03` so the provider validation environment is reproducible.
- Review depth: standard because ownership stays inside provider observation
  state and no Rust provider contract changes are planned.
- Validation: reversed-promise-order tests for fast-versus-deep startup,
  automatic-versus-manual discovery, and repeated refresh; verify independent
  catalog/default lifecycle and retained last-good snapshots.
- Non-goals: no Session navigation changes, shared request framework, or global
  reducer.

### RP-07: Make generation cancellation a legal state machine

- Findings: `AUD-006`.
- Outcome: per-job cancellation reaches readiness, is rechecked before final
  persistence, and cannot transition from Cancelling to Running or Completed.
- Targets: `src-tauri/src/jobs.rs`, `src-tauri/src/commands/ai/job_runner.rs`,
  provider readiness/probe cancellation plumbing, and deterministic race tests.
- Depends on: `RP-01` for a stable Tauri suite.
- Review depth: detailed because process lifecycle and persistent records cross.
- Validation: cancel during preparation, readiness, child startup, streaming,
  post-provider/pre-persistence, and shutdown; assert legal terminal states,
  process-tree cleanup, no generated record after accepted cancellation, and
  retained status behavior.
- Non-goals: no weakening of watchdog, output, or process-group controls.

### RP-08: Fail closed when neutral provider scope cannot be created

- Findings: `AUD-007`.
- Outcome: every provider subprocess runs in a newly owned private directory or
  returns an actionable error before execution.
- Targets: `src-tauri/src/provider_command.rs`, provider probe/execution callers,
  command error mapping, and failure-injection tests.
- Depends on: `RP-01`, `RP-07`; cancellation plumbing lands first because both
  slices touch provider readiness and execution callers.
- Review depth: detailed because this enforces an accepted privacy boundary.
- Validation: private permissions, creation-failure injection, no subprocess
  spawn on failure, successful owned-directory cleanup, and provider probe plus
  generation tests.
- Non-goals: no change to provider PATH or authentication ownership.

### RP-09: Make structured generation and Evidence preferences truthful

- Findings: `AUD-009`, `AUD-010`.
- Outcome: structured providers without recognized assistant content fail with
  a compatibility error, while `preserveEvidence=false` actually suppresses
  deterministic restoration of omitted source images.
- Targets: core output-format/result types, stream parsers,
  `generation/workflow.rs`, Testware preferences, generated command bindings if
  the contract changes, and focused generation tests.
- Depends on: none.
- Review depth: detailed because Summary can replace a Note and Evidence intent
  affects persisted Testware.
- Validation: unknown/malformed structured events, current Claude/Codex fixtures,
  plain-text fallback, unchanged/stale Summary paths, preserve Evidence true and
  false with managed/external images, sanitization, bindings, and workspace
  tests.
- Non-goals: no live-provider requirement in deterministic CI and no provider
  protocol guesswork beyond sanitized fixtures.

## Wave 2: Performance And Delivery Robustness

### RP-10: Cache managed previews outside the typing path

- Findings: `AUD-005`.
- Outcome: each attachment preview is loaded once per identity/change and
  duplicate or stale IPC reads are bounded during editor updates.
- Targets: `frontend/src/editor/RichTextEditor.tsx`,
  `frontend/src/editor/editorHtml.ts`, cache lifecycle ownership, and editor
  tests.
- Depends on: none.
- Review depth: standard.
- Validation: command call-count tests across keystrokes, duplicate images,
  in-flight deduplication, attachment replacement/removal, failure/retry, stale
  response rejection, and editor behavior preservation.
- Non-goals: no new global cache or attachment persistence format.

### RP-11: Install and exercise final release artifacts

- Findings: `AUD-013`.
- Outcome: every required final package format receives a format-appropriate
  disposable install or execution smoke, and the actual APT setup package's
  installed files are verified.
- Targets: package workflows/actions, Linux and macOS package scripts, package
  test helpers, and `docs/ci.md`/release documentation.
- Depends on: `RP-02` so packaged smoke can reuse deterministic behavior without
  weakening production isolation.
- Review depth: detailed because release and platform boundaries change.
- Validation: install and launch deb/rpm, execute AppImage, mount/copy/launch the
  DMG app, install the setup deb, verify keyring/source permissions and content,
  and preserve signing/notarization checks.
- Non-goals: no publication, signing-secret changes, or expansion of release
  privileges in the implementation feature.

### RP-12: Make version bumps recover atomically

- Findings: `AUD-016`.
- Outcome: a failed write cannot leave version-bearing files inconsistent, and
  the tool has tested recovery behavior.
- Targets: `scripts/bump-version.mjs`, its tests, and release documentation.
- Depends on: none.
- Review depth: standard.
- Validation: injected failures at every replacement position, rollback or
  resumable recovery, unchanged dry-run/idempotency behavior, release metadata
  check, and cross-platform path handling.
- Non-goals: no version bump or release publication while implementing the fix.

## Backlog: Evidence-Gated Complexity Reduction

### RP-13: Bring YAML workflows under the existing size policy

- Findings: `AUD-015`.
- Outcome: maintained YAML is measured, and the release workflow is either
  split along a proven responsibility seam or given a current dated exclusion.
- Targets: `scripts/check-code-size.mjs`, policy fixtures,
  `scripts/code-size-policy.json`, `.github/workflows/release.yml`, and
  `docs/code-size-guidelines.md`.
- Depends on: `RP-11` so package/release behavior has stronger protection before
  structural workflow edits.
- Review depth: detailed if the workflow is split; standard for scanner plus a
  reviewed exclusion only.
- Validation: YAML scanner fixtures, actionlint, zizmor, release-script tests,
  and equivalence of job permissions, dependencies, artifacts, and conditions.
- Non-goals: no mechanical workflow split solely to reduce line count.

### RP-14: Consolidate rich-record patch resolution

- Findings: `AUD-011`.
- Outcome: Entry, Draft, Finding, and generated Summary paths share typed rich-
  body patch resolution while retaining their distinct transaction and stale-
  write semantics.
- Targets: core SessionService Entry/Draft/Finding/generation modules and their
  tests.
- Depends on: `RP-04`, `RP-09` so behavior fixes land before structural cleanup.
- Review depth: detailed because persistence transactions are touched.
- Validation: focused update/clear/default-format tests for each Record type,
  Summary stale-write and rollback tests, SQLite integration tests, clippy, and
  broad workspace tests.
- Non-goals: no repository pattern, generic Record abstraction, schema change,
  or merging of intentionally distinct transaction orchestration.

### RP-15: Replace delimiter scanning with quote-aware HTML parsing

- Findings: `AUD-012`.
- Outcome: valid quoted delimiters survive generated HTML sanitization and
  projection without weakening the existing tag, attribute, or URL allowlist.
- Targets: core generation response/projection HTML modules and focused tests.
- Depends on: `RP-09` because both change generated-output handling.
- Review depth: detailed because sanitization is a security and data-integrity
  boundary.
- Validation: quoted delimiter, malformed/nested tag, multibyte, URL-scheme,
  event-attribute, managed-image, projection, and property/fuzz-style cases;
  broad core tests afterward.
- Non-goals: no broader HTML feature support and no frontend-only trust shift.

## Traceability Check

All actionable ledger findings are planned exactly once:

| Finding | Slice |
| --- | --- |
| `AUD-001` | `RP-04` |
| `AUD-002` | `RP-06A` |
| `AUD-003` | `RP-06B` |
| `AUD-004` | `RP-05` |
| `AUD-005` | `RP-10` |
| `AUD-006` | `RP-07` |
| `AUD-007` | `RP-08` |
| `AUD-008` | `RP-01` |
| `AUD-009`, `AUD-010` | `RP-09` |
| `AUD-011` | `RP-14` |
| `AUD-012` | `RP-15` |
| `AUD-013` | `RP-11` |
| `AUD-014` | `RP-02` |
| `AUD-015` | `RP-13` |
| `AUD-016` | `RP-12` |
| `AUD-017` | `RP-03` |

Refuted findings `AUD-R01` through `AUD-R05` are intentionally excluded from
implementation. Reopen them only if their ledger falsifiers become true.

## Completion Gate For A Future Implementation Session

- Every implemented slice passes its focused behavioral or preservation checks.
- `bun run verify:fast` passes between slices.
- Boundary, persistence, release, package, security, and completed-wave changes
  run `bun run verify` plus any platform/package checks named above.
- No new lint, size, audit, security, or compatibility exception is introduced
  without a narrow rationale and review trigger.
- The final implementation session receives an independent detailed review and
  explicitly closes only after broad validation passes.
