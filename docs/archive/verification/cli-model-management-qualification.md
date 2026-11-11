# CLI model management qualification

Status: implementation, independent native verification and protected integration passed. Release publication is pending.

The implementation separates an app preference, an observed CLI default and a run's provider report.
A catalog entry describes what the CLI returned. It does not independently establish account entitlement or serving-backend identity.
The app saves one preference per provider and passes it to new invocations. It does not edit the external CLI configuration.

## Provider evidence

| Invocation | Accepted report | Scope |
| --- | --- | --- |
| Claude structured generation and Chat | Root initialization or assistant message metadata | Assistant metadata supersedes initialization; later assistant metadata wins |
| Codex Chat | Correlated thread-start configuration | Configuration reported for the new thread |
| Codex generation | None established | Unknown remains explicit |
| Copilot generation and Chat | None established | Unknown remains explicit |
| Records predating schema 11 | Original stored model bytes | Legacy provenance remains unknown |

Plain text, model-shaped prose, unrelated system events and nested Claude subagent events do not establish a report.
Cancellation freezes the accepted report. Settlement records it against the prepared run before completing that run.
Historical Chat evidence comes from its linked AI Runs, independently of the current global preference.

## Discovery and rollout

Codex retains its existing structured catalog path.
Claude and Copilot retain diagnostic mode by default. The selector remains on compatibility choices until their independent external gates pass.
The explicit selector opt-in and disabled kill switch remain available under the existing provider contract.
Custom IDs remain user intent that the CLI validates when invoked.

The installed Linux CLI versions checked on 2026-10-16 were Claude Code 2.1.301, Codex CLI 0.163.0 and GitHub Copilot CLI 1.0.69.
The earlier investigation returned 13 Claude initialization entries and seven visible Codex entries.
Copilot completed protocol-3 initialization and reported local authentication, then denied `models.list` with RPC -32603 and the observed HTTP 403 message grammar.
That response establishes a denied catalog request. It does not identify the underlying account, entitlement, organization or service cause.
Those investigation results are retained under `/tmp/qa-scribe-model-investigation-20261016/`; exact final-candidate contracts are recorded separately below.

Copilot 1.0.69 also accepted ACP initialization with `--model auto`, protocol 1 and no session or prompt.
That compatibility receipt is `/tmp/qa-models/M01/compatibility/copilot-acp-auto-init.json`.

## Cache boundaries

The in-memory discovery fingerprint uses provider and executable identity, relevant configuration-file paths and metadata, auth-mode presence and selected nonsecret scope values.
Metadata invalidation detects the covered path, size and modification-time changes. It cannot attest every account, token or keychain change.
Credential contents and token values are not read for this fingerprint.
The frontend persisted startup snapshot excludes CLI catalogs. Restart begins with fresh catalog discovery state while preserving the independent app preference.

M04 corrects Codex identity-file resolution under `CODEX_HOME` and makes rollout descriptions provider-aware.
The source receipt is `/tmp/qa-models/M04/source-receipt.json`. Direct regressions failed before the corrections and passed afterward.
The final parent native receipt is `/tmp/qa-models/M04/final/latest-run.json`.

## Deterministic qualification

| Area | Acceptance evidence |
| --- | --- |
| Default, Copilot Auto and Claude policy filtering | M01 ten native scenarios and independent shipping review |
| Typed evidence, failure, cancellation and schema-10 migration | M02 ten native scenarios, literal SQLite rows and actual restart |
| Quick selection, active permissions, history, refresh and restored preferences | M03 ten native scenarios and strengthened actual restart |
| Disabled and diagnostic authority | M04 native disabled and diagnostics invocations passed |
| Configuration metadata and executable replacement | M04 selector invocation passed policy, CODEX_HOME and incompatible replacement scenarios |
| Required CI default invocation plan and state isolation | All 18 default Linux invocations passed; 27 runner and fixture tests passed |

M03's final independent receipt is `/tmp/qa-models/M03/shipping-review-r2/verdict.json`.
It passed ten scenarios, restart, baseline comparison, geometry and all three report-source labels.
Its restart test checks the initial selection before any Settings write, then changes only the provider while requiring every saved model choice to remain unchanged.
The source and native checks are deterministic Linux evidence using synthetic provider processes.
They do not establish a live account or a provider's actual model routing.

## External qualification still open

- [ ] Oldest-supported and current CLI coverage across the full platform matrix.
- [ ] Signed-in provider picker comparisons across the required account and policy cases.
- [ ] Claude discovery billing telemetry and the existing written-authorization gate.
- [ ] A resolved Copilot catalog denial in an authorized account environment.
- [x] Exact final-candidate optional authenticated smokes attempted and recorded separately. Claude and Codex completed; Copilot app Default failed without a captured error classification. A separate direct run matched an access-denial pattern. Auto and explicit Copilot completion remain unverified.

These open cells prevent catalog promotion. They do not become green through fixtures or a successful package build.
No credentials, provider installation or CLI configuration workaround is part of this release.

## Release evidence

The parent retains the exact reviewed revisions and independently verifies each PR before landing it.
The release follows `docs/releasing.md` after protected CI succeeds on the intended revisions.
The workflow must create the version tag at the actual release merge and publish the signed assets and APT metadata.
Publication verification remains pending until that workflow finishes.

## Parent checks and measured scope

`bun run verify` passed with 572 frontend tests and 566 Rust workspace tests. Three optional Rust tests remained ignored.
Frontend audit, Rust audit, typecheck, lint, contrast, bindings, release metadata, fmt, clippy, build and the smoke harness passed.
The authenticated online Zizmor 1.30.1 audit reported no findings. The audit reported 33 suppressions. This patch adds no suppression directive; the baseline count was not independently measured.
Five alternating baseline and candidate pairs passed 40 resource-bound checks for process lifecycle, deadlines, cache reuse and oversized output.
The final native app and fixture processes were absent after teardown. Isolated data remains for read-only audit.

