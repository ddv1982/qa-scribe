# R1 P1 independent round-two review

PASS for the bounded P1 source re-review. No remaining P1 finding was reproduced in the reviewed changes. Conflict, Undo, and another Save preserve the newer stored record for both Findings and Test cases. This verdict closes the R1 stale-overwrite finding at this commit. It is not P2, whole-feature, native, or release signoff.

Reviewed base `7271d0ef4cf92a25a15c7c17cc15c0f46fb555eb`.
Reviewed head `e8a8a6603805a79b531fef7c4ae2fcb0099c716f`.
Isolated checkout `/Users/vriesd/.t3/worktrees/qa-scribe/t3-4416f07c`.
The checkout started and finished at that exact head with no tracked changes.

The brief's `base7271...` is not a Git ref. I interpreted it as the base label followed by commit `7271d0e`, which is also the fix receipt's base and the head's immediate parent.

## P1 disposition and source reasoning

The original P1 reproduction was Apply from A, change storage to B, Save to observe a conflict, Undo, then Save again. Previously Undo deleted the guard, allowing the second Save to hash B and overwrite it with A. That unsafe transition is removed.

`frontend/src/app/recordActions.coordination.ts:13` defines `EditorWriteBase` independently of proposal origin. `bindStage` at line 253 preserves any existing pinned expected base. `releaseStage` at line 260 removes the stage and replaces the origin with `editor`, while retaining the pinned session and expected base. Its fallback uses the proposal snapshot's base when there is no pin. It does not derive the fallback from the saved-record ref that a conflict has advanced to B.

`frontend/src/app/sessionChat.proposals.ts:31` obtains that fallback from the immutable proposal context, with the stage token as fallback. Undo calls `releaseStage` at line 97 after restoring the before value. Abandon calls it at line 101 while retaining the editor. These calls happen before the status request, so rejection of that request does not restore the unsafe guard deletion.

`adoptConflict` at `frontend/src/app/recordActions.coordination.ts:214` updates the saved-record ref and retains dirty local content. `guardFor` at line 231 still returns the existing pin first. Thus the second Save after Undo sends A's token with editor origin. It does not send B's token. B remains stored and the Save returns false.

Explicit record Discard remains the deliberate reset. `frontend/src/app/recordActions.findings.ts:38` and `frontend/src/app/recordActions.drafts.ts:38` clear the pin and install the saved row. Confirmed writes advance the next base through `confirmedWrite` at `frontend/src/app/recordActions.coordination.ts:242`. Normal successful settlement then clears the stage after updating saved refs. Undo or late stage installation cannot run through a pending write unnoticed. The local checks and generation comparisons at `frontend/src/app/sessionChat.proposals.ts:59`, line 87, and line 108 reject those schedules.

I also read the unchanged persistence and core boundaries. Both persistence implementations capture a guard before the transport write, adopt conflicts without replacing the local editor, and confirm only successful responses. `crates/qa-scribe-core/src/services/session_service/record_bases.rs:49` compares the stored token before allowing the update. `chat_refinements.rs:176` additionally checks proposal-stage origin and state when present. Removing proposal origin on Undo permits an ordinary guarded editor Save after the stage becomes undone. Preserving a mismatched old token on a replacement stage remains conservative and cannot authorize overwriting B.

## Behavioral evidence

I reran the actual `useAppController` suites and inspected their assertions and storage-outcome mocks. The P1 tests assert literal B title, body, the entire stored row, and a false Save result. They do not establish success solely from mock call counts.

The seven focused suites passed all 88 tests. They cover `sessionChat.proposals`, `ChatProposalReview`, `recordPersistence`, controller compensation, record editing, settlement, and `editorDocument`. This includes both record kinds for the original reproduction, failed Undo status with later edits and abandonment, explicit Discard followed by an edit of B, successful Undo followed by Save, confirmed-write advancement, and replacement or recovered stages bound to B.

I added disposable probes under this checkout's ignored dependency cache. They import this commit's actual controller and helpers. Ten added race and image cases plus four adapted replacement/recovery cases passed. The final probe run reports 14 passed and 19 intentionally filtered baseline cases.

For each record kind, the probes verified these outcomes:

