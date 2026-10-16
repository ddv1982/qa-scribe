# CLI model management execution

The operator authorized implementation of the model-management plan and publication of a new release after success on 2026-10-16.
The baseline is protected main `ac96962daf935f2e5ba187a81dc1c8fd52331626`, released as v0.8.9.
The original checkout remains on its existing branch with its unrelated local edits untouched.
M01 remains frozen in `/tmp/qa-scribe-model-management`. M02 runs in `/tmp/qa-scribe-model-evidence` and owned verification directories.

## Execution contract

Follow the four planned phases, then prepare the next stable release through `docs/releasing.md`.
The parent owns commits, pushes, PR registration, integration, protected merges, and release verification.
Use independent design candidates before the evidence migration and picker ownership changes.
Use literal red regressions before M01 fixes and real native app proof before accepting interaction changes.
Keep requested selection, neutral default observation, and provider-reported evidence separate.

The later implementation-and-release instruction supplies execution, merge, and publication authority.
The planning document's earlier statement that execution is not authorized is historical.
The proposed operator interaction checkpoints are satisfied with reviewable screenshots and video plus independent review under the autonomy instruction.
Do not claim human visual approval. Record each actual review and its exact revision.

Provider catalog promotion has separate existing external gates.
An unavailable account or missing external authorization does not pass a rollout gate.
Retain diagnostic mode for a provider that cannot be qualified and record its limitation in release evidence.
Authenticated smokes remain separate from deterministic CI and do not alter credentials or CLI configuration.

## Throughput checkpoint

- Blocking first steps. Preserve the clean baseline, read release rules, capture red M01 failures, and settle evidence ownership before migration.
- Independent workstreams. Two design candidates read source independently. M01 Rust fixes and the native verification artifact have exclusive file ownership.
- Shared mutable state. One owner writes each module. Rust builds use the existing target cache sequentially. Each native lane uses isolated app data and fixture processes.
- Smallest safe decomposition. Deliver M01, M02, M03, and M04 as ordered reviewable changes. Avoid a provider framework or persistent-session rewrite.

## Queue

| Phase | State | Evidence |
| --- | --- | --- |
| M01 | Verified locally | 10 native scenarios, 547 Rust tests, 18 fixture and runner tests, frontend checks, and independent audits |
| M02 | Verified locally | Typed storage and transport tests, 10 native lanes, and actual native restart |
| M03 | Pending | Shared Settings ownership required |
| M04 | Pending | Provider qualification remains explicit |
| Release | Pending | Starts after verified implementation and protected CI |

## Decisions and limits

The decision trail is `cli-model-management-decisions.tsv` in this directory.
The original investigation and proposed verification lanes remain in the linked plan.
A box is complete only when its actual evidence exists.
Any substitution needs a recorded reason and an equivalent explicit assertion. Missing evidence stays open.

## M01 verification

Red regressions reproduced omitted Copilot Auto arguments, lost Auto settings, generic catalog-denial classification, and a missing Claude Default choice.
The first native run also exposed test selector and refresh synchronization defects. Those defects were corrected in the test artifact.
The final native run executed ten scenarios through the built app and completed with ten passed, zero failed, and zero skipped.
It captured actual Copilot Chat and generation argv for both Auto and Default.
Positive screenshots and literal child journals are under `/tmp/qa-models/M01/r4/`.

The full Rust workspace passed 547 tests. Three existing optional authenticated tests remained ignored.
Frontend type, lint, CSS color, and contrast checks passed. Rust formatting and clippy passed.
The fixture and runner tests passed 18 tests. The command and code-size checks passed.
Two independent source reviews and the comment audit passed. Native shipping review is recorded separately before landing.

Five alternating baseline and candidate pairs passed the existing resource-bound, expired-deadline, output-limit, process cleanup, and cached-snapshot checks.
These 40 checks establish resource invariants, not a measured startup or latency improvement.
The baseline compiled source is production-equivalent to protected release `ac96962`, built from its retained release head `2b9385a`.
Local details are `/tmp/qa-models/M01/resource-bounds.json` and `/tmp/qa-models/M01/rust/receipt.json`.

