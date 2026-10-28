# Lust adoption plan

**Status: deferred after research, 2026-10-28.**

The request was to investigate a complete move from rustc to Lust, research
first, implement in phases, and update contributor documentation last. The
[feasibility study](research/lust-compiler-feasibility.md) found blocking
language, dependency, and platform gaps. The user agreed Lust is not ready for
this project. The current deliverable records those findings and prerequisites;
it does not enable Lust or claim a compiler migration.

Each future phase requires the previous gate to pass. Phases 1–4 describe a
possible development-loop adoption with Cargo/rustc retained. A zero-rustc
goal has a separate gate because upstream still uses it for releases.

## Phase 0 — Research and feasibility (complete)

- [x] Use Exa and Ref to inspect upstream documentation before planning.
- [x] Pin the inspected source and identify the latest published release.
- [x] Inspect all workspace manifests, representative source, CI, and releases.
- [x] Identify procedural macro, async, unsafe, dependency, and platform gaps.
- [x] Record the scope and limits of observed evidence.

Gate result: **stop before integration.** No workspace target is immediately
compatible. Replacing Tauri, SQLite, serialization, or the typed bridge to fit
an experimental compiler would be an architectural project, with no proven
benefit for qa-scribe.

## Phase 1 — Reproduce compatibility on Linux (deferred)

Reopen this phase when a supported upstream release plausibly addresses the
identified gaps, or a separately scoped experiment selects a real independent
module. Do not extract or duplicate production logic solely to produce a
passing compiler demo.

- [ ] Select a pinned release/source revision and verify the release asset
  checksum; retain compiler version and capability output.
- [ ] Use Linux x86_64 with the documented glibc and C development prerequisites.
- [ ] Run the unchanged workspace targets individually and retain commands,
  exit statuses, stdout, and stderr. Compare diagnostics with Cargo checks.
- [ ] Classify each reject by root cause. An unsupported dependency is not
  evidence that the remaining source works.

Illustrative commands from the repository root, **not executed in this study**:

```sh
lust --version
lust capabilities --json
LUST_NO_DAEMON=1 lust check crates/qa-scribe-core/src/lib.rs --manifest-path crates/qa-scribe-core/Cargo.toml --lib --locked --json
LUST_NO_DAEMON=1 lust check crates/qa-scribe-app/src/main.rs --manifest-path crates/qa-scribe-app/Cargo.toml --bin qa-scribe-app --locked --json
LUST_NO_DAEMON=1 lust check src-tauri/src/main.rs --manifest-path src-tauri/Cargo.toml --bin qa-scribe-tauri --locked --json
```

Gate: reproducible diagnostics on a supported host and a reviewed solution for
each blocker on the selected target. A failing experiment remains observational
and cannot replace existing checks. Keep generated caches local and out of git
if an experiment is introduced; Lust cache entries can execute code.

## Phase 2 — Support the core dependency boundary (blocked)

- [ ] Establish upstream-supported adapters or another supported integration
  for every dependency in the selected target's resolved graph, including
  serialization, SQLite/native libraries, and image handling.
- [ ] Resolve Serde, Specta, and thiserror procedural macro usage with a
  supported strategy that preserves JSON, errors, and TypeScript contracts.
  Upstream intentionally excludes these macros; waiting for a version bump
  alone is not a solution.
- [ ] Verify Rust and Lust outputs against the same existing core fixtures:
  database migrations, persisted records, attachments, generated content,
  errors, and smoke workflows. Compare data and files, not just exit status.

Gate: the actual core and smoke targets check/build/test with equivalent
behavior. No alternate persistence or serialization implementation without
equivalence evidence. Cargo remains the correctness oracle.

## Phase 3 — Support the desktop and platform boundary (blocked)

- [ ] Establish a supported Tauri integration covering its macros, build
  script, embedded frontend, command permissions, and runtime.
- [ ] Preserve async job behavior and native process-group cleanup through
  supported compiler/runtime facilities.
- [ ] Demonstrate supported builds and runtime parity on Linux x64, macOS
  arm64, and macOS Intel. Upstream currently verifies only Linux x86_64.
- [ ] Run bindings/command checks and built-app workflows for chat, clipboard,
  attachment handling, cancellation, recovery, and startup.

Gate: current desktop contracts and supported platforms pass using the new
development path, with no reduced feature or permission coverage. This gate
depends on substantial upstream work or a separately approved architecture.

## Phase 4 — Measure and promote a development path (blocked)

- [ ] Compare equivalent Cargo and Lust feature/target selections on qa-scribe:
  cold check, warm no-change, body edit, signature edit, rejected edit, build,
  test runtime, and resident memory. Report host, samples, and variance.
- [ ] Verify cold/warm diagnostic agreement and recovery after edits.
- [ ] Add opt-in commands only after a real target works. Add a separate
  observational Linux lane before considering any required gate change.
- [ ] Review installation pins, cache isolation, cleanup, and rollback.
- [ ] Promote only after measured developer benefit and complete parity.

Gate: evidence supports adoption on the project's own workload. Existing
Cargo checks, Clippy, rustfmt, supported-platform validation, and release
packaging remain authoritative until their individual replacement obligations
are met. Rollback removes the opt-in path and uses the existing pinned Rust
workflow; it must require no data conversion.

## Phase 5 — Reassess complete rustc removal (outside current design)

Lust's release command delegates to Cargo/rustc. Neither a successful phase 4
nor renaming a command meets a zero-rustc requirement.

- [ ] Require an upstream-supported independent release backend and a supported
  workspace/dependency integration that no longer needs rustc.
- [ ] Prove equivalent optimized binaries, native libraries, packaging,
  signing/notarization, installer behavior, performance, and every existing
  required validation obligation on all supported platforms.

Gate: an explicitly supported compiler path and observed release parity. There
is no committed upstream delivery date or present implementation path for this
gate. Keep the migration deferred while it is unmet.

## Phase 6 — Documentation and README (complete for deferral)

This is the final change stage of the current investigation.

- [x] Publish the research record and this phased plan with honest status.
- [x] Update the README to link the finding and retain the current Rust stack.
- [x] Clarify the contributor compiler setup and CI ownership of checks.
- [ ] If adoption resumes, update installation, commands, support matrix,
  benchmarks, CI, and rollback instructions after implementation is validated.

Verification for this documentation change covers local links, upstream source
claims, command target paths, and diff hygiene. No application behavior changed;
it does not provide compiler or runtime parity evidence.
