# Maintainability execution record

## Scope and success criteria

Implement P01 through P06 from the approved maintainability plan.
Preserve CLI wire messages, permission authority, persisted Notes, Evidence ownership, recovery choices, navigation policy, and native close behavior.
Success requires focused behavior checks for each slice, independent diff audits, the repository verification gate, built Tauri workflows, production isolation, hosted CI, and the existing release workflow.
Authenticated provider smoke remains optional under `docs/releasing.md`.
The user authorized implementation and a final release after success on 2026-10-16.
The release workflow creates the tag at the authorized version-bump merge. Do not manually tag a later branch tip.

## Isolate the work

The original checkout remains on `work/testware-parity-v0.8.8` with its existing document edits.
Implementation starts from `origin/main` at `881cc7ad1e4523c351c9763cdb25bcef418f50bf`.
The backend and frontend owners use separate worktrees. The parent owns integration, commits, PR publication, and release metadata.
Build artifacts share the existing Cargo cache. Native builds and measurements run serially so a second build cannot replace the app under test.
The six plan slices remain independently reviewable. Release preparation follows implementation and its required checks.

## Select the state and ownership shapes

Two independent read-only sketches and a third read-only judge compared the design before application edits.
All inherited the parent model. This is independent review, not a different-family model comparison.

Choose provider-owned phases and identity data under the existing `ChatProtocol` facade.
Keep one owner for permission FIFO, text, reported model, and terminal authority.
Retain early Codex identity notifications and Copilot early metadata.
Use shared synthetic transcript data with small Rust and Python readers. Assert the full normalized public event sequence in core and exact client frames in the process test.
Use the existing process fixtures for cancellation, blocked pipes, descendants, and real synchronization gates.

Keep the unselected Summary recovery choice distinct from authored and generated choices.
Read eligibility from current authoritative owners for ambient writes, recovery writes, hydration, and generated adoption.
Summary conflict and Chat uncertain commit remain independent and may overlap.
Expose a narrow settlement contract to navigation and close. Keep serialization, write versions, compensation, and quiescence inside persistence owners.
Remove construction cycles through persistence ownership before changing UI construction order.
Do not add a second attachment ledger or a second record coordination instance.
Do not change `useStableCapability` timing without a failing behavior characterization.

## Sequence the checks

Capture baseline built-app workflows and production frontend output before modifying application code.
Record old behavior in P01 replay and frontend lifetime characterization.
Verify each provider migration separately before the next.
Keep polling, recovery representation, and write settlement as separate frontend slices.
Run focused checks before integration. Run full repository and built-app gates before publication.
Keep every verification receipt associated with its actual revision.
A screenshot proves visible output. Wire order and internal timing require the paired deterministic receipts.

## Record results

Append phase results, PR URLs, exact revisions, native receipts, limitations, and release evidence below as they become available.
The decision trail is `docs/verification/maintainability-decisions.tsv`.

### P01 establishes replay before protocol migration

Added nine synthetic transcripts. Three run through both the core parser and the existing real subprocess peer. Six capture malformed input, foreign identities, unsupported requests, and sticky failure.
The negative control changes a permission option and must fail at the named decision.
Independent protocol and comment audits passed. The parent inspected the actual readers and corpus.
Focused checks passed 34 core protocol tests and 30 duplex process tests.
The parent ran `bun run verify` successfully. Its frontend suite passed 520 tests. All non-ignored Rust workspace tests passed, together with dependency audits, release script checks, bindings, format, clippy, build, production isolation, and the smoke application.
The unchanged baseline native suite passed all nine invocations. P01 changes only tests and fixtures, so its production application code is identical to that baseline.
Three local startup samples are observational. Hosted runner budgets remain the performance release gate.

### P04 catches observer lifetime and recapture defects

Before implementation, five lifetime cases failed while the existing recovery suite passed.
An independent reviewer then reproduced an unresolved guard stranded after status retry exhaustion and an empty active snapshot.
The corrected owner derives retry identities from the existing unresolved Summary map and checks canonical state before releasing protection.
A discovery revision also rejects older concurrent capture results.
The independent lifecycle rerun passed all 13 cases. The reviewer found no remaining defects in this slice.
Full frontend and native candidate results are recorded after integration.
