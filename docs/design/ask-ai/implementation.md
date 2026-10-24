# Ask AI implementation run

## Current acceptance

Application source `20bbeaf` has independent source and native PASS+NOTES, 38 maintained native passes and eight additional native passes. Both reviewed P2s and the earlier stale-overwrite and readable-fallback findings are closed. The final frontend check passes all 971 tests. The workspace previously passed 719 Rust tests, build and smoke; later application corrections are TypeScript and CSS, with fresh independent core and controller coverage.

All [performance budgets](implemented/performance/README.md) pass across five audited interleaved pairs. The near-limit guarded Save is slower within its budget. No general speedup is claimed. Later commits change verification helpers only. Final delivery still requires exact-head protected hosted CI and the repository's dedicated release preparation process.

Full local `bun run verify` is not green. Two unchanged tooling failures reproduce on initial main, as recorded below. No check was disabled. The [independent review index](implemented/reviews/README.md) preserves the historical failures and corrected-head verdict.

## Done predicate

The record chat, guarded refinement, and Jira drafting flow pass focused behavior checks, the full repository gate, native desktop workflows, and independent review. A release uses the repository CI workflow after its prerequisite CI checks succeed. Jira execution reuses the existing coding-agent chat tools and permissions.

## Execution

Implement S1, C1, R1, and Jira drafting in order. Keep each phase reviewable with its own verification evidence. The user's implementation and release instruction supersedes the earlier plan-only authority. Their subsequent clarification removes real Jira test writes and a separate app-owned execution or connector qualification framework. General coding-agent actions remain available through the existing chat.

## Throughput checkpoint

- Blocking first steps. Read the approved plan, compare architecture candidates, inspect release rules, and reproduce the native scrolling defect.
- Independent workstreams. Read-only architecture candidates and release grounding run concurrently. Each writes a distinct temporary report. S1 owns its header, style, and native layout test files.
- Shared mutable state. One implementation owner writes the coupled chat domain and application state at a time. Native desktop runs are serialized. The parent owns integration, commits, PRs, and release actions.
- Smallest safe decomposition. Preserve the five dependent implementation units. Reuse Session chat and provider permissions. Establish durable target context before proposal and Jira interaction contracts.

## Evidence

The append-only decision trail is `/tmp/qa-scribe-ask-ai-plan-20261024/decisions.tsv`. This run starts at its implementation entry. Architecture candidates are `/tmp/ask-ai-architecture-a.md` and `/tmp/ask-ai-architecture-b.md`. Release grounding is `/tmp/ask-ai-release-grounding.md`. These reports are evidence inputs, not verification verdicts.

The S1 native baseline at `1c34f3e229ccf471241f7dfc7248b4d73c2ce6d9` measured a 32 px gap at a 1280 by 828 CSS-pixel viewport after scrolling the synthetic finding by 650 px. The record title had scrolled outside the pinned region. Evidence is `artifacts/ask-ai/S1/before/record-workspace-layout.json` and `lane-1-scrolled.png`.

The first completed S1 native run passed all ten cases. The pinned gap is zero, and the scroll position stays at 650 px through Edit and Save. The parent inspected the actual diff and before, after, and narrow-window screenshots, checked the completed runner receipt, and reran the ten RecordCollectionView tests successfully. Durable screenshots and the owner's exact command receipt are in [implemented/S1](implemented/S1/verification.json).

Independent review rejected that S1 source. A real TipTap reproduction showed that retained history could restore record A's body into record B through Undo after a record switch. The base component did not reproduce it. The review is `/tmp/ask-ai-s1-review.md`. Its comment and suppression scan found zero added comments, suppressions, or required deletions.

The corrected history scope now separates records and editing sessions while retaining the editor DOM. Three durable real-editor tests failed before the correction and pass afterward. The parent reran 27 editor and history tests. Independent round two passed with notes and reran 51 tests. C1 then reran the ten native layout cases successfully. S1 is committed as `ed93f43`. The independent review is `/tmp/ask-ai-s1-review-r2.md`.

C1 is committed as `0e046cb`. It passed seven native context cases covering the ten planned scenarios, seven permission cases, the existing Note handoff workflow, and the ten S1 layout cases. The parent inspected the actual payload, service, controller and layout changes, checked all 53 source hashes, inspected desktop and narrow screenshots, and reran eight controller tests and seven core context tests. The first controller rerun omitted the known Node 26 storage flag and failed in the existing harness; the corrected local invocation passed. Durable [C1 screenshots and verification](implemented/C1/verification.json) retain the source and command receipt. Independent C1 source review passed with notes in `/tmp/ask-ai-c1-review.md`.