Production JavaScript and CSS total 465534 gzip bytes, compared with 463645 at released main.
The increase is 1889 bytes, below the proposed 5 KiB review threshold.
Both sides use level-9 gzip with fixed timestamp and identical dependency versions.
The manifest is `/tmp/qa-models/M04/size/frontend.json`. This size comparison is not a latency claim.
Optimized Linux executable size increased from 21878328 to 22050800 bytes, or 0.788 percent.
After identical `strip --strip-all`, the increase is 112992 bytes, or 0.727 percent.
Both comparisons remain below the proposed 1-percent review threshold.
Both builds use Rust 1.97.0, the same lockfile, default production features and version 0.8.9.
The receipt and immutable outputs are under `/tmp/qa-models/M04/size/`.
Build times are not compared because the baseline populated the shared dependency cache.

The initial expanded native run passed 17 of 18 invocations before the auth-order correction.
Those failed results remain under `/tmp/qa-models/M04/default/` and are not presented as green.
The corrected final run passed every invocation, including the retryable catalog timeout that previously caused a false sign-in warning.
The shared transaction deadline and per-command resource bounds remain unchanged.

## Optional authenticated generation

Claude Code 2.1.301 passed Default and explicit `sonnet` generation through the native app.
Codex CLI 0.163.0 passed Default and explicit `gpt-6.1-sol` selected from the newly returned CLI catalog.
Each receipt connects visible selection, exact child arguments, terminal native job, typed AI Run, persisted row and Session reopen.
Codex generation correctly retains an unknown reported model.
Claude reports remain scoped metadata rather than independent serving-backend attestation.
The final successful receipts are `evidence-1792183058213.json` and `evidence-1792183839478.json` under `/tmp/qa-models/M04/authenticated-generation/`.

Three earlier Codex attempts stopped in the harness before explicit invocation.
The first two read fast preset descriptors instead of the visible deep catalog. The third edited the prior Session while a new Session was still hydrating.
The corrected harness reads rendered choices and waits for the newly created Session identity before editing.
These failed attempts remain retained. They are not provider execution failures.
Copilot 1.0.69 reached an actual Default invocation, which failed and stored a typed failed AI Run.
The harness stopped before Auto and explicit execution, so neither path has authenticated completion proof.
A separate bounded direct invocation also exited with an access-denial match. No auth, argument, network or usage-pattern match was established.
The output classifier retained categories only, not raw provider text. The underlying account or service cause remains unknown.
Receipts are `evidence-1792183914358.json` and `/tmp/qa-models/M04/live/copilot-failure-category.json`.
The direct result is consistent with an account or service denial but does not establish the app-run cause.
This unresolved qualification failure remains separate from deterministic CI and prevents any Copilot catalog promotion claim.

The 45-second native diagnostics walkthrough is `/tmp/qa-models/M04/review/demo.mp4`.
The exact binary hash, positive screenshots, inspected frames and teardown receipt are in `review/inspection.json`.
It shows synthetic policy, timeout, identity and executable replacement behavior. No human review or live-account proof is implied.

## M04 lane disposition

| Planned lane | Actual disposition |
| --- | --- |
| 1, Claude signed-in picker parity | Open. No-prompt catalog and authenticated generation passed, but full picker/account/platform parity was not established |
| 2, Codex picker parity | Partial. Paginated live catalog and explicit generation passed; the full signed-in picker matrix remains open |
| 3, Copilot catalog and ACP options | Blocked by catalog denial. No ACP session was created solely for discovery |
| 4, disabled | Passed in `final/provider-qualification-disabled/qualification-results.json` |
| 5, diagnostics | Passed in `final/provider-qualification-diagnostics/qualification-results.json` |
| 6, policy change | Passed as selector lane 6 |
| 7, identity change | Passed as selector lane 7 using isolated CODEX_HOME metadata; no universal account-change guarantee |
| 8, CLI replacement | Passed as selector lane 8 with an owned executable and incompatible protocol |
| 9, offline restart | Reuses `final/model-selection/lane-results.json` and the separate restart execution receipt. The saved model map survives while prior catalogs are absent |
| 10, authenticated round trip | Claude and Codex passed. Copilot Default failed; Auto and explicit completion remain open |

Paths in this table are under `/tmp/qa-models/M04/`.
The lane-9 substitution exercises the same retained preference and absent-catalog invariant in a second native process, without duplicating the M03 suite.
The source-only review does not replace hosted macOS validation or the open cross-platform CLI qualification.

## Final implementation revision

PR50 merged as `9b91d54262ec0220b763dcedabf281a3d76a9dd5` after independent verification of `e1af04a9003a1ef8934590079b1d5518e8a584c6` and green protected CI run `38973728061`.
The final independent default native suite passed 18 invocations and 64 tests without failures or skips, including both restarts.
All 180 required script tests passed. Its 557 source hashes and actual executable hash matched.
The earlier fixture readiness race and asynchronous save-guard probe were corrected and independently reverified.

The optional preflight keyboard helper has a disclosed pre-existing assertion that counts a negative-tabIndex toggle as a Tab stop.
Its optional run is not accepted as passing; observed focus stayed inside the dialog. Default coverage and the M03 OS-keyboard lane passed.
No new production-code claim is made from that optional failure.

The optional real-provider results above qualify the implementation candidate at version 0.8.9.
The release bump to 0.8.10 changes version metadata and documentation. Authenticated providers are not called again solely for that bump.
The final release executable requires its own deterministic validation and actual publication proof.
The workflow, published tag and public assets remain the authority for release completion.
