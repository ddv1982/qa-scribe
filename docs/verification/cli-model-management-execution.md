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
| M03 | Verified functionally | Shared Settings ownership, ten native lanes and actual restart pass; matched performance and independent shipping review remain |
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

## M01 policy review correction

A valid PR47 review finding exposed the all-filtered Claude catalog path.
The correction establishes validity from parsed provider rows before applying the declarative allowlist.
Empty and nonmatching allowlists now yield a fresh Default-only catalog. Invalid raw catalogs still use their existing failure path.
The first composed native policy regression failed on the old catalog code, then all ten scenarios passed after the correction.
The red artifact used the preserved M02 executable containing byte-identical M01 catalog source. Its provenance is recorded explicitly.
A fresh M01 executable supplied the green run.
The provider suite passed 88 tests. Updated source and comment reviews passed.
Independent shipping review at `8f085b67dfd24639e7295b6722565305f53bf7d2` passed all ten native scenarios and inspected both settled Default-only screenshots.
The stable full patch ID is `6e7609b29cd3bdd59267b75483baa06403361298`.
The review thread was resolved after pushing the verified correction. No external reply message was posted.
M02 incorporated that ancestor through merge commit `4dce9b302cd3fa96efb51c010f8854394d5f5a08`.

## Build ownership after ancestor integration

M01 native verification now uses a private immutable executable in its owned artifact directory.
M02 and later implementation use the existing shared dependency cache from one active source checkout.
Switching project-crate artifacts between worktrees produced an incompatible local core-library reuse during the first post-integration build.
The parent reset only the three project's crate outputs and rebuilt from the committed M02 source.
No source change or dependency update was used to resolve that build-cache failure.

## M02 independent shipping verdict

The independent isolated reviewer returned PASS+NOTES at `4dce9b302cd3fa96efb51c010f8854394d5f5a08` against M01 `8f085b67dfd24639e7295b6722565305f53bf7d2`.
The stable patch ID is `bb2c795cba0a420ae46f36035748e765b609ab82`.
It verified all 54 Rust source hashes and the fresh executable SHA256 `fcbe25e19ce6184e76aaaff7479df5c9eb00947f1730f9b72046f5814dc2f97d`.
Its own ten first-run native scenarios and one restart test passed without skips.
It inspected twelve screenshots, literal child arguments, and eleven SQLite rows through a read-only connection.
All nine lane Sessions survived a different native application process. All 62 recorded processes were gone at cleanup.
The fresh post-integration workspace run passed 563 tests with three optional tests ignored and zero failures.
The verdict and complete artifacts are under `/tmp/qa-models/M02/shipping-review/`.
PR48 is linked and remains stacked on PR47 until the protected integration frontier advances.
This proves deterministic Linux behavior. It does not establish real-provider routing or other-platform qualification.

## M03 verification boundaries

The native artifact exercises the ten planned interaction lanes without injecting component state.
The normal navigation guard prevents leaving a dirty Settings view to reach the Chat composer.
Rendered controller tests therefore cover quick-save preservation of an unrelated dirty draft and edits during an outstanding save.
Rendered launch-owner tests cover selection capture across the first asynchronous operation.
Native tests separately connect the visible next-turn choice, actual child arguments, and stored historical evidence.
The startup baseline is retained at `/tmp/qa-models/M03/startup-baseline5/` with its exact M02 executable provenance.
Those five debug-backend startup observations are not a production latency or speedup claim.

## M03 functional verification

The next-invocation picker reuses the existing combobox and Settings controller beside Chat and generation confirmation.
One synchronous guard serializes full and quick Settings writes. Quick saves use confirmed settings and preserve unrelated draft edits.
Send and Generate capture provider, model and effort before their first asynchronous operation.
Pending writes block launches and final close settlement. Active jobs and permission requests keep their original identity.
Chat reads linked AI Runs in one query and uses each historical run's provider and typed evidence.

The first native run exposed a real false-dirty Settings comparison caused by unordered Rust map serialization.
An independent review also reproduced focus restoration reopening the picker after a save.
Both defects have direct red and green regressions. Only provider-map ordering is normalized; missing and explicit-null overrides remain distinct.
The corrected focus restoration leaves the selected label visible and the menu closed.
Native harness corrections select X11 for real OS keys, inspect the actual preflight Model row, and await WebDriver collections correctly.
Those harness failures are retained as failed attempts and are not counted as production regressions.