The auxiliary image-fixture executable test passed all eight cases in the parent's isolated rerun. Commit `6b7edb8` then changed the shared release-marker helper to poll actual file existence. A forced silent-watcher reproduction failed before the change and passed afterward. The parent independently reran the affected forty-test bundle successfully. This establishes removal of the notification dependency, not the cause of the historical timeout. No deslop skill was installed. Parent cleanup used direct diff, whitespace, generated-binding, type-aware lint, dependency, duplication, and suppression checks before commits. Independent comment review remains separate from that cleanup.

Interleaved performance measurement, a review video, Linux execution, and OS-level keyboard navigation are unverified. These are not covered by the ten native WebView cases.

## Release path

The release researcher observed published v0.8.21 at the initial source SHA. Protected `main` requires strict `CI success`. Use the repository's version-bump script in an exclusive checkout, replace its changelog placeholder, and submit the release preparation PR. After a verified authorized merge, the Release workflow creates its exact-merge tag and publishes signed platform artifacts. Do not manually tag as a shortcut. The final receipt must include the merge-triggered run and non-draft release assets.

## Architecture comparison

Both candidates independently grounded the provider-native question bridge and rejected it for this task. Existing adapters do not expose a durable cross-provider question contract. Both retain the existing shared conversation and attach immutable record context to stable user message IDs. Retries replace attempt IDs, so a turn-ID-only context key would lose the original subject.

Candidate A is the selected base. The independent Grok 4.7 judge agreed. It keeps Jira drafts and follow-ups in the ordinary transcript rather than adding a separate Jira draft store. Candidate B contributes offered recovery of a staged local edit and a proposal patch split by record kind. Test cases cannot receive finding metadata. Both keep local editor and stored record bases distinct. A completed response can propose a reviewed local change; provider text cannot grant permissions or prove external Jira success.

The judge found that both candidates incorrectly described the deliberate Start new conversation action as preserving the live composer. Existing behavior archives the old conversation and clears the composer after confirmation. Keep that explicit reset behavior. App restart and panel close remain separate operations and must preserve their persisted input and original message snapshots. Additive persistence changes receive migration versions as needed; a design sketch does not justify mutating an already-applied migration.

## Delivery units

Keep the dependent implementation units as ordered, checked commits in one feature PR. The clarified scope reuses one chat and response protocol rather than adding a separately owned Jira integration. The feature will receive a clean-tree independent review and the protected CI gate as a whole. Prepare the version bump in a separate release PR from protected main, following the project release guide. This replaces the earlier proposed five-PR delivery shape. It does not remove functional, native, performance, or release checks.

The generic Jira reply extension is specified in [jira-chat-replies.md](jira-chat-replies.md). Two independent model reviews selected it over route-only buttons. It keeps the visual issue-type and required-field follow-ups while leaving all Jira knowledge and execution in the existing coding agent.

## Refinement checkpoint

R1 is committed as `7271d0e`. Its final native suite passed eleven cases. Focused owner checks passed 252 frontend tests, 116 core tests, 49 Tauri tests, and 40 fixture and checker tests. The parent checked all 92 source entries, inspected the final dirty-editor screenshot and controller transitions, and reran thirteen frontend proposal/review tests and nine core refinement/guard tests. [R1 screenshots and the exact verification receipt](implemented/R1/verification.json) retain the evidence. Independent R1 review is running against that committed tree in a separate worktree.

The verified behavior keeps Apply local and Save explicit. Stored writes compare the expected base atomically for Findings and Test cases. Compensation has an explicit origin and idempotent result. Late local edits and record intents prevent stale installation. An aborted preparation can be abandoned without replacing current edits. Unresolved stages block conversation reset and Note handoff. Dirty context labels use the record workspace's authoritative state. Readable metadata changes and composer-side errors replace implementation dumps and hidden explanations.

Full integrated checks, comparative performance, real-provider envelope reliability, and release acceptance are not established by these focused results. Native recovery exercised WebView reload; core tests separately reopened the service and database.

