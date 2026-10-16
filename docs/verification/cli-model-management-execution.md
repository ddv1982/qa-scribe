# CLI model management execution

The operator authorized implementation of the model-management plan and publication of a new release after success on 2026-10-16.
The baseline is protected main `ac96962daf935f2e5ba187a81dc1c8fd52331626`, released as v0.8.9.
The original checkout remains on its existing branch with its unrelated local edits untouched.
M01 remains frozen in `/tmp/qa-scribe-model-management`. M04 is committed in `/tmp/qa-scribe-model-evidence`.
Parent-managed integration checkouts retain the M02 and M03 branches separately.

## Execution contract

Follow the four planned phases, then prepare the next stable release through `docs/releasing.md`.
The parent owns commits, pushes, PR registration, integration, protected merges, and release verification.
Use independent design candidates before the evidence migration and picker ownership changes.
Use literal red regressions before M01 fixes and real native app proof before accepting interaction changes.
Keep requested selection, neutral default observation, and provider-reported evidence separate.

The later implementation-and-release instruction supplies execution, merge, and publication authority.
The planning document's earlier statement that execution is not authorized is historical.
The parent interprets the standing autonomy instruction and the explicit continuation through release as superseding the proposed human interaction checkpoints.
The parent substitutes reviewable native screenshots and video plus independent visual and shipping review.
This is an autonomous workflow decision, not evidence that a human review occurred.
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
| M01 | Merged PR47 | Exact independent verdict, protected CI and merge `64e2a8fe78df24bbfa923f06585101898ca36c33` |
| M02 | Merged PR48 | Exact independent verdict, protected CI and merge `f0d3f4b314d3773abbd4481eb31487a025433fbe` |
| M03 | Merged PR49 | Independent final verdict, protected CI run `38964642310`, merge `ddd4099d034012d2a3c42508d29f67b93a3eb806` |
| M04 | Revised harness verification in progress | PR50 production source `786a424`; prior independent head `cbb7b0a` passed. Hosted integration found fixture ordering; corrected patch needs fresh independent and protected checks |
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
The subsequent exact-commit independent native shipping review is recorded below.

## M03 provenance-label review correction

Independent shipping review passed at `64d4786994f13b13c0f3785ccc3771daf9f8e850` with ten candidate scenarios, an actual restart, ten baseline scenarios and popup bounds at both requested sizes.
A subsequent PR49 finding identified that Claude initialization and Codex thread configuration shared one broad display label.
The correction labels the three typed sources separately as Initialization metadata, Response metadata and Thread configuration.
It preserves unknown and legacy evidence and makes no serving-backend claim.
Two source-label regressions failed before the correction. All 83 rendered history and permission tests then passed, including live historical DOM assertions after the next preference changes.
The narrow independent source re-review passed. Receipts are under `/tmp/qa-models/M03/review-label-fix/`.
The parent retained the earlier native and timing revisions, then verified a fresh executable for this display correction.
The final independent r2 verdict below binds that executable to the corrected source.

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
Codex CLI 0.163.0 completed Default and a catalog-selected explicit model, with unknown reported model and persisted reopen proof.
Three prior explicit-selection attempts stopped in the harness before invocation. The first two read fast presets; the third raced Session hydration.
The final corrected run passed both paths, as recorded below.
Copilot catalog discovery was classified `PolicyDenied`; the underlying cause remains unidentified. No credentials or external CLI configuration were changed.

## M04 final local evidence

The broad gate passed with 572 frontend tests and 566 Rust workspace tests, with three optional tests ignored.
The 27 runner and fixture tests passed. The authenticated online Zizmor audit reported no findings and 33 suppressions.
This patch added no suppression directive; the baseline suppression count was not independently measured.
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

## Decision-trail review response

An independent read-only review requested `claude-sonnet-5-5` through the Claude provider. Serving-model identity is unverified.
Its report is `/tmp/qa-models/M04/trail-review-r1.md`. It returned PASS+NOTES with authority, release-rule and workflow-evidence objections to close before merge.
The reviewer did not build, test, mutate the host or attest real-provider behavior.
The parent accepts the documentation and provenance gaps and records the responses here.