- A pending write blocks Undo without replacing the refined editor. Once the write conflicts, Undo restores A and another Save still leaves the whole B row unchanged. A and B have distinct managed images and B has distinct metadata. Discard then installs B, and an explicit title edit saves while retaining B's exact body JSON and metadata. No attachment deletion occurs.
- Save can complete during the Undo status request. A later local edit survives status failure. Its next Save uses the newly confirmed base and persists the later title while retaining A's image.
- After Undo status failure, the stage is prepared-only. Keep current edits can abandon it during an editor Save. That Save persists the retained editor. If another client then writes B, the next local Save conflicts and preserves B and its image.
- A confirmed Save during stage preparation prevents the returned stage from installing stale content. The next manual Save uses the confirmed base.
- A Save during Undo's initial chat freshness await defeats Undo through its changed intent generation, even when the local content still equals the proposed after value.
- Offered replacement and recovered staged proposals using B's token cannot replace an existing A pin. The attempted Save leaves B's whole row and image unchanged in all four variants.

The probes model expected-base comparison at the Tauri transport boundary. They execute controller behavior, not the native app or Rust service. They do not emulate all core proposal-state validation. The unchanged Rust source was inspected separately. No backend integration or native execution is claimed.

The temporary probe initially failed to load its setup file when launched from the repository root. Running from `frontend` resolved that configuration issue. The first image fixture also omitted A's image from the proposal's after document. The real core retains that image. I corrected the fixture to match the core's output before using it for the verdict. Those failures are probe issues, not product findings.

Logs are `/tmp/ask-ai-r1-p1-review-r2-baseline.log` and `/tmp/ask-ai-r1-p1-review-r2-probes.log`.

Rerun the focused suites from this checkout's `frontend` directory:

```sh
NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run src/app/sessionChat.proposals.test.ts src/views/ChatProposalReview.test.tsx src/app/recordPersistence.test.tsx src/app/useAppController.sessionIntegrity.compensation.test.ts src/app/useAppController.workflows.record-editing.test.ts src/app/useAppController.workflows.settlement.test.ts src/editor/editorDocument.test.ts
```

Rerun the disposable probes from the same directory:

```sh
NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config node_modules/.cache/r2-review/vitest.config.mts -t REVIEW
```

`git diff --check 7271d0e..e8a8a66` passed. Dependencies were an APFS copy from the prior isolated R1 review checkout, not a symlink to the parent's active tree. No dependency installation or network access occurred.

## Hash verification

All three local file hashes match `/tmp/ask-ai-r1-p1-fix.json` and their blobs at `e8a8a66`. Their base hashes also match the receipt and blobs at `7271d0e`.

- `frontend/src/app/sessionChat.proposals.ts` has SHA-256 `03e9c6b4ce0cc0f3897e6561fe59f08919e0827d041505ccb3ecb12ecfbfefc1`.
- `frontend/src/app/recordActions.coordination.ts` has SHA-256 `6d697ff9b1c406c402b66bc234ada4d0af968fb35ee1acd9022e4e50a410ec40`.
- `frontend/src/app/sessionChat.proposals.test.ts` has SHA-256 `356fef958603cf11d2958974a5d6b6244c8659d4ad1f61201cc98186ec3430ab`.

The ignored probe file `frontend/node_modules/.cache/r2-review/proposals.test.ts` has SHA-256 `c06b596a467995c695ee7c421389b96948a3d43242be46e4c5333787c201fdc6`. Its config has SHA-256 `9bc53fea356b4f2b021a7ed32da1626ab0315e21ec7648610747506d62f4970c`.

## Independent Comment Sicko analysis

Yes... Ha ha ha... Yes!

I read the supplied generic Comment Sicko prompt and applied it myself, as explicitly requested. The scope was every added line in the three-file P1 diff, with surrounding code read for context. There are zero new manual comments, lint suppressions, TypeScript suppressions, or comment-based constraints. There are zero deletion candidates or MUST KILL flags. There were no deletions, restores, review reruns, architect sketches, code fixes, encoding offers, encodings, or open constraints. Application source was untouched. No nested agent was used.

## Principles and limits

Model the Domain directed the review through the separate editor base, write origin, and proposal stage, rather than treating stage deletion as editor settlement. Test Behavior, Not Implementation changed the added probes to assert literal stored values, whole B rows, image content, and actual Save results. Prove It Works required local and committed hash comparisons, controller execution, and reading the core comparison path instead of accepting the fix owner's receipt. I read all three leaf skills in full. The how investigation ran sequentially under the explicit no-nested-agents constraint. Unslop and technical-writing guided this report. Trusted cross-turn Poteto activation was not verified.

This review did not change tracked source, commit, build or launch native code, contact connectors or external services, write externally, create tasks, or spawn agents. Writes were limited to the isolated ignored dependency and probe cache, test logs, and this requested report. Typecheck, lint, backend tests, the full repository gate, and native UI validation were not rerun. The separately assigned P2 readable-response fallback remains outside this verdict. Parent root source and native work were not touched.
