# Final Ask AI evidence, helper, and documentation audit

PASS+NOTES at exact head `32fce1d1a49919562001f6e92c8d41e135d30157`.

No blocking defect was found in the permitted helper and documentation delta. Production application files match reviewed `20bbeaf38b3b1a3d53258b157ce8a2cfb5f9a068`. The existing source and native findings remain closed. The final performance series meets its proposed budgets, with a measurable Save regression disclosed. Artifact equivalence is verified for the optimized instrumented artifacts described below. Protected hosted CI and actual release remain pending. This verdict grants no publication or release authority.

This fresh review used only the inherited OpenAI `gpt-6.1-sol` model. There was no nested agent, native launch, compiler invocation, benchmark rerun, commit, PR, external write, production edit, or tracked-file edit. Historical Grok reviews remain historical evidence. No cross-provider or model-family diversity is claimed for this audit. The earlier API-402 attempt supplies no review evidence.

## Exact source census and earlier findings

The isolated worktree is `/Users/vriesd/.t3/worktrees/qa-scribe/t3-63513978`. It started and finished with clean tracked status at the requested head. The range `20bbeaf..32fce1d` has 111 changed destinations. Exactly three are outside `docs/` and `CONTEXT.md`.

- `crates/qa-scribe-core/examples/generate_ui_perf_fixture.rs`.
- `e2e/specs/ui-performance-observer.mjs`.
- `e2e/specs/native-ui-performance.benchmark.mjs`.

I read their complete diff and surrounding implementations. I compared all 141 entries in the committed round-two source manifest with the committed `20bbeaf` blobs, then with this checkout. Only those three helpers differ. Production source, generated permissions, schemas, maintained feature assertions, and the compensation and composer corrections are unchanged.

I read `/tmp/ask-ai-final-review-r2.md` and the committed review index. The R2 report hash matches its receipt. All 14 recorded log hashes and all 224 recorded artifact hashes match the original R2 worktree artifacts. The seven native execution receipts and runner results show 38 maintained passes plus eight additional passes, zero failures and skips, and successful isolated-data cleanup. These are inspected prior executions, not tests rerun by this audit.

I opened representative actual outcome records for staged refinement with unchanged storage, stale storage retaining the newer title, Jira follow-up questions containing exact `Finding subtask`, and narrow Send reachability. I also inspected the committed dirty-editor, Dark-360 four-image Send, and synthetic checkout PNGs. The visual JSON has exactly 82 rows, 74 screenshot entries and eight resize records, with no failed or blocked rows. It does not contain 82 screenshots.

The compensation-base and narrow-composer P2 closures at `20bbeaf` remain applicable through the unchanged application census. Earlier stale-overwrite P1 and readable-fallback P2 closures remain applicable. This audit does not replace the earlier whole-feature or native review.

## Decision trail and execution evidence

I read both complete decision trails. The committed `docs/design/ask-ai/decisions.tsv` and canonical `/tmp/qa-scribe-ask-ai-plan-20261024/decisions.tsv` are byte-identical. Each has 53 physical lines, including the header. The last audited entry is line 53 at `2026-10-24T23:12:56Z`, the final audited performance acceptance. There are 52 decision entries. All 76 path-shaped evidence pointers resolve using the original artifact root where appropriate. The script also checks local Markdown links in the changed documentation, including editor line suffixes. None are missing. Existence alone is not treated as execution verification.

Primary execution files were opened and parsed directly.

- `/tmp/ask-ai-frontend-final.log` records 100 Vitest files and 971 passing tests. It includes existing Vite deprecation diagnostics. Its 14 lines contain the test command, not the full frontend checker command.
- `/tmp/ask-ai-workspace-complete.log` sums to 719 Rust passes, zero failures and three ignored tests. Its final sections show workspace build completion and the `qa-scribe-app` smoke run initializing schema 18. The ignored tests require authenticated Claude/Atlassian or provider catalog access. These are prior workspace results, as the implementation document says.
- `/tmp/ask-ai-scripts-serial-node24.log` records 552 tests, 549 passes, two failures and one skip. The Linux-only zombie-group case is skipped on macOS. Both failure bodies were inspected, including the LSP stdin rejection mismatch and startup cleanup `kill EPERM`.
- `/tmp/ask-ai-baseline-lsp-probe.log` and `/tmp/ask-ai-baseline-cleanup-probe.log` reproduce those same failures in the initial-main checkout. The corresponding maintained script tests are unchanged from base.

The trail's earlier one-failure tail summary is explicitly superseded by line 45 at `22:38:46Z`. The earlier 82-captures wording is corrected at line 49. The discovered-type-ID claim is corrected at line 8. No full local `bun run verify` pass is established or claimed. No check or assertion was disabled by this delta.

