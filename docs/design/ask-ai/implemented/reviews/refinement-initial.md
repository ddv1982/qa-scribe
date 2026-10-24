# Independent R1 review

FAIL. Two concrete findings remain in current R1. The first permits a stale overwrite after a conflict. The second loses readable provider output on invalid-envelope fallback.

Base `6b7edb8880664b18b41eb1b9cdc9296e58250d15`.
Head `7271d0ef4cf92a25a15c7c17cc15c0f46fb555eb`.
Isolated checkout `/Users/vriesd/.t3/worktrees/qa-scribe/t3-e9a30c39`.

## P1. Undo after a Save conflict releases the original stored base

The defect is at `frontend/src/app/sessionChat.proposals.ts:89`. Undo restores the captured before value and calls `clearStage`. That function also deletes `latestWriteGuards` at `frontend/src/app/recordActions.coordination.ts:253`.

On a prior Save conflict, `adoptConflict` has already replaced the saved-record ref with the newer remote row. It correctly retains the dirty local editor. After Undo deletes the guard, however, `guardFor` at line 234 hashes that newer saved row. The next Save sends the old snapshot contents with the newer row's base. The backend accepts that write because its compare-and-write guard now matches.

Reproduction for either a Finding or a Test cases draft:

1. Request and Apply a refinement from saved record A.
2. Change the same stored row through another client to B.
3. Click Save. The conflict retains the proposed editor and offers Discard to review B.
4. Click Undo refinement. The editor becomes the captured A.
5. Click Save without using Discard or reviewing B.

Expected behavior retains A's original expected stored base and rejects this Save while B remains current. Actual behavior sends B's base with A's title and body. The newer row can be overwritten without review.

I reproduced both variants through the actual `useAppController` in an ignored review test. The transport mock models the core's observed base comparison and records the resulting saved value. Both tests first confirm that the outgoing base equals B's base, then fail the literal assertion that B remains saved. Finding saved `Checkout returns 500` instead of `Newer stored title`. Test cases saved `Checkout test cases` instead of `Newer stored title`. This is a controller reproduction, not a native rerun.

The correction needs to separate proposal-stage settlement from the expected base of the still-dirty editor. Undo can remove the stage origin while retaining its original expected base as an editor guard until explicit discard or a confirmed successful Save. Retaining an Undone proposal origin would instead make the core reject an otherwise valid later Save. Cover both kinds and Undo status failure in the regression.

The reproducible probe is `frontend/node_modules/.cache/r1-review/proposals.test.ts` in the isolated checkout. Run from its `frontend` directory:

```sh
NODE_OPTIONS=--no-webstorage node node_modules/vitest/vitest.mjs run --config node_modules/.cache/r1-review/vitest.config.mts -t REVIEW
```

The final probe run has two failing conflict tests, one passing Undo status failure test, and nine skipped copied baseline tests. The passing test verifies that an edit made during a failed Undo status request remains local and saveable when storage has not changed.

## P2. Invalid-envelope fallback discards the readable response

`crates/qa-scribe-core/src/services/session_service/chat_refinements.rs:119` replaces every interpretation error with one generic message. The original response is neither appended to the assistant message nor preserved in the proposal sidecar. There is no proposal in this branch. The original explanation therefore disappears from saved conversation history and Note handoff.

The preparation document explicitly requires a short explanation and the original response as readable text for this case. Rejecting the proposal is correct. Removing the response violates that fallback contract.

I reproduced this through the actual core service with a contracted turn returning this plain response:

> The expected result is unclear. Confirm whether a receipt is required before changing this finding.

Completion succeeds with zero proposals. The saved assistant text contains only `No editable proposal was created. The response did not match the requested refinement format. Ask again or continue the conversation.` The assertion that saved text contains the original response fails.

The isolated core probe is `target/r1-review-fallback.rs`, compiled against this checkout's newly built core library. Rerun its generated test executable with `target/r1-review-fallback review_preserves --nocapture`. Keep the rejected output readable and non-actionable without relaxing envelope validation. This finding makes no claim about how often a real model returns this form.

## Verification and coverage