Independent review rejected `7271d0e`. Its controller reproduction showed that Conflict, Undo, then Save could use the newer stored base with the old editor content. Its core reproduction also showed that invalid-envelope fallback discarded the readable provider response. The report is `/tmp/ask-ai-r1-review.md`. The R1 owner is fixing base retention in three exclusively owned frontend files. The Jira owner is fixing readable fallback in the generalized completion boundary. These findings must receive fresh independent verification before release.

Commit `e8a8a66` addresses the stale-write finding. Stage release retains the pinned editor base while removing proposal origin. Explicit Discard or a confirmed successful write releases or advances that base. Both original reproductions failed before the fix and passed afterward. The parent matched all three source hashes and reran thirty-nine controller tests successfully. Independent round-two review passed after eighty-eight focused tests and fourteen additional adversarial probes. It verified both record kinds, distinct managed images, later edits, status failures, pending writes, replacement stages, and explicit Discard. The fix receipt is `/tmp/ask-ai-r1-p1-fix.json`; the review is `/tmp/ask-ai-r1-p1-review-r2.md`. This closes the bounded P1 source objection, not whole-feature acceptance.

## Jira conversation checkpoint

Commit `73410b9` implements the generic follow-ups and fixes readable fallback. It replaces request booleans with one typed intent, stores validated questions beside completed messages, and keeps original snapshots for correlated replies. The explicit action handoff fills an editable composer. It does not invoke Jira. Findings display the exact Finding subtask label with a display-only recommendation. Ordinary typed chat, images, model selection, cancellation, permissions, and Note handoff remain shared.

The owner passed nine native Jira cases and eleven refinement regressions with the same binary. Focused checks passed 125 core tests, 51 Tauri tests, and 172 frontend tests. The parent matched all fifty-five source hashes, inspected desktop and narrow screenshots, and independently reran thirty-five frontend tests and thirteen core tests. [Jira screenshots and verification](implemented/Jira/verification.json) retain the exact receipt. Rejected responses preserve readable text without controls; a separate warning does not consume the message byte limit. Whole-feature independent source reviews and the integrated gate are running at this checkpoint.

All Jira examples are deterministic synthetic fixtures. No real Jira write, connector qualification, external outcome verification, or new integration is claimed. Native evidence uses embedded macOS WebView control. It does not establish operating-system clipboard or pointer latency.

## Integrated gate checkpoint

The first full local gate passed all 951 frontend tests, then stopped in the release script tests. Five unchanged tooling assertions compared the macOS temporary-directory alias with its canonical path. A canonical `TMPDIR` resolves those path assertions. Process-cleanup tests also reported `EPERM`. The startup-interruption cleanup failure reproduces on the original `1c34f3e` release source with Node 24, independently of Ask AI. The first full log is `/tmp/ask-ai-integrated-verify.log`; the baseline reproduction is `/tmp/ask-ai-baseline-cleanup-probe.log`.

A subsequent script run is not valid driver-diagnostics evidence. Its embedded-driver readiness test overlapped the independent native review's port 4445. Future script diagnostics and native launches must be serialized. No assertion was disabled. The remaining Rust, build, and smoke checks are running separately. Full local gate success is not claimed at this checkpoint. Protected hosted CI remains required before merge.

The whole workspace exposed five stale schema assumptions in three older migration suites. Their old current version 15 and future version 16 no longer described the application. Commit `50d39eb` removes two redundant constant assertions, compares migrated storage with the current schema, and uses current schema plus one for the future-version refusal. All thirty-two targeted migration cases pass. The subsequent workspace run passed 719 tests with three pre-existing ignored tests, then completed the build and smoke checks. Its log is `/tmp/ask-ai-workspace-complete.log`. Production source remains identical to `73410b9` at that checkpoint.

Whole-feature source review A rejected `73410b9` for a P2 save-lifecycle regression. After a superseded write is successfully compensated, the frontend keeps the superseded write's base. A newer retained local edit then cannot save. The reviewer reproduced both record kinds and confirmed that the core accepts the correct restored base. The report is `/tmp/ask-ai-final-review-a.md`. The same review independently closed the earlier stale-overwrite and readable-fallback objections. Compensation correction and fresh independent review remain required before acceptance.