The final parent run passed ten native scenarios and a second-process restart with all catalogs unavailable.
It proved exact Claude, Codex and Copilot arguments, active permission identity, immutable historical reports, legacy provenance and retained per-provider choices.
The final receipt is `/tmp/qa-models/M03/r4/lane-results.json` with both completion and native restart true.
The 45-second native walkthrough is `/tmp/qa-models/M03/r3/review/demo.mp4`. It shows the same frozen production UI; the subsequent collection correction affects only test code.
The parent inspected positive screenshots and video frames. No human visual approval is claimed.

The full Rust workspace passed 564 tests with three optional tests ignored. The final frontend suite passed 563 tests.
Frontend checks, clippy, bindings and code-size policy passed. Independent source re-review returned PASS+NOTES after the two fixes.
The source receipt and review hashes are under `/tmp/qa-models/M03/`.
Production JavaScript and CSS total 465436 gzip bytes using the same level-9, fixed-time method as baseline, an increase of 1791 bytes.
The strengthened restart proof reads the initial quick selection before any Settings write and then changes only the provider.
It verifies the entire saved model map stays unchanged while each restored choice is displayed.
The restart setup opens an existing persisted Session, avoiding an unrelated duplicate-title autosave race in repeated test runs.
All 26 fixture and runner tests pass.

Five alternating baseline/candidate pairs exercised the same copied large database, X11 backend and debug-native build mode.
Each side completed five fresh-process startup observations and 100 picker observations.
All explicit refreshes started exactly one catalog transaction per provider; warm picker interaction started zero provider processes.
The observed startup and picker medians remained within the proposed larger-of-10-percent-or-50-ms bounds.
These observations are inconclusive for production latency. They use warm OS caches and an animation-frame DOM observation rather than physical paint.
Raw samples, machine load, executable hashes and the comparison script are under `/tmp/qa-models/M03/performance/` and `/tmp/qa-models/M03/compare-native.py`.
The measured source commit is retained as `5a2b4a00ee124ecc37e3a0c50c508ac12b73b480`.
An exact-commit independent native shipping review remains before landing.

## M03 provenance-label review correction

Independent shipping review passed at `64d4786994f13b13c0f3785ccc3771daf9f8e850` with ten candidate scenarios, an actual restart, ten baseline scenarios and popup bounds at both requested sizes.
A subsequent PR49 finding identified that Claude initialization and Codex thread configuration shared one broad display label.
The correction labels the three typed sources separately as Initialization metadata, Response metadata and Thread configuration.
It preserves unknown and legacy evidence and makes no serving-backend claim.
Two source-label regressions failed before the correction. All 83 rendered history and permission tests then passed, including live historical DOM assertions after the next preference changes.
The narrow independent source re-review passed. Receipts are under `/tmp/qa-models/M03/review-label-fix/`.
The parent retains the earlier native and timing revisions and will verify a fresh executable for this display correction before landing.

## Forge and integration

Origin is unavailable in this environment, so the parent uses GitHub CLI for host operations.
The existing repository merges retain stack ancestry. Preserve that history when landing this linear program and revalidate each resulting base-to-head patch.
Protected CI at each actual head remains required. Local or independent verification does not replace it.

## Protected integration and final M03 review

PR47 merged at `64e2a8fe78df24bbfa923f06585101898ca36c33` after protected CI and independent verification.
PR48 merged at `f0d3f4b314d3773abbd4481eb31487a025433fbe` after protected CI run `38961202384` passed on `1b819c129dbf30fde1b1e4fcb71f48853fa336ee`.
Its stable base-to-head patch remained `bb2c795cba0a420ae46f36035748e765b609ab82`.
No review threads remained at the final readiness read.

The final M03 independent review passed at `3ff36227295bfb6eef5b417e713452b0899f713f`.
All 31 source hashes matched. Candidate ten scenarios and restart, baseline ten scenarios, four geometry checks, Codex thread-source proof and 102 frontend tests passed.
The first restart read helper timed out. A direct read matched the stored rows, and an unchanged sequential retry passed. The cause remains unproven.
The report preserves that failed attempt under `/tmp/qa-models/M03/shipping-review-r2/`.
The parent merged current main into M03 without content changes and pushed `80f05defc2245063f004052c8b90cda0659a19b3`.
The stable patch remains `dfc56ee6465fc73bfb4eda26f18fb4f63624df5d`. Fresh protected CI is pending.

## M04 native qualification

