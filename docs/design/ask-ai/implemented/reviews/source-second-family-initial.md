# Ask AI source review B

## Verdict

FAIL for source acceptance at `73410b980896ea3dca1cc52b2a380ceabfabf196`.

The reviewed base is `1c34f3e229ccf471241f7dfc7248b4d73c2ce6d9`. One P2 is open on this head. A Save that the user has already discarded still pins the base of the row that Save committed. Compensation then restores the older stored row and keeps the newer local edit. The next Save sends the superseded base. The write is rejected. Storage stays on the restored row. The conflict text tells the user to Discard, and Discard replaces the retained edit with the restored row.

`20bbeaf` and `052f0ba` are outside this verdict. This report does not review those commits. The fresh review named by the parent owns that later head and the native lane.

## Scope

Worktree `/Users/vriesd/.t3/worktrees/qa-scribe/t3-8a41e59d` on branch `t3/8a41e59d`. `git rev-parse HEAD` and `git merge-base HEAD main` matched the pins above at report time. Tracked status was clean.

The production range is six commits.

- `ed93f43` pin headers and isolate editor history
- `0e046cb` share Ask AI with durable record context
- `6b7edb8` wait for the release marker
- `7271d0e` review and apply guarded record refinements
- `e8a8a66` retain the write base after refinement undo
- `73410b9` draft Jira content with conversational follow-ups

`git diff --shortstat 1c34f3e229ccf471241f7dfc7248b4d73c2ce6d9..HEAD` reports 131 files changed, 6744 insertions, and 308 deletions. No tracked application source was edited for this review. Uncommitted design docs under the parent tree were not opened. Source at this head is authoritative.

## P2 compensation pins the superseded base

Severity is P2. Storage is restored to the pre-Save row. The editor still holds the edit made after Discard. The following Save cannot persist that edit. Repeating Save uses the same pin. The recovery named by the product text drops the edit. The earlier P1 was a silent overwrite of a newer stored row. This defect leaves the restored row in place, so it stays P2.

### Path

`frontend/src/app/recordActions.coordination.ts`

- `reconcileDraftIntent` at lines 121–140 writes the restored draft back and does not change `latestWriteGuards`. The saved-draft ref is replaced at line 128.
- `reconcileFindingIntent` at lines 149–168 does the same for a finding. The saved-finding ref is replaced at line 156.
- `guardFor` at lines 231–235 returns `latestWriteGuards` before it reads the saved row.
- `confirmedWrite` at lines 242–250 stores the hash of the row just returned by the write. For the superseded Save that row is B. The intent's compensation `expectedStoredBase` is that same B hash. `restoredBase` is the hash of A.
- `clearStage` at lines 267–270 deletes the pin. Discard calls it before the late acknowledgement. The acknowledgement's `confirmedWrite` installs B afterward.

`frontend/src/app/recordPersistence.findings.ts` lines 35–38 call `confirmedWrite` and only then notice that the intent generation changed. `frontend/src/app/recordPersistence.drafts.ts` lines 30–33 do the same for drafts.

`frontend/src/app/recordActions.findings.ts` lines 38–54 and `frontend/src/app/recordActions.drafts.ts` lines 38–52 discard by clearing the stage, reserving a discard intent from the current saved ref, and replacing the editor row with that saved ref.

`frontend/src/app/recordWriteGuards.ts` line 6 is the conflict text. "Stored record changed. Your local changes are retained. Use Discard to review the latest saved record before requesting another refinement."

### Reproducer

The probe drives `useAppController` for a finding and for a test-cases draft. The storage double commits a write only when the sent base equals the hash of the current stored row, then returns that row. The first Save's acknowledgement is held after that commit.

1. Open the saved record A.
2. Change the title to `Superseded save B` and start `saveDirtyRecordsNow`. Wait until the update command has been called once. Storage now holds B. The acknowledgement is still pending.
3. Discard. The saved ref is still A, because the acknowledgement has not landed. Change the title to `Edit after discard during Save`.
4. Release the acknowledgement.

Compensation restores stored title A and leaves the editor on `Edit after discard during Save`. Save that editor row.

### Expected

The Save returns true. Storage title becomes `Edit after discard during Save`. The sent `expectedStoredBase` equals the hash of restored A. The guard origin is `editor`.

### Actual

Both cases failed in one Vitest run. The assertions before that Save passed, so storage was already A and the editor was already C.

Finding. `saved` is false. Stored title stays `Checkout returns 500`. Sent base is `51b0ef26571619a96b2d395c6252dcfa2458356e8b6443730fdffc82a9b9df27`. Restored A is `cf099a1a4f8494acb1d74ca6abaf6511471ee61f2e3eef074fb6136e5da74c4d`. Origin is `editor`.