The historical plan begins with an explicit supersession notice. Current scope reuses Session Chat, images, provider tools and permissions. It excludes real Jira testing, a new Jira client, app-owned connector qualification and a remote execution journal. Current product guidance distinguishes editable action requests and agent-reported results from app-verified Jira outcomes. It preserves ordinary chat and exact `Finding subtask` wording. The prototype and screenshots are labelled synthetic. Its sole image dependency resolves to the inspected synthetic shop image. The user's layout-reference screenshot is excluded from the committed assets.

## Helper mechanics and performance evidence

The original invalid qualification receipt has a 113,902-byte ASCII Finding, one failure, an incomplete run and a Save observation timeout. It is excluded. The production validator counts Unicode scalar values with a 100,000-character maximum. The corrected generator validates against that maximum minus 1,024 before database insertion. I independently reconstructed its identical 89,982-byte ASCII body. Twenty edit markers remain comfortably below the cap. The observer now requires at least 80,000 text characters. Both corrected qualifications pass. The later audited qualifications additionally contain the persisted execution assertions used by the final series.

I ran exactly the six permitted observer mechanics tests. All six passed, with zero skips or failures, on Node `v26.12.1`. An ignored copy changes only the jsdom and observer import paths. It reads existing jsdom dependencies without modifying the shared dependency directory. These tests verify mechanics, not new native performance results.

I inspected Tauri `2.11.5/scripts/core.js` at the supplied registry path. Its `Object.defineProperty` for `invoke` specifies only `value`, so writable and configurable default to false. The old observer assignment could not establish interception. The current observer removes it. The benchmark instead queries SQLite for actual AI Run and message counts and checks fixture execution markers. There is no blocking or interception proof and no measured IPC duration.

I recomputed all ten committed `pair-final-*` raw JSONs directly, then compared their derived results with `summary.json`. Each raw file and accompanying invocation, runner and execution receipt is byte-identical to its original under `/Users/vriesd/projects/qa-scribe/artifacts/ask-ai/performance`. Raw hashes match the summary. The recorded source revisions, actual retained binary hashes, current probe and observer hashes, and retained generator executable hashes match. Generator hashes identify executables, not Rust source files.

Run timestamps confirm five non-overlapping alternating baseline/head pairs. Ten temporary fixture roots and five head companion Session IDs are distinct. All ten runs complete with zero failures. Baseline has 60 action samples per run and head has 120. Every head run contains 20 real V2 proposal cases. Actual sample titles and bodies match their fixtures, with dirty-editor proof, nonempty durable stage IDs, unchanged stored records, and Undo plus Discard cleanup. The maintained harness asserts complete stored rows before and after cleanup. Every run records zero AI Runs and zero provider fixture executions. Message counts are 100 baseline and 140 head. These are postconditions, not prevention claims.

The following values are medians of five independently recomputed per-run p95 values. Ranges are across those five p95 values, in milliseconds.

| Interaction | Baseline | Head |
| --- | --- | --- |
| Notes visible reveal | 36, range 36 to 37 | 23, range 23 to 27 |
| Literal edit | 32, range 31 to 33 | 37, range 35 to 38 |
| Record Save | 86, range 86 to 87 | 118, range 114 to 121 |
| Ask AI opening | Unavailable | 38, range 37 to 39 |
| Proposal review | Unavailable | 21, range 19 to 22 |
| Apply to editor | Unavailable | 79, range 78 to 89 |

Every paired Notes and Save value passes `head <= 1.2 * baseline + 50 ms`. Ask AI passes 250 ms, Apply passes 100 ms, and scroll passes the larger of 20 ms or 1.2 times baseline. Scroll p95 is 12 ms on both sides in every run. All 121 pinned geometry samples per run show baseline gap 32 px and head gap zero. No qualification, exploratory or profiled timing enters this table.

Save is measurably slower, with non-overlapping run ranges and a 32 ms median-p95 increase. Literal edit is also somewhat slower. This is not a general speedup. First Notes interactions remain separately recorded, baseline 516 to 523 ms and head 520 to 525 ms. They do not prove cold parsing or startup cost. The observer measures DOM event capture to a second ready animation frame, a paint opportunity that excludes physical paint and OS input latency.

Both committed Save profile JSONs match their original raw files. Baseline has zero digest operations. Head has 59, two for the first Save and three for each of the following 19. The recomputed median sum of digest waits is 39.5 ms. Median event-to-DOM is 45.5 ms baseline and 87 ms head. The guard functions contain the corresponding awaited hashes. This supports added hash waiting in that diagnostic, without attributing an exact fraction of the separate uninstrumented 32 ms increase. All captured operations are digests, with no invoke timing.

The original WebContent sample is 1,131,679 bytes with SHA-256 `177a1ea3e0239aa0b591fe2b86ba22d3b2aab2f76442816a347fd2d653aca092`. The committed excerpt exactly matches its first 70 lines. The inspected call tree spends 1,671 of 1,932 main-thread samples waiting through the Mach port path, with rendering, timer, style and layout work also present. Recorded process CPU counters show the load generator below one-core saturation after startup. The animation-frame schedule partly limits these UI samples. The profile cannot establish exact uninstrumented latency attribution.