The current user-supplied AGENTS instruction says, verbatim, "YOU ARE AN AUTONOMOUS CODING AGENT. EXECUTE TASKS TO COMPLETION WITHOUT ASKING FOR PERMISSION."
The handoff also says, "Continue the authorized CLI model-management implementation through release in Poteto mode."
The original release instruction says, "Once we are fully successful then we can push a new release with a new tag at the end following the existing release process."
These instructions supply the authority to continue through independent visual review, protected integration and publication without another approval request.
Their original precise message timestamps are not available in this workspace handoff. The TSV timestamp records when the parent logged this reconciliation.
No human review or approval is inferred.

The parent interprets release success, consistently with the plan's diagnostic fallback, as passing deterministic implementation gates, an independent passing verdict for each unchanged patch, no unresolved blocking source finding, and fresh protected CI at each actual integration head.
The release PR must pass `docs/releasing.md`, then the actual release workflow must publish and verify its signed assets and APT metadata.
The external account and platform matrix governs catalog promotion. It stays open and does not authorize promotion in this release.
Claude and Copilot therefore retain diagnostics defaults. Their real-provider limits must remain in release evidence.
An uninvestigated application defect blocks release. The failed Copilot app invocation is not shown to be an application defect. Separate catalog and direct checks are consistent with an account or service denial, but do not establish the app-run cause. It remains an unresolved qualification failure, not a passing provider result.

The workflow addition installs `xdotool` only in Linux test/validation jobs so the native suites can exercise actual OS keyboard behavior.
It adds no packaged application dependency. The expanded default native plan took 388334 ms on the local host.
That duration is not hosted-runner evidence or a baseline performance comparison.
Both Linux quality and release validation retain a 30-minute job timeout. M04 hosted CI must pass this expanded plan before integration.
`workflow-lint-r2.json` records the exact actionlint invocations and exit codes. Silent successful lint explains the earlier version-only log.
The authenticated Zizmor command and exit code are recorded in `zizmor-r2.json`; token contents are not retained.
The audit reports 33 suppressions. No suppression directive was added in this patch; the baseline count was not independently measured.

The TSV is append-only. Its `ts` column means record time, which can follow the event or group several related decisions.
It is not a claim that every event happened at that instant. Later rows supersede stale queue or pending-state observations.
The M03 r1 verdict, label correction, visual-review amendment, M04 scope and workflow decisions are reconstructed explicitly in new rows.
Source tree identity also confirms that the reviewed M01 and M02 trees equal their merged trees and that M03 `3ff3622` equals integrated `80f05de`.

Authenticated checks used the already-authenticated local CLI account. Account identities and credentials are not recorded.
Claude completed two real turns. Codex completed five real turns, including four Default invocations repeated while correcting the harness and one explicit invocation.
Copilot made one app-owned failed Default attempt and one separate failed direct diagnostic invocation.
Provider-owned history and usage side effects follow normal CLI behavior. The parent did not delete provider-owned history or infer billing totals.
The app's disposable data and owned process groups were cleaned up.
The parent tool invocations name the immutable executable. Its retained hash and creation time corroborate that association.
No per-run before/after hash receipt was captured; the later binding sidecar is retrospective.
Original per-run harness hashes were not captured for the earliest attempts and cannot be reconstructed faithfully. This limit is explicit in the binding sidecar.
Current harness hashes describe the retained final artifact, not an invented historical revision.
The shared local dependency tree uses the same frontend lockfile; installed versions are recorded separately. Clean hosted installs remain required.

The auth-first trade-off preserves a bounded auth observation before potentially slow catalog work.
An auth timeout can still yield the existing auth-required state and reduce the remaining catalog budget. Per-command slices remain four seconds within the shared 12-second deadline.
This patch does not introduce an auth-unknown state or widen timeouts. The direct unit regression and real native stalled-catalog lane cover the defect being fixed.
The resource comparisons cover unchanged program-wide lifecycle limits and do not substitute for that regression.

The small frontend `catalogSelectorEnabled` predicate centralizes the existing Codex exemption across UI consumers.
Rendered tests and native disabled/diagnostic modes check that backend catalog choices and frontend authority agree.
A new backend per-provider rollout DTO would widen this qualification fix and is not required for the current stable rule.
The native runner deliberately fails closed against a fixed spec-to-receipt contract, including expected lane counts.
Its model specs are permanent regression suites despite their original phase identifiers. A generic orchestration registry is deferred until another suite needs that abstraction.