Test cases. `saved` is false. Stored title stays `Checkout test cases`. Sent base is `1e567ec5e4569657c8119cd54bd16ac9f9fd9588046bb9a70fef50c193553c57`. Restored A is `ab0ab43d77b131b8dcb13140b69eedf87c9de4850e782687bfeb137145cdcc60`. Origin is `editor`.

A second Save cannot repair the pin. The conflict is thrown by the update call, before `confirmedWrite`. `guardFor` keeps returning B. The probe stopped on the first rejected Save. The later Discard that drops C is source behavior at the discard functions cited above. That second Discard was not executed in the probe.

Review A restored the same A hashes. Its sent hashes differ because its superseded title was `Superseded save`. This probe used `Superseded save B`.

### Disposition

Open at `73410b9`. Parent trail line 46 names `20bbeaf` as a later owner change for this defect and records parent-side test claims. That commit was not inspected. Acceptance of this head fails. Acceptance of `20bbeaf` is not decided here.

### Run

Command, from `frontend`, Node v26.12.1.

`NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config node_modules/.cache/final-review-b/vitest.config.mts --reporter=verbose`

The run started at 00:38:50, lasted 930ms, and exited 1. Both `REVIEW` cases failed. A `NO_COLOR` / `FORCE_COLOR` warning came from the test harness.

Probe SHA-256 `73c461a5ee6852b21189fb31eab05a5706b7ed42f173d183fa408e9f9371e720`. Copy at `/tmp/ask-ai-final-review-b/compensation.test.ts`. The config copy is `/tmp/ask-ai-final-review-b/vitest.config.mts`. Dependencies were an APFS clone of `frontend/node_modules` from a sibling checkout already at `73410b9`. No `npm install` and no shared mutable package cache. The clone was removed after those probe files were copied. Tracked status stayed clean at `73410b9`.

## Closed prior findings

### P1 stale overwrite

Closed on this head by source identity with the signed-off `e8a8a66` review. These SHA-256 values were recomputed at report time.

- `frontend/src/app/sessionChat.proposals.ts` `03e9c6b4ce0cc0f3897e6561fe59f08919e0827d041505ccb3ecb12ecfbfefc1`
- `frontend/src/app/recordActions.coordination.ts` `6d697ff9b1c406c402b66bc234ada4d0af968fb35ee1acd9022e4e50a410ec40`
- `frontend/src/app/sessionChat.proposals.test.ts` `356fef958603cf11d2958974a5d6b6244c8659d4ad1f61201cc98186ec3430ab`

`releaseStage` at lines 260–265 still keeps `pinned.expectedStoredBase` and only changes the origin to `editor`. The `73410b9` refinement diff does not change `guard_stage` or `settle_stage`. This review did not re-run the old P1 controller suite. Review A reported a rerun. That rerun is their evidence.

There is no remaining source objection to the `e8a8a66` P1 fix. The open P2 is a different pin. Discard deletes the pin, and the late `confirmedWrite` of the superseded Save puts it back.

### P2 readable fallback

Closed in source. `chat_responses::completed` no longer replaces every interpret failure with one generic sentence. An interpret error keeps a non-empty JSON `markdown` string when one is present, otherwise the raw text. Question and proposal are cleared. A separate warning is stored. Note and replay read the readable projection. The warning is rendered from `message.response.warning`. A question with a warning is not shown as chips.

`MAX_CHAT_MESSAGE_BYTES` is 16384. The finish path checks the raw assistant text, builds the completed contract, checks that text again, then checks `append_capacity` on the readable projection before insert. A readable projection that does not fit rolls the turn back. That preserves the stored boundary. It is not filed as a defect. The boundary tests were read and were not executed in this review. Review A executed them. That execution is their evidence.

## Test defect on this head

Three assertions in unchanged tests still expect schema 15 while production `SCHEMA_VERSION` is 18.

- `crates/qa-scribe-core/tests/attachment_cleanup.rs` line 284, `assert_eq!(SCHEMA_VERSION, 15)`
- `crates/qa-scribe-core/tests/creation_migrations.rs` line 51, `assert_eq!(SCHEMA_VERSION, 15)`
- `crates/qa-scribe-core/tests/creation_migrations.rs` line 283, `assert_eq!(version, 15)`

This is a test defect. It is not a production migration defect. Schema 18 questions are additive and apply when the found version is below 18. This review did not run the migration suite and did not run Cargo. There is no `target` directory in this worktree.

Parent commit `367a12aac0274b335089c37e150e818cbb486d31` was inspected with `git show` during this review. It changes those three expected values from 15 to 18 and does not change production sources. Trail line 37 says a later test-only edit superseded that three-value change. That later edit, its 32-case log, and `50d39eb` were not reviewed. They are not part of head `73410b9`.