## Artifact equivalence and workflow validation

The parent supplied `/tmp/ask-ai-artifact-equivalence.json` during this audit. I read that receipt and `/tmp/ask-ai-artifact-equivalence.log`. The log shows two optimized builds at `20bbeaf` and one at `32fce1d`, with three Vite and three optimized Rust completions. The receipt records the same 21 frontend file hashes and native hash for all three. I independently rehashed the retained current frontend files and both retained head binary locations. They match.

The native hash is `c7c5882101f0b10a2d06fdfd12752f81a2ae86467cc5c7ff7e2a9c96af083f4f`. The equivalence receipt hash is `6661ed32a372f7b33816a34034eabb17f73c5147007c0137e4a4ba1e434874a1`. This closes the requested optimized instrumented artifact-equivalence check. It does not prove packaged, signed or installed release artifacts. Build logs retain three Rust warnings and a Vite chunk-size warning, so these are not warning-free builds.

I also opened `/tmp/ask-ai-workflow-validation.log`. It reports pinned actionlint `1.7.12`, Zizmor `1.30.1`, completed scans and no findings, with 40 suppressed. The workflows, checker and tool pins are unchanged from initial main. This delta adds no suppressions. The log does not record authentication mode, so I do not independently attest the parent's authenticated-mode description. Local workflow validation does not replace protected hosted CI. Its log SHA-256 is `357497137dbd62efdbd83f199310b8f6e6caedb6b4303e6a9eebce7b9d6191e4`.

## Actionable documentation notes

1. At `implemented/performance/README.md:26`, change the categorical "three per Save after" to the observed distribution or "typically three". The raw head profile has 59 operations, not 60. The reported medians and limited causal interpretation remain supported.
2. Add an exact-corrected-head primary receipt for the full frontend checker, or narrow the claim in `implementation.md:102` and decision-trail line 47 to what the supplied receipt proves. `/tmp/ask-ai-frontend-final.log` proves 971 tests. It does not show type-aware lint, CSS or contrast execution. Older Jira and R1 checker logs do show those checks, and the new build log proves typecheck, but those do not independently bind all checker components to `20bbeaf`. This is an evidence-pointer gap, not a demonstrated checker or product failure. No rerun is requested from this read-only reviewer.
3. Keep the historical R2 report immutable, but add an erratum beside its index entry if it will be reused as helper evidence. Its statement that the observer "rejects provider or Jira invocation" was not valid runtime prevention proof. The later decision trail and current performance README correctly supersede it. Cite the current SQLite and fixture postconditions instead.

None of these notes reopens a current source or native defect. No missing internal target or unsupported new integration requirement was found. Some original logs and artifacts remain local-only evidence; the committed reports accurately describe their limited provenance and must not be treated as hosted CI receipts.

## Generic Comment Sicko and method

Yes... Ha ha ha... Yes!

I read the complete no-comments skill and portable Comment Sicko prompt, then applied the role myself under the explicit no-nested-agent instruction. Scope was the fresh helper and prototype code delta. Babel parsed both JavaScript helper files and the prototype script. CSS, HTML and Rust candidates were inspected separately. Added manual comments, HTML/CSS comments, suppressions, proposed deletions and MUST KILL flags are zero. The generated `resolve_refinement.toml` permission header is unchanged and matches the installed generator's header template. No comments were deleted or restored. Reruns, architecture sketches, application fixes, encoding offers and open comment constraints are zero.

The full Poteto Principles index and applied leaves were read. Prove It Works changed this audit from accepting parent counts to opening execution logs, hashing original receipts and inspecting actual outcomes. Explain the Number required raw-sample recomputation and kept hash diagnostics separate from the comparison. Build the Lever produced the ignored recomputation script instead of a manual table transcription. Investigation/how, technical-writing and unslop were applied sequentially. The throughput checkpoint is n/a for a read-only investigation. Trusted cross-turn Poteto hooks were unverified, so no sticky activation is claimed.

Rerunnable ignored audit scripts are under `artifacts/ask-ai/audit-openai/` in this isolated worktree.

- `python3 artifacts/ask-ai/audit-openai/recompute.py` checks the exact census, receipt hashes, ten raw runs, budgets, profiles, links, equivalence and workflow evidence.
- `node artifacts/ask-ai/audit-openai/comments.mjs` checks scoped comments and suppressions.
- `node --test artifacts/ask-ai/audit-openai/observer-test.mjs` runs the six import-adjusted mechanics cases.

The recomputation script was corrected during setup for its worktree-root index and for recognizing invocation generator hashes as executable hashes. Those were audit-script mistakes, not failed product checks. Its final complete run succeeds. The six mechanics cases ran once and all passed. Tracked files remain untouched.

Protected hosted CI, any PR/merge and the actual project-CI release remain outside this completed audit. No OS Cmd-V, physical display paint, real-model reliability, real Jira operation, local Linux qualification or signed release proof is added here.
