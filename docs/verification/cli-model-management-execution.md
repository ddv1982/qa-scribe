# CLI model management execution

The operator authorized implementation of the model-management plan and publication of a new release after success on 2026-10-16.
The baseline is protected main `ac96962daf935f2e5ba187a81dc1c8fd52331626`, released as v0.8.9.
The original checkout remains on its existing branch with its unrelated local edits untouched.
All implementation runs in `/tmp/qa-scribe-model-management` and owned verification directories.

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
| M02 | Ready to implement | Typed JSON record selected after two designs and independent judgment |
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
