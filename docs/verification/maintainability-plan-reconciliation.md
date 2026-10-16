# Maintainability plan reconciliation

## Record authority and current status

The operator requested implementation and a new release after success on 2026-10-16.
The parent treats that request as authority to prepare and merge verified PRs through protected main, then follow the existing release process.
No operator screenshot or video approval is claimed.
Independent review, real native workflows, and protected CI replace the proposed manual merge-ready checkpoint for this run.
This is an explicit execution decision under the operator's autonomy grant, not a transcript of a visual approval.

All six implementation slices are reviewed and merged through protected main. Release preparation is underway; publication remains pending.
The original planning checklist remains historical. This record assigns the operative status and evidence to its blocks.

## Reconcile the program controls

| Proposal block | Status | Actual method and evidence |
| --- | --- | --- |
| Arm the program | Done with scoped exclusions | The operator gave the execution request. No recurring program, goal, or heartbeat was created because this is one bounded implementation and release task. |
| Spawn owners | Done | Separate backend and frontend worktrees. Parent integration and publication. Models inherited unless a separately recorded cross-family review was requested by the skill. |
| PR mechanics | Done | Exact-path staging, focused commits, source and comment audits, local checks, ready PRs, and T3 registration. No force push or protection bypass. |
| Verdict and merge | Done | All six slices passed hosted checks at their actual heads and merged through protected main. Stable patch comparisons retained independent verdicts after forward merges. |
| Boot recipe | Substituted procedure | Use the repository's isolated WebdriverIO and embedded Tauri driver. Run supported workflow suites with disposable app-data roots instead of a fleet of sixty separately driven desktops. |
| Operator screenshots and video | Substituted checkpoint | No interaction redesign was introduced. Independent audits and concrete runtime receipts replace the proposed visual sign-off. The operator authorized execution through release. Native screenshots and persistence receipts remain inspectable. |
| PR merge method | Repository method | Retain merge commits, as the repository's previous release did. This preserves reviewed stack ancestry and permits forward merges without force-pushing shared branches. |
| Close the program | Pending | All implementation merges are complete. The version-bump PR, successful actual Release run, non-draft release, and expected assets remain required. |

## Reconcile each implementation slice

File lists were candidate boundaries. A listed file that did not require a change was retained rather than changed mechanically.
Synchronization gates remain in the existing process fixtures. Transcript release labels are diagnostic labels, as the corpus README states.

| Slice | Files, build, visible outcome, and unit blocks | Live block | Performance block | Merge |
| --- | --- | --- | --- | --- |
| P01, PR 40 | Done. Shared literal corpus and both readers. Core 34 and subprocess 30 tests before later additions. Negative comparator control passed. | Parent native baseline and later combined native workflows. Hosted Linux, macOS, and package checks passed at the corrected head. | Production sources unchanged. Baseline samples observational. Hosted budgets passed. | Merged as `37ccf8a`. |
| P02, PR 41 | Done. Three provider phase owners, exact event facade. Each provider checkpoint green. Core 35 and subprocess 30 tests. | The first local native run passed eight invocations and hit a test-side preflight-readiness race in one, not reproduced on the baseline. The corrected combined nine-workflow run passed. All hosted checks passed at `e6d1e93`. | Frontend source unchanged. Local samples do not establish a speed change. Hosted budgets passed. | Merged as `e8639ea`. |
| P03, PR 44 | Done. Four typed error categories and unchanged diagnostics. Core 40, Tauri AI 56, and provider 81 tests. | Real subprocess checks and combined native workflow checks passed. All hosted checks passed at `a15b7b8`. | Frontend source unchanged. Cleanup ownership remains separate. Hosted budgets passed. | Merged as `82722c2`. |
| P04, PR 42 | Done. Owned polling, disposal, recapture, and discovery ordering. Thirteen lifecycle cases and all 533 frontend tests passed at its checkpoint. | All nine local built-app invocations passed at `76280a9`. All hosted checks passed at `81f37f4`. | Gzip growth investigated below. Local startup samples observational. Hosted budgets passed. | Merged as `ae58a4c`. |
| P05, PR 43 | Done. Undo and conflict union, operation-specific eligibility. All 538 frontend tests and an independent 43-test audit passed. | Combined native workflows passed. A separate local P05-only native run is not claimed. All hosted checks passed at `95685e4`. | Gzip growth investigated below. Hosted budgets passed. | Merged as `7c22660`. |
| P06, PR 45 | Done. Real persistence before UI, one imported-attachment owner, shared settlement, and four late-edit repairs. Structural suite 541 tests. Combined suite 545. Independent persistence and settlement audits passed. | The final default ten-invocation Linux X11 suite passed, including actual native close. The new close proof passed in hosted Linux CI at `00b3462`, alongside every required check. | Gzip growth investigated below. Real process cleanup and observer disposal have deterministic checks. Hosted budgets passed. | Merged as `ef38240`. |