## Behavior checked in source

These checks are source inspection from this review. They are not a passing test run.

The response contract tries V2 and then legacy V1. A new turn stores V2 with the user message id as the request id. Interpret requires one JSON object, a matching version and request id, non-empty markdown, and a raw length of at most 16384 bytes. A refinement is refused unless the purpose is Refinement. A question is refused on version 1.

Question choices are 1 to 8. Each choice is trimmed, at most 160 characters, free of control and bidi characters, and unique. The prompt must be non-empty after trim. The prompt itself has no length or single-line limit in the parser that was read. Chips render the visible payload. A later user message expires the question. Typed equality uses the trimmed composer and is case-sensitive. A different target refuses chips and correlation. Ordinary Send still works. Correlation carries the original user-message snapshot through preflight, recheck, and the transaction. `validate_owner` checks session, row, and draft kind. An occupied composer, images, in-flight work, and failures stay in place.

Finding subtask is display-only Recommended on a finding. Prepare fills the composer. Send and the existing tool-permission path govern effects. There is no automatic resend and no new Jira command. `allow-resolve-refinement` is present in `src-tauri/permissions/default.toml`. The generated permission file carries the usual generated header. Real Jira qualification was out of scope and was not demanded.

Apply remains review then dirty-only apply, with the expected-base transaction for both record kinds. The open defect is the frontend pin after compensation, not the core compare. The core compare rejects a mismatched base, which is what the probe observed.

## Comment audit

Comment Sicko was applied by this reviewer. The parent forbade a nested agent. A second agent was not run. This section is not an independent second signature.

Babel parsed the 54 changed `*.ts`, `*.tsx`, and `*.mjs` files. Added lines contain 0 comment nodes.

A whole-diff text scan found one added comment-like line. It is the generated header `# Automatically generated - DO NOT EDIT!` in `src-tauri/permissions/autogenerated/resolve_refinement.toml`. Keep that header. A start-of-line scan of added Rust, CSS, and TOML lines reported 0 because that header did not match the filter. An earlier scan false-positived `*choice = choice.trim().to_owned();` in `response.rs`. That line is code.

Added lines contain no new `eslint-disable`, `ts-expect-error`, `oxlint-disable`, or `#[allow]`. C1 reported four pre-existing oxlint suppressions in `useAppController.ts` as unchanged from the base. Those four were not re-audited line by line.

MUST KILL 0. No added comment was recommended for deletion.

## Decision trail

`/tmp/qa-scribe-ask-ai-plan-20261024/decisions.tsv` was read through line 47. The file had 47 lines at the last count before this paragraph was corrected. The last row is `2026-10-24T22:44:40Z`. The trail is append-only and was still moving during the review. Rows after line 47 are outside this audit.

Rows through the Jira commit on line 33 record planning, S1, C1, R1, the P1 fix, and `73410b9`. Later rows are classified below. Named logs and artifacts were not opened unless the row says they were.

Parent claims in the trail are not measurements from this review.

