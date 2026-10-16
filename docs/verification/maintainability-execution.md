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

### P02 gives providers their own legal phases

Claude, Codex, and Copilot now own handshake phases and provider-specific identities. Shared output and permission authority retain one owner behind the existing public facade.
Each provider migration passed the complete core protocol suite before the next began.
The final focused runs passed 35 core protocol tests and 30 real subprocess tests. An additional replay covers Codex completion before its turn-start response.
Independent comparison against P01 found no behavior differences or blocking findings. The comment audit found no introduced suppressions or narration.
Core clippy, formatting, whitespace, and code-size checks passed. The public event and error contracts remain unchanged.
A suspected Copilot metadata cleanup gap on a missing denial payload is unreachable through current callers. Every provider supplies a denial reply, so no speculative cleanup path was added.

### Preserve the reasons for write compensation

History review traced overlapping-write and imported-image safeguards to `c88736a` and the v0.7.21 changelog.
The repository remediation rules require local capability ordering, stale-write protection, and authored-data preservation.
Construction bridges have no identified product requirement. Their replacement must retain one stable compensation owner and the current retry behavior.
The history evidence supports preserving backend compensation rather than merely suppressing a stale frontend response.

### P03 classifies failures without changing IPC

Core protocol operations now return four explicitly selected error variants. Display preserves the existing messages, and the Tauri executor converts them at the existing String boundary.
The new checks cover each category, sticky failure, incomplete output, and a rejected local approval followed by a successful denial.
Focused results passed 40 core protocol tests, 56 Tauri AI tests, and 81 provider tests. Three existing authenticated tests remained ignored.
Core and Tauri clippy, format, whitespace, and code-size checks passed.
An independent source audit and an independent 40-test protocol run passed. No process cleanup consolidation or catalog transport change was made.

### P04 native and P05 frontend checkpoints

P04 at `76280a9` passed all nine built-app workflow invocations, production frontend checks, `verify:fast`, and three observational startup samples.
P05 at `53d718e` passed all 538 frontend tests and frontend checks. Its independent audit passed 43 focused tests and typecheck.
The recovery union preserves the unselected conflict choice. Eligibility reads current owners within deferred operation closures.
The parent rejected an eager stable-capability factory read and kept the existing closure-only construction pattern.

### Hosted macOS replay correction

The first P01 macOS test run failed because Python reported `/private/var` while Rust sent `/var` for the same temporary directory.
The failure was in fixture substitution, not provider transport behavior.
A focused test-only correction requires filesystem identity for variable working-directory aliases and retains exact checks for all other fields.
The correction includes a real symlink regression and rejects distinct directories and changed model values. Its final hosted result is recorded after publication.