## Assign timing-sensitive objectives to the boundary that can prove them

The proposed ten live lanes per slice mixed internal ordering with visible UI outcomes.
Those objectives are run as paired checks at their actual boundaries. No screenshot is claimed to prove an internal race.

| Objective from the live blocks | Executed check |
| --- | --- |
| Provider handshake, exact frames, final snapshot, opaque permission ID, once-only choice, foreign identity, and unsupported request | Shared core transcripts, error tests, and actual Python subprocess replay. Native authorization workflows exercise approval, denial, policy denial, cancellation, retry, and attempt-scoped bulk consent. |
| Cancellation before or during queued permission, EOF with descendants, blocked writes, output bounds, watchdog, and successful terminal event with a live server | Existing real subprocess lifecycle, regression, and bulk tests. Native workflows verify resulting cancellation and durable job state. |
| Observer disposal, duplicate capture, retry exhaustion, recapture after completion, stale discovery, and late canonical response | Generation lifecycle controller tests with explicit deferred completions and fake timers. Native Summary recovery exercises the supported application workflow. |
| Summary conflict choice, Chat uncertain commit, canonical identity, retirement, deletion, and recovery intersections | Controller recovery, hydration-race, deletion, and compensation suites. Native Chat submission and Summary recovery verify persisted user workflows. |
| Edit, switch, discard, newer edits during saves, attachments, record persistence before UI, and differing navigation and close policies | Controller settlement and compensation suites plus native Session and evidence workflows. The Linux close proof observes actual dirty-at-close SQLite persistence and operating-system window disappearance. |
| Late Note and Settings edits during final saves | Four rendered-controller regressions, reproduced red then green. Native dirty-Note close is separately proved. The exact artificial late-await interleavings are not claimed as native timing experiments. |

## Record the gzip decision

Exact production measurements are in [the bundle receipt](maintainability-bundle-sizes.json).

| Build | JavaScript gzip bytes | Increase over baseline | Decision |
| --- | ---: | ---: | --- |
| Baseline `881cc7a` | 453003 | 0 | Reference. |
| P04 `76280a9` | 453339 | 336 | Accepted observer lifetime, identity, and recapture protection. |
| P05 `53d718e` | 453478 | 475 | Accepted operation eligibility and recovery transitions. |
| Combined, retained equivalent `ef38240` | 453552 | 549 | Accepted persistence ownership and final-await guards. |

Only the application chunk changes. Vendor, editor, and icon counts match the baseline.
No dependency was added. This satisfies the investigation rule for any positive gzip delta.
Local timings are observational, including runs before the display backend was pinned. No speedup or controlled timing equivalence is claimed.
The named hosted runner's existing 4000 ms cold and 3000 ms warm budgets remain release requirements.

## Keep remaining release gates blocking

PR 45 hosted CI passed at the actual combined head `00b3462`, including native close in the default ten-invocation Linux suite.
All six implementation PRs merged. Protected main at `ef38240` has identical production sources to the locally verified combined candidate `2017ef6`.
Version 0.8.9 is prepared from that protected main using the repository bump script. The release PR still requires its own protected CI and independent audit.
The existing Release workflow creates the tag at its merge commit. Verify publication and expected assets, not just tag existence.
Authenticated CLI smokes remain optional under the repository release process and were not run.

The original local integration candidate was not pushed. Reproduction uses retained protected main `ef38240756d1a3620b2df3f0ddc368b49235a9b6`. Its production paths match that candidate exactly. The verification receipt records those Git tree and blob objects; local-only SHAs in the chronological trail are historical provenance.