- Line 34, `2026-10-24T22:24:36Z`. Full frontend 951 is a parent claim. The same row says the release script suite failed on five macOS temp-path assertions and two `EPERM` cleanup results, and that the gate failed at `release:check`. This review did not run those 951 tests and did not open `/tmp/ask-ai-integrated-verify.log`.
- Line 35, `2026-10-24T22:26:04Z`. A script retry overlapped native port 4445 and is rejected as diagnostic evidence. This review did not open the named logs and did not run root diagnostics.
- Line 36, `2026-10-24T22:26:47Z`. Seventeen migration cases are a parent claim. At `73410b9` the three assertions above still expect 15. This review did not run those 17 tests.
- Line 37, `2026-10-24T22:27:29Z`. Thirty-two migration cases, removal of two redundant constant assertions, and `SCHEMA_VERSION` / `SCHEMA_VERSION + 1` are a parent claim. The log was not opened. The row supersedes the three-value-only follow-up. The production diff at `73410b9` does not include it.
- Line 38, `2026-10-24T22:29:00Z`. Performance preparation and commit `a99ac02` were not reviewed. The named log and seed file were not opened.
- Line 39, `2026-10-24T22:30:10Z`. Review A recorded FAIL at `73410b9` for this compensation defect and closed the initial P1 and the readable-fallback P2. This review reproduced the compensation failure independently. Review A's other pass counts are not this reviewer's proof. The owner fix named there was not read.
- Lines 40–43. Native composer measurements, `/tmp/ask-ai-native-shipping-review.md`, and commit `052f0ba` were not reviewed. Line 43, `2026-10-24T22:37:08Z`, records a parent visual acceptance with 82 captures at 320 and 360. This review did not inspect captures, widths, or themes.
- Line 44, `2026-10-24T22:38:24Z`. A serial Node 24 run is described as one remaining startup `EPERM`. Line 45 supersedes that description.
- Line 45, `2026-10-24T22:38:46Z`. The trail says the serial Node 24 canonical-TMP script command is 552 tests, 549 pass, 2 fail, and 1 skip. The two failures are an LSP stdin failure and the startup cleanup `EPERM`. The trail says both were reproduced on initial `1c34f3e` and that no assertion was disabled. The named logs `/tmp/ask-ai-scripts-serial-node24.log`, `/tmp/ask-ai-baseline-lsp-probe.log`, and `/tmp/ask-ai-baseline-cleanup-probe.log` were not opened here. Full gate success is not claimed by the trail and is not claimed here. This review did not rerun `release:script-tests`.
- Line 46, `2026-10-24T22:41:58Z`. `20bbeaf` is an owner change after this head. The row's 114 focused tests, 50 parent tests, and 3 hash match are parent claims. This review did not inspect the commit or `/tmp/ask-ai-compensation-base-fix.json`. The row itself says acceptance is still open and that a fresh source and native review at `20bbeaf` is active.
- Line 47, `2026-10-24T22:44:40Z`. The trail says 971 frontend tests and the full frontend check pass at `20bbeaf`, and that an optimized-head build was hashed. No native performance run is claimed on that row. The named logs were not opened. This review did not run that gate and does not accept `20bbeaf`.

The parent update received with this report adds a native claim of 82 captures across 320, 360, 768, and 1280 in both themes, plus 50 guard tests at the later head. Those figures were not measured here and do not change the `73410b9` verdict.

Handoff files `/tmp/ask-ai-jira-handoff.json` and `/tmp/ask-ai-r1-handoff.json` were counted earlier in this review and were not used as proof.

## Evidence from this review

Inspected and used.

- Worktree identity, merge-base, tracked status, shortstat, and commit list.
- The three P1 file hashes.
- `recordActions.coordination.ts`, both persistence modules, both discard modules, and `recordWriteGuards.ts` at the lines cited.
- The two-case controller probe and its failure output.
- The three schema-15 assertion lines.
- `git show` of `367a12a` as a tests-only three-line follow-up. Production sources at `73410b9` stay the reviewed diff.
- Comment audit counts above.
- Decision trail through line 46.
- Prior reports S1, S1 r2, C1, R1, P1 r2, and review A, as history. Their pass counts were not adopted.

Inspected earlier in this review and not re-executed for the report. Protocol, question, permission, replay, and migration source as summarized in the behavior section. The readable-fallback implementation. `releaseStage` retention of the editor base.

Not inspected. Cargo and core suites. The 951 frontend suite. Migration execution. Native geometry and captures. Real Jira. `20bbeaf`, `052f0ba`, `a99ac02`, and `50d39eb`. The parent's uncommitted coordination edit. Design docs. The logs named by the trail. Rows appended after line 47.

## Method

Poteto critique ran in this reviewer, one pass, because nested agents were forbidden. Trusted cross-turn sticky activation was not verified. The generic portable profile was the fallback.

Principles that changed a decision.

- Prove It Works. The verdict uses this worktree's hashes and the controller failure. Handoff files and parent suite counts do not pass the head.
- Model the Domain. The editor base, the compensation expected base, the origin, and the stage pin are separate. The late `confirmedWrite` updates the pin. Reconcile updates the saved row.
- Boundary Discipline. Invalid envelopes stay readable. Guarded writes still reject a mismatched base. The open defect is the frontend pin, not the parser.
- Make Operations Idempotent. Restoring A does not make the next Save of C succeed. A repeated Save sends B again.
- Test Behavior Not Implementation. The probe asserts titles, the sent base, the restored base, and the save result.
- Explain the Number. 131 files, 6744 insertions, 308 deletions, 2 failed probe cases, 0 added comment nodes in 54 files, 3 schema assertions, and 47 trail lines were counted here. 16384 is the source constant and was not re-executed. 951, 17, 32, 50, 114, 552, 549, 2, 1, 82, and 971 were not counted here.
- Fix Root Causes. The pin is installed by `confirmedWrite` after Discard has cleared it. Reconcile does not replace that pin with the restored row. Describing only the conflict message would hide that order.

## Limits

This is a source review of `73410b9`. It is not native signoff, CI signoff, or release signoff. Root full-gate success is not claimed. No tests were disabled by this review. The native reviewer held the exclusive port. No root diagnostics were run.