The checkout started clean at the requested head and remains free of tracked changes. I read the handoff, source receipt, complete preparation document, and parent-root `docs/design/ask-ai/implementation.md`. All 92 source hash entries match both receipt maps, the isolated files, and blobs at the reviewed commit. The removed paths are absent as recorded. Applied migration 16 is unchanged.

I read the actual R1 diff and surrounding completion, preparation, domain, storage, editor, persistence, coordination, review, reset, and Note handoff code. The domain separates kind-specific patches, proposal states, stages, stored bases, and write origins. The response parser consumes a whole JSON object, rejects unknown fields and wrong nonce or patch kind, and merges allowed metadata onto the original object. Successful completion checks the active attempt and AI Run association before proposal persistence. Legacy messages have no synthesized contract. The shared Markdown converter treats raw HTML as text and does not turn model image references into managed nodes. Base image nodes survive the core merge and frontend normalization path.

Both update commands require guards. Production Save, generated canonicalization, and compensation callers carry those guards. The core compares all stored editable representations inside the immediate transaction and settles matching stage outcomes there. The focused core tests exercise conflict retention, rollback, repeated compensation, migration, stage/reset blocking, read-only settlement, and idempotent readable Note handoff. The controller tests exercise dirty-only Apply for both kinds, duplicate Apply, await races, newer intent generations, navigation, stale preparation abandonment and continuation, Undo, failed Save, and conflict Discard. Hydration offers the stage rather than installing it. Saved conversation review receives no action callbacks.

Independent isolated commands passed:

- The seven frontend suites `sessionChat.proposals`, `ChatProposalReview`, `recordPersistence`, `useAppController.sessionIntegrity.compensation`, `useAppController.workflows.record-editing`, `useAppController.workflows.settlement`, and `editorDocument` passed all 74 tests. They ran with Node's `--no-webstorage` flag.
- `cargo test --offline -p qa-scribe-core --test chat_refinement --test record_write_guards` passed all 9 tests.
- `git diff --check 6b7edb8..7271d0e` passed.

The added adversarial probes expose the findings above despite those baseline passes. Dependencies and target caches were APFS COW copies in this checkout. No shared target or dependency directory was linked or mutated.

I inspected `artifacts/ask-ai/R1/final/wdio-execution.json`, `latest-run.json`, all recorded refinement outcome rows, the corresponding native spec, and all seven screenshots named in the handoff. The execution receipt records 11 passed, zero failed, zero skipped, and the runner records exit zero. The execution receipt hash and all seven screenshot hashes match the handoff. Recorded rows cover dirty-only Apply, Save, manual and generated Test cases, images and unknown metadata, stale local and stored data, Dismiss, failed Save, navigation, deleted targets, offered recovery, and abandoned preparation. Several screenshots show the lower part of the review panel, so they do not alone prove full comparison readability. The spec has explicit before/after text assertions. I did not launch or measure the native app.

## Independent comment review and limits

I applied the portable no-comments/comment-sicko prompt as this independent reviewer. No nested reviewer was spawned. There are zero new manual comments or correctness suppressions in the scoped added lines. There are zero proposed deletions, restored comments, reruns, workaround reshape flags, encoding offers, or required encodings. The generated permission header is machine-owned. Unchanged comments in moved Markdown code remain outside the added-line review. No source changes were made.

Poteto's Model the Domain principle directed the review through explicit states and both record kinds. Boundary Discipline directed checks at model parsing and guarded writes. Make Operations Idempotent directed repeat, recovery, and compensation checks. Test Behavior, Not Implementation changed the adversarial assertions to literal retained editor and saved values. Prove It Works required commit hash comparisons, actual service/controller execution, and inspection of saved native artifacts instead of accepting the handoff's pass counts. Each corresponding leaf skill was read. The how investigation ran sequentially under the explicit no-nested-agents constraint. Unslop and technical-writing guided this report. Trusted cross-turn Poteto activation was not verified.

This verdict concerns current R1 local refinement. Future Jira drafting, provider-native follow-ups, external writes, and Jira integration are outside this review. The parent and Jira owner retain the native control lane. No root source edits, root builds, native app launches, network or connector operations, commits, PRs, external writes, goals, automations, or new tasks occurred. Outside ignored build and dependency artifacts, this report is the only written file.

Whole-feature release review and the full repository gate remain separate. This report makes no performance or real-model reliability claim. The bounded review stops here.
