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
Build artifacts initially shared the existing Cargo cache. After that cache disappeared, this run moved to a private task cache. Native builds and measurements run serially so another build cannot replace the app under test.
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
The correction includes a real symlink regression and rejects distinct directories and changed model values. The reconciliation table records its final hosted result and merge commit.

### P06 removes construction bridges and shares settlement

The record persistence and imported-attachment owners exist before Session lifecycle and Record UI construction.
One coordination instance retains request intents and backend compensation. One owner-keyed import ledger replaces the former Note and Record maps.
Navigation and native close use the same persistence projection. View navigation still permits dirty Note text, while close persists that text before destruction.
Independent extraction review found the persistence and canonicalization algorithms unchanged. Its focused run passed 65 tests.
The structural change passed all 541 frontend tests. Layout-time tests prove that persistence returns the real backend outcome before Session and Record UI exist.

### Preserve edits arriving during the final close saves

Settlement review reproduced an inherited gap after the final Session checkpoint.
Both final Settings and Chat awaits could admit a Note edit before returning success. The parent reproduced both failing controller cases before applying the fix.
The fix rechecks Session, Record, attachment, compensation, and Chat state after those awaits.
The same review then reproduced two Settings-edit races. A checkpoint over the existing Settings draft version now captures before the first await and rejects success if that version changes.
Late Note edits save in another pass. Late Settings edits leave the window open, and an explicit retry persists the exact newer draft before destruction.
All four controller regressions pass in parent and independent runs. The owner passed 101 focused tests.
These races were reproduced through the rendered controller and native-window adapter mock. They are distinct from the built-application workflow evidence.

### Verify the complete candidate

The original combined candidate was a local integration commit. Its retained production-equivalent revision is protected main `ef38240756d1a3620b2df3f0ddc368b49235a9b6`; use that revision for reproduction.
The first combined verification stopped because the shared build cache disappeared. No application check failure was inferred from that environment error.
The task moved its build artifacts to a private cache and reran the complete `bun run verify` successfully.
The complete run passed 545 frontend tests and 538 Rust tests. Three existing authenticated tests remained ignored.
Audits, lint, type checks, contrast, bindings, command permissions, format, clippy, release scripts, production isolation, builds, and the smoke application passed.
The final built-app workflows, hosted checks, and publication outcome are recorded after completion.

### Keep verification claims scoped

The native suites run the supported repository workflows. Deterministic protocol and controller checks establish internal ordering and race behavior.
Screenshots establish visible outcomes. They do not establish internal wire ordering or the timing of a React effect.
Local startup samples are observational. The hosted runner's existing cold and warm budgets remain required checks.
Authenticated providers were not launched by this implementation task. The release process treats those smokes as optional.
All original local plan edits remain untouched in the original checkout.

### Exercise the real native close boundary

A Linux-only native workflow sends a native X11 WM_DELETE_WINDOW close-request event to the isolated test window. It does not use WebDriver close, which destroys the window directly.
The test proves the Note was not yet persisted immediately before close, then observes the exact new HTML in read-only SQLite and the disappearance of the X11 window. It separately confirms that the embedded driver has stopped.
Only after those assertions does the test acknowledge that driver session teardown is already complete.
Both owner and parent runs passed with complete machine execution evidence. An independent audit also passed the 14 runner tests and inspected both receipts.
The helper requires an xvfb-run authority file. The native-close invocation pins GTK to X11. Production window permissions and dependencies are unchanged.
Initial experiments exposed the development window title, inherited Wayland routing, and embedded-driver teardown after real process exit. These test-control corrections did not change application close behavior.

### Account for bundle growth

The baseline production JavaScript totals 453003 gzip bytes. P04 totals 453339, P05 totals 453478, and the combined candidate totals 453552.
The respective increases over baseline are 336, 475, and 549 bytes. Only the application chunk changes. Vendor, editor, and icon chunk byte counts are unchanged.
P04 adds observer lifetime, identity, and retry guards. P05 adds operation eligibility and explicit recovery choices. P06 adds concrete ownership and final-await safety while removing repeated wiring.
The measured growth is accepted for those protections. No dependency was added and no timing improvement is claimed. Exact files and counts are in `maintainability-bundle-sizes.json`.

### Report review independence accurately

The phase design and code audits used independent agents inheriting gpt-6.1-sol. They were not different-family reviews.
The final additional review used the T3-selected claude-sonnet-5-5 model. Its code verdict passed and its evidence-record findings prompted the native-close workflow and reconciliation record.
The model name is the provider and model reported by orchestration. The reviewer did not independently attest the serving backend.

### Complete the local native gate

The final default Linux suite passed all ten invocations on an explicitly isolated X11 display. This includes the new native X11 close-request workflow.
Three X11 startup samples and the production-isolation check passed. The startup values remain observational.
All 155 release-script tests passed after runner registration. The test-only additions do not change production sources relative to `2017ef6`.
The structured local receipts are `maintainability-verification-receipt.json` and `maintainability-native-close.json`.
All six implementation PRs passed protected per-head CI and merged. Publication remains pending the version-bump PR and actual Release workflow.

### Resolve the final evidence review

The second additional review passed the corrections. Its remaining requests clarified logging timestamps, the P02 branch head, the test-side readiness race, and the native-close landing gate. PR 45 already carries the native-close commits. The combined-tree merge commits remain local verification ancestry.
Decision timestamps record when an entry was logged. Evidence and prose identify earlier events separately. Additional P04, P05, macOS alias, readiness, and ten-workflow rows were recorded after the reviewer read its snapshot.

The final test-only hardening removes a constant receipt field and stops polling at the first observed X11 window disappearance. It then checks SQLite once. Independent audit, owner native run, parent native run, and 14 runner tests passed. The 25 ms polling interval establishes persistence at that observation, without instrumenting exact commit/destruction ordering.

### Prepare the protected release

PR 45 passed all hosted checks at `00b3462`, including the native-close workflow in the Linux job. It merged as `ef38240`. Protected main production sources match `2017ef6` exactly. The release branch starts at that main commit and uses `bun run bump 0.8.9`. Its initial TODO check failed as documented, then the changelog was filled with real release notes. Publication is not yet claimed.