Installed Copilot 1.0.69 accepted Auto with ACP initialization on Linux. No real prompt, new account, or authentication change was used for that compatibility check.
Older CLI versions, other provider platforms, real routing, and external catalog-promotion gates remain unverified.

## M01 independent shipping verdict

An independent agent drove the same ten scenarios at `bd08f4fa84263d83c51595456c41b85368ca0c85` and returned PASS+NOTES.
The base is `ac96962daf935f2e5ba187a81dc1c8fd52331626` and stable patch ID is `6b693f8d9b91f232a617df2724d301088c5a47cb`.
It matched all ten Rust source hashes, confirmed the candidate binary stayed unchanged, inspected positive screenshots, and found no surviving recorded fixture processes.
The final isolated visual walkthrough is 35 seconds. An earlier interrupted recording did not finalize and is not used as evidence.
Receipts and media are in `/tmp/qa-models/M01/shipping-review/`.
PR47 is linked and watched for hosted CI. No human visual approval is claimed.

## M03 placement decision

Two throwaway variants compared an always-visible next-response picker with a compact summary that reveals it.
The parent inspected both desktop screenshots and selected the visible picker.
It exposes requested intent and scope without another disclosure state or keyboard activation.
The production control will reuse ModelCombobox and show that its preference applies across the app.
The scratch keyboard and narrow-layout observations are in `/tmp/qa-models/M03/prototypes/receipt.json`.
They establish prototype rendering only, not native behavior or persistence.
An upward composer placement is required because a downward list can extend beyond the visible scrollport.
Native verification must check actual popup bounds and keyboard behavior after integration.

## M02 verification

Schema 11 adds one nullable model-selection JSON column. A NULL value retains the exact old model string with Legacy provenance.
New runs record requested intent and optional provider evidence separately. The old public model string and overwrite API are removed.
The parser rejects plaintext impersonation, wrong system subtypes, invalid report IDs, and nested Claude subagent evidence.
Assistant evidence supersedes initialization, and cancellation prevents later frames from replacing the accepted report.
A small executor collection gate keeps parser mutation inside the cancellation barrier and UI callbacks outside it.

The full workspace run passed 561 tests with three existing optional tests ignored.
A later focused storage run passed nine tests, including the added zero-write conflict and legacy guards.
Five transport evidence tests passed, including synchronous job-store cancellation, timeout, and post-cancellation frame rejection.
All 545 frontend tests, frontend checks, bindings, clippy, and code-size checks passed.
Independent storage, runtime, and comment audits passed. Their scope does not claim an authenticated provider run.

The parent drove ten native scenarios with literal SQLite evidence and actual provider-child arguments.
The cancellation scenario retained the first run's report, terminated its process, retried through the visible supported action, and left the cancelled row unchanged.
A second invocation opened the same migrated database in a different native process and preserved all recorded rows.
The physical schema-10 fixture had no evidence column before launch. Native receipts are in `/tmp/qa-models/M02/r3/`.

The initial native attempts exposed fixture assumptions about streaming publication, the eight-item Session rail, and the required Retry action after cancellation.
Only test mechanics changed to follow the actual app contracts.
The initial migration red log failed during fixture setup because a required legacy timestamp was missing. That failure is not counted as migration regression proof.
The fresh-record, plaintext impersonation, wrong subtype, and precedence red failures were meaningful.
The corrected migration and reopen checks passed. `workspace-green.log` supersedes the older failed Tauri log.

Production JavaScript and CSS remain 463645 gzip bytes with the same five files and the same compression method as baseline.
No speedup or latency improvement is claimed. Storage tests prove zero writes for absent or rejected reports and one write for the first accepted report.
History display and its bulk read projection remain M03.
