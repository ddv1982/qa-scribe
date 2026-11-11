# Independent C1 review

Verdict is **PASS+NOTES** for the bounded C1 implementation. I found no concrete P0, P1, or P2 defect introduced by this diff. This verdict does not certify the full Ask AI feature or release readiness.

- Base is `ed93f43955bfa98fec8fcb00f47a8ee9ddc24d3f`.
- Head is `0e046cb25dff045e8586df762117212a525598e8`.
- The exact diff changes 53 files with 1,679 insertions and 52 deletions.
- I read source through `git show 0e046cb:path` and `git diff ed93f43..0e046cb`. Concurrent mutable R1 source is outside this verdict.
- I independently compared all 53 handoff SHA-256 values against the committed blobs. All match.

I read `/tmp/ask-ai-c1-handoff.json`, `docs/design/ask-ai/implementation.md`, and the original C1 section in `docs/ask-ai-phased-plan.md`. The later implementation clarification governs the scope. R1 proposals and local apply behavior, later Jira conversation work, separate Jira integration, and real Jira writes are outside C1. Their absence is not a finding.

## Boundary review

The data shape is `ChatTarget`, with Session, Finding, and TestCasesDraft variants. Record snapshots contain the canonical local document, identity, metadata, origin, local fingerprint, and stored base token. The panel selection is separate from the persisted message context.

- **Capture and identity.** `frontend/src/app/sessionChat.actions.ts:261` captures context synchronously before the first awaited composer save. `sessionChat.context.ts:13` reads the current record refs and serializes the rich document without saving the record. The controller test explicitly changes the editor and detaches after Send while composer persistence waits. Its expected payload retains the original content. Server capture overwrites client fingerprint fields. Local content and stored content have separate digests.
- **Atomic storage and retry.** `crates/qa-scribe-core/src/services/session_service/chat.rs:49` inserts the user message and context inside the same immediate transaction. `chat_context.rs:159` resolves the newly inserted stable user message ID. The schema keys context by that ID and prevents context mutation. `chat_turns.rs:6` changes the attempt ID on retry without replacing the message or snapshot. Tauri retry preparation ignores a newly supplied target. The rollback, changed-base, retry, and interrupted-service-reopen tests exercise these boundaries directly.
- **Ownership.** Core `chat_context.rs:30` checks the snapshot Session, owning row, and stored draft kind. A Session Report cannot masquerade as TestCasesDraft. Frontend capture also rejects a missing or foreign record. Tauri rechecks the saved base after image verification and before commit. Retry revalidates ownership without recapturing the snapshot. A deleted source can remain in completed history because there is no foreign key from the snapshot to that record. Retry of a deleted source is rejected rather than retargeted.
- **Bounds.** Core capture checks both incoming snapshot size and final encoded context against 32 KiB. Start checks the 128 KiB aggregate before consuming the composer. `crates/qa-scribe-core/src/chat/input.rs:138` checks replay context again. Existing text, message, image, and provider-frame limits remain. Oversize and invalid-context tests compare the complete persisted chat before and after rejection. The transaction rollback test also checks that no user message survives a context-insert failure.
- **Migration.** `storage/mod.rs` advances schema 15 to 16 and installs the new adjunct table and triggers transactionally. Existing message rows are unchanged. Missing adjunct rows read as Session context. The older image migration remains idempotent for an already-upgraded schema 15 database. The new migration test reconstructs a version 15 state by dropping the adjunct table and setting `user_version` to 15. It is a synthetic migration fixture, not a captured production database.
- **Images and prompt data.** Record document image references remain data. Only attached chat images enter the vision pipeline. Context is JSON framed under the owning user message, and the trusted instructions distinguish snapshots, Session context, tool output, and explicit user requests. The production image preflight and replay paths remain shared. C1's native scenario checks an actual clipboard image read, attachment retention and removal, provider payload image ownership, and rejection before a provider start.

## Shared panel and maintainability

`AppShell.tsx` mounts one `AppChat`, which mounts one `SessionChatView`. Closing, expanding, and changing views toggle visibility rather than create another composer or chat controller. The hidden prop pauses transcript following. The existing Session chat actions still own persistence, jobs, cancellation, permissions, provider selection, retry, and submission.

`useAskAiContext.ts` owns the next-message target and panel state. Its Session view branch forces Notes sends to Session context. Detach changes future sends, while historical labels read each message's persisted context. Record views supply the same Ask AI action for saved manual and generated records. Library views do not gain a direct cross-Session chat entry.

Submitted conversations retain their existing read-only state and explicit restart action. Start new conversation deliberately clears the live input after confirmation. Panel close is a separate operation. The original plan's conflicting reset wording was corrected in the implementation document, and I did not treat that deliberate reset as data loss.

The layout preserves the collection as its scroll container beneath the Session tabs. At narrow workspace widths the document hides and the panel takes the available content. `useSummaryRecovery.ts` moves the existing refs without changing their lifetime or ownership. I found no speculative replacement chat service or separate Jira execution framework in C1.

## Evidence inspected

I read all four `wdio-execution.json` files, their `latest-run.json` files, and their runner logs under `artifacts/ask-ai/C1/`.