Commit `20bbeaf` corrects confirmed compensation for both record kinds. It computes the Editor guard from the actual restored row and checks current intent ownership around each asynchronous boundary. Retired callbacks cannot replace a newer guard, saved ref, or error. Conflicts retain the pinned base, and the compensation request retains its idempotent origin. Both original reproductions failed before the correction and now pass. The owner passed 114 focused tests; the parent matched all three assigned hashes and reran fifty tests. The exact receipt is `/tmp/ask-ai-compensation-base-fix.json`. A fresh source and native review is running at that committed head.

Commit `a99ac02` adds the repeatable performance fixtures and probe. Parent compilation, Clippy, six observer mechanics tests, and actual seeding pass. The seed contains twenty validated V2 proposals in a separate companion Session and leaves the shared hundred-message, four-image fixture unchanged. It has no foreign-key violations. These preparation checks are not native performance results. The optimized baseline remains unchanged, and rebuilding its frontend with Node 24 produced identical bytes in all twenty-one files. Head timing is deferred until the compensation fix and active reviews finish.

Independent native review rejected the same head for a second P2. At 360 CSS pixels wide, a column direction combined with wrapping and a full-basis help item moved Send and Attach images beyond the viewport. Its maintained runs recorded thirty-seven passes and one failed image workflow. Four additional native Undo/Save cases passed. The report is `/tmp/ask-ai-native-shipping-review.md`. The parent separately reproduced the offscreen geometry before editing source. A single-column composer grid is now under maintained native verification, with the image matrix extended to the declared 320-pixel minimum. The review's runtime-only CSS experiment is diagnosis, not a passing production fix.

Commit `052f0ba` corrects that layout. The first grid-only native run still failed four checks because the sixty-pixel transcript clipped the short latest reply. The accepted correction gives the transcript a usable minimum and retains panel scrolling. The complete maintained image workflow now passes, including eighty-two visual rows at 320, 360, 768, and 1280 pixels in both themes, with no failed conditions or blocked widths. Those rows comprise seventy-four screenshots and eight resize records. Its full transport, replay, and Note handoff also complete. The parent inspected the actual narrow screenshots. Evidence is `artifacts/ask-ai/composer-fix/after-v2/`.

The serialized release script suite ran with Node 24, canonical temporary paths, and no competing native driver. It recorded 549 passes, two failures, and one platform-specific skip across 552 tests. Both failures reproduce on the original release source. They are the LSP stdin-failure fixture and startup process-group cleanup. Logs are `/tmp/ask-ai-scripts-serial-node24.log`, `/tmp/ask-ai-baseline-lsp-probe.log`, and `/tmp/ask-ai-baseline-cleanup-probe.log`. An earlier tail-only progress summary incorrectly said one failure; the append-only trail corrects it. Full local gate success remains unclaimed.

The final frontend check passes at `20bbeaf`, including typecheck, type-aware lint, CSS and contrast checks, and all 971 tests in one hundred files. The optimized native E2E build and both fixture helpers compile in a private checkout. Baseline and head binaries have separate private copies with verified hashes. Shared probe scripts match and the common fixture is byte-identical. These are preparation receipts only; native qualification, profiling, interleaved timings, and fresh independent acceptance are still pending.

Fresh [source and native review](implemented/reviews/source-native-round-two.md) passes with notes at `20bbeaf`. Both newer P2s close, and the earlier P1 and readable-fallback closures hold. The parent matched all 141 committed source hashes, fourteen execution logs, and the artifact manifest. The review independently passed 38 maintained native cases and eight additional native cases, together with source and core probes. It explicitly confirms vertical reachability in narrow windows rather than simultaneous visibility of every control. Performance and hosted CI remain separate gates.

The first optimized baseline performance qualification failed. The SQL fixture contained a finding body larger than the existing 100,000-character limit, so the real Save correctly rejected it. No timing from that run is accepted. The fixture now uses a valid long record, validates the real body limit with space for edits, and is identical on both sides. The observer's long-record threshold follows that valid workload. This changes verification helpers only. Qualification is being repeated before any reported comparison.

The corrected qualification and five-pair comparison are complete. Save-specific diagnostics identified the new frontend guard hash awaits as additional waiting. They also exposed an ineffective attempted override of Tauri's non-writable invoke bridge. That override and its blocking claim were removed. Actual persisted AI Run/message counts and provider fixture execution files are now checked. Fresh audited qualification and five reported pairs pass with those assertions. The detailed [performance receipt](implemented/performance/README.md) retains every result, uncertainty and excluded run.