## Release review corrections

The second decision-trail review returned PASS+NOTES with no hard integration blocker.
Its residual documentation corrections are incorporated here before publication.
The parent interpretation replaces the proposed program interaction checkpoint and the M01, M03 and M04 operator-preview stops.
Native screenshots, 30-to-60-second media and independent shipping/visual review supply the substitute assertions.
Those original human-review boxes remain unfulfilled as written. No human review is claimed.

The apparent lint discrepancy is reproduced and reconciled in `/tmp/qa-models/M04/lint-reconciliation.json`.
Raw and committed workflow hashes match. Raw actionlint1.7.12 rejects the existing `$/` local-action syntax.
The repository's documented compatibility view changes only those references to `./` on stdin, and both normalized workflows pass.
The workflow files remain unchanged. This is the existing rule in `docs/ci.md`, not a newly invented lint exception.

If a hosted native key or display test fails, first inspect that exact failure and classify the cause.
Only demonstrated infrastructure failure permits one fresh build of the same head. Do not retry a job against a stale snapshot.
A repeated failure blocks integration or publication until fixed and verified. The policy does not authorize retries for code defects.

The Copilot app attempt reached a failed native job and a typed failed row. Its raw error category was not captured.
A separate direct invocation matched the bounded access-denial classifier, which includes the substring `403`.
That result supports a possible access failure but cannot prove the app invocation's cause. Raw provider output was discarded.
Copilot Auto and explicit completion, the signed-in picker matrix, and Claude's external authorization and billing gates remain open.

## First hosted M04 integration failure

Protected CI run `38967689175` failed at integration head `f156677ed885e2c50033a83d57b32a9f0c71df7d`.
Linux unit, type, lint and build checks passed. The model-evidence native lane completed Codex Chat with the expected requested ID and thread-configuration report, but its fixture readiness file was absent.
The fixture published terminal completion before writing that file. The app can terminate a completed child between those operations.
The later restart failure was a consequence of the missing first-run receipt, not separate migration evidence.
This is classified as a fixture ordering defect. No infrastructure retry was requested.
The correction publishes readiness before terminal completion. All 18 fixture tests pass, including five deterministic scheduler-preemption checks.
The normal required script-test command now includes both fixture test files and passes all 180 tests.
A native RED run with the original fixture and a post-terminal pause reproduced the same missing Codex marker and dependent restart failure.
The corrected full native rerun, fresh independent review and fresh protected build remain pending.
The production app executable and source remain unchanged by that fixture correction.

The earlier independent verdict and protected failures remain retained. A fresh independent verdict must describe the revised fixture patch before integration.
The current source and visual evidence continues to distinguish the failed Copilot app attempt from the separate direct access-denial classifier.

## Second hosted M04 integration failure

Protected CI run `38970818207` passed the corrected model-evidence and restart scenarios.
The unrelated maintained generation-cancellation scenario failed before theme selection, while its actual dirty-navigation guard remained open.
The layout helper checked for that guard once immediately after clicking Settings and could miss its asynchronous appearance or click it before it became actionable.
The correction waits for either the destination or visible save guard, waits for a clickable save action when needed, then confirms the Settings destination.
This is a native harness synchronization defect, not a demonstrated application regression or an infrastructure retry.
The original cloud screenshot and log remain under `/tmp/qa-models/M04/ci-failure-38970818207/`.
A fresh focused native run, independent review and protected CI remain required for the corrected patch.

The corrected focused generation-cancellation invocation passed without skipped tests.
Its actual navigation trace recorded a save guard in light mode and direct Settings navigation in dark mode, both reaching the destination.
The scenario also completed the generation, edit, reopen and cancellation checks.
The passing receipt and verified runtime source-copy hashes are under `/tmp/qa-models/M04/ci-navigation-fix/green-focused/`.
An old-helper local baseline passed, so the hosted asynchronous failure is not claimed as locally reproduced.
The 180 required script tests, frontend checks, syntax, plan and file-size checks pass. The helper remains within the 500-line policy at 498 lines.