The first expanded native run passed 17 of 18 invocations and exposed a false Codex sign-in warning.
Catalog discovery consumed the shared deadline before the auth probe ran.
Moving the existing auth check before catalog discovery preserves the same 12-second transaction bound and command limits.
A direct regression failed before the fix. Signed-out behavior and catalog timeout evidence remain distinct.
The focused provider suite passed 90 tests with two optional account tests ignored.

The final parent Linux run passed all 18 default invocations, with complete machine receipts and no skipped tests.
The model evidence and selection suites each include a second-process restart.
Disabled, diagnostics and selector qualification cover policy updates, CODEX_HOME metadata changes and executable replacement.
Receipts are under `/tmp/qa-models/M04/final/`.
The immutable E2E binary is `/tmp/qa-models/M04/candidate-binary`, SHA256 `6141a2d31feee03e061a38360bd3ed5c66a2dd8527dbb5559042c4b99091da00`.
The default Linux suite now includes these model tests. Other platforms retain their existing invocation plan until equivalent native coverage is qualified.

Five alternating baseline and candidate pairs passed all 40 resource-bound invocations.
They check probe lifecycle, expired deadlines, snapshot reuse and oversized output rejection.
The baseline source tree matches released main `ac96962daf935f2e5ba187a81dc1c8fd52331626`.
The receipt is `/tmp/qa-models/M04/resource-bounds/receipt.json`. This is bounded-resource evidence, not a latency improvement claim.

Authenticated checks are optional and retain unsuccessful attempts separately.
Claude Code 2.1.301 completed Default and explicit `sonnet` generation through real app controls.
Actual model arguments, typed requested and reported metadata, persisted rows and Session reopen all matched.
Codex CLI 0.163.0 completed Default, with explicit unknown reported model and persisted reopen proof.
Two explicit-selection attempts stopped in the harness before launching a provider. They do not establish a provider execution failure.
The latest diagnosis identifies the harness reading fast preset status after the frontend accepted a deep catalog refresh.
The correction must read the visible choices before another optional explicit-model attempt.
Copilot catalog discovery remains PolicyDenied. No credentials or external CLI configuration were changed.

## M04 final local evidence

The broad gate passed with 572 frontend tests and 566 Rust workspace tests, with three optional tests ignored.
The 27 runner and fixture tests passed. The authenticated online Zizmor audit reported no findings.
The optimized Linux size comparison uses identical version, lockfile, compiler and default production features.
The executable grows by 0.788 percent. Frontend production gzip grows by 1889 bytes. Both remain below the proposed review thresholds.
No build-time or production latency improvement is claimed.

The corrected optional Codex harness completed both Default and the catalog-selected explicit `gpt-6.1-sol`.
The exact successful receipt is `/tmp/qa-models/M04/authenticated-generation/evidence-1792183839478.json`.
The third prior attempt had already saved the explicit choice, but raced new Session hydration before invocation.
The final harness waits for the newly created ID, selected Session and matching title before editing its empty Note.
Every completed request matches actual child arguments, persisted typed evidence and Session reopen.
A Copilot setup attempt stopped before opening the app because its version line ends with a period.
The bounded parser now accepts only that observed Copilot version-line grammar. Actual optional generation remains pending.

The native diagnostics video is 45 seconds with exact candidate hash and inspected positive frames.
Artifacts and cleanup evidence are under `/tmp/qa-models/M04/review/`.
The independent comment audit accepted eight narration deletions in the disposable harness and confirmed no residual flags.
Production comments and suppressions did not change. The independent source reviewer did not author the implementation.

## Copilot authenticated limit

Copilot 1.0.69 completed Settings selection and reached an actual Default invocation without a model override.
The native job and typed AI Run both failed. The smoke stopped before Auto and explicit requests, preserving the unsuccessful receipt.
A separate bounded direct invocation with synthetic input also failed with an access-denial pattern.
No argument, auth, model-unavailable, network or usage pattern was established, and raw provider output was discarded.
The available evidence does not identify the underlying account or service cause.
Receipts are `/tmp/qa-models/M04/authenticated-generation/evidence-1792183914358.json` and `/tmp/qa-models/M04/live/copilot-failure-category.json`.
No credentials, external CLI configuration or installed provider were changed to make this optional smoke pass.
Claude and Codex authenticated paths passed. Copilot remains a recorded external qualification limit while deterministic arguments, failures and persistence are covered by fixtures.