- `context-complete` records 7 passed, 0 failed, and 0 skipped.
- `s1-regression` records 10 passed, 0 failed, and 0 skipped.
- `permissions-r3` records 7 passed, 0 failed, and 0 skipped.
- `handoff-r3` records 1 passed, 0 failed, and 0 skipped.

Each runner receipt reports success on darwin arm64 and removal of isolated test data. The logs include a mock-store cleanup warning after the test session. Those warnings do not contradict the completed execution receipts, but these are not warning-free runs.

I inspected the actual PNG files, not just their filenames or handoff descriptions. The inspected images are all nine PNGs in `context-complete`, both permission PNGs, `s1-regression/lane-1-scrolled.png`, `lane-9-saved-scrolled.png`, `lane-5-768-by-700.png`, `lane-6-light.png`, and `lane-7-dark.png`, plus `handoff-r3/chat-review.png`, `chat-completed.png`, `chat-added.png`, and `chat-restart-confirmation.png`.

I also read the context geometry, S1 scroll geometry, permission geometry, and handoff counts. The S1 samples show the record header at the collection scrollport top, with scrollTop 650 retained through Edit and Save and outer scrollTop zero. Permission geometry reports visible, hit-testable approval, denial, and cancellation controls at both tested sizes. The handoff audit records one append, unchanged receipt replay, no provider invocation for review or handoff, and two explicit restart confirmations.

The supplied focused frontend log records 8 passing tests. The core chat log records all 7 new context tests passing. The focused fixture and runner contract log records 24 passing tests. I read their source assertions as well as the output. The parent's fresh core-context 7, frontend-context 8, and solo image-fixture 8 passes are additional parent-reported checks, not runs performed by this reviewer.

## Proof limits and notes

1. I ran no tests, builds, native application, browser session, or external operation. This is an independent committed-source and supplied-artifact review. The native receipts predate the commit and contain no embedded commit SHA. Matching the 53 handoff hashes confirms the committed source matches the supplied handoff, but is not independent attestation of each historical test process's loaded code.
2. The broader fixture log is not green. `/tmp/ask-ai-c1-fixture-tests-final.log` records 31 passes and one failure at `chat-images-provider.test.mjs:146`. Its error is `Fixture deadline exceeded for turn/completed; received catalog, config, 1, 2, 3`. The parent reports an exclusive shared-fixture fix in progress. I did not inspect mutable fixes or infer that this timeout is resolved.
3. The native reload scenario uses `browser.refresh()`. It proves WebView reload and persisted chat recovery, not a full native process restart. The core test separately closes and reopens the service and database, then retries an interrupted message. The native reload assertion does not itself prove reopening with a nonempty unsent image composer.
4. Clipboard proof reads actual operating-system image bytes but dispatches the paste event programmatically. It is not OS keyboard proof. Provider fixtures validate transport and snapshot content, not real model vision, real connector execution, or real Jira results.
5. The unsupported-provider screenshot visibly retains the question, but the error is outside the captured visible transcript region. Its native assertion checks the panel's text, retained input, unchanged messages, and absence of a provider start. It does not establish that the explanation is immediately visible without scrolling. The error location and transcript behavior already exist in the base; I found no demonstrated C1 regression to assign a severity.
6. The native context suite has seven cases covering several plan scenarios together. This is not ten independent live review lanes. The handoff audit explicitly lacks lost-ack and canonical-read fault seams. No comparative performance result, review video, Linux run, or OS keyboard verification is claimed.
7. Parent verification still owns the full repository gate, shared-fixture resolution, final native full-feature verification, later R1 and Jira work, and release acceptance.

## Comment and suppression review

I read `no-comments/SKILL.md` and `references/comment-sicko-prompt.md` in full and applied the portable generic independent fallback within this review delegate. No nested or sibling agent was started.

The exact C1 diff contains 0 added, 0 modified, and 0 removed comments. It contains 0 added or changed lint or TypeScript suppressions. A whole-file inventory found four existing oxlint suppressions in `useAppController.ts`. All four are unchanged from the exact base and outside the changed-comment scope.

Required comment deletions are 0. Actual deletions are 0. Restored comments are 0. MUST KILL flags are 0. Reruns, architect sketches, application fixes, encoding offers, encodings, and open comment constraints are all 0. No application fix was invented for comment style.

## Review method

Poteto's full Principles index and the applicable leaf skills were read. Boundary Discipline directed the review to the service and Tauri validation boundaries. Make Operations Idempotent directed the stable-message retry and interrupted-reopen checks. Minimize Reader Load directed the ownership trace from panel selection through capture, commit, and replay. Prove It Works required actual committed blobs, receipts, geometry, and PNG inspection, with the limits above kept explicit. Technical-writing and unslop shaped this report.

Throughput checkpoint is n/a for a read-only investigation. The how critique ran sequentially under the explicit prohibition on nested agents. This reviewer is the single independent review delegate for the parent task. No model-diverse review is claimed. Trusted Poteto sticky activation was not verified for future turns.

The only file written by this review is `/tmp/ask-ai-c1-review.md`.
