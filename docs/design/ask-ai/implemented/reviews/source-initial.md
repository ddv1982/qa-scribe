# Independent whole-feature source review A

FAIL for source acceptance at `73410b980896ea3dca1cc52b2a380ceabfabf196`. One reproducible P2 remains. I found no new P0 or P1. The prior R1 P1 stale-overwrite objection remains closed. The prior R1 P2 readable-response fallback objection is independently closed by this review.

The exact base is `1c34f3e229ccf471241f7dfc7248b4d73c2ce6d9`. The isolated checkout is `/Users/vriesd/.t3/worktrees/qa-scribe/t3-cb67bef8`. It started and finished clean at the requested head. No tracked application source or test was edited, and no commit was made.

## Open P2. Compensation restores storage but leaves the next editor Save pinned to the superseded write

The affected paths are `frontend/src/app/recordActions.coordination.ts:125` and `:153`. The successful compensation branches install the restored saved row at lines 128 and 156, but do not advance `latestWriteGuards` to that confirmed restored row. `confirmedWrite` at line 242 previously pinned the value returned by the original, superseded Save. `guardFor` at line 231 continues returning that pin on every subsequent Save.

Minimal reproduction for either Findings or Test cases:

1. Begin with saved record A. Edit its title to B.
2. Start the ordinary dirty-record flush, `saveDirtyRecordsNow`, and hold the acknowledgment after storage has committed B. This flush does not set the manual Save button's busy state.
3. Discard the editor to A while the acknowledgment waits. Author a new title C.
4. Release the B acknowledgment. The existing compensation path correctly restores A in storage and retains C in the dirty editor.
5. Save C.

Expected behavior is a successful Save of C using A's confirmed restored base. Actual behavior is `false`, a stored-record conflict, and storage still containing A. The outgoing guard names B's base. Repeating Save cannot repair this pin. The error instructs the user to Discard, which removes C. The newer edit survives in memory, but cannot be saved through the normal flow without discarding or reconstructing it.

This is introduced by the new guard lifecycle. It is separate from the prior Conflict, Undo, Save stale-overwrite issue. It also affects ordinary record edits, so it is a compatibility regression outside the explicit refinement action.

I reproduced both kinds through this head's actual `useAppController`. The transport mock commits the first write before delaying its acknowledgment, compares expected bases on every write, and applies the compensation patch. It does not return canned success for compensation. Before the last Save, each probe asserts that storage has A and the editor has C. The last Save fails its literal `true` assertion.

The Finding probe records stored title `Checkout returns 500`, local title `Edit after discard during Save`, and `saved:false`. Its sent base is `a815eb7c3730f756196cc308d04bd03d0fde755cb6964d8aa973bae83e399492`. The restored A base is `cf099a1a4f8494acb1d74ca6abaf6511471ee61f2e3eef074fb6136e5da74c4d`.

The Test cases probe records stored title `Checkout test cases`, the same retained local C title, and `saved:false`. Its sent base is `e2e101ecff6aaca8922758132cd74015eb3afc837ba65ad81ee2892ddb7e2194`. The restored A base is `ab0ab43d77b131b8dcb13140b69eedf87c9de4850e782687bfeb137145cdcc60`.

A separate probe against the actual core service confirms the transport model. After a successful compensation to A, B's guard conflicts, while A's guard successfully saves C. This finding is in frontend coordination, not the core compare-and-write behavior.

Disposition is fix required. A confirmed compensation must update the editor's write-base lifecycle with the restored record, subject to current-intent ownership. Keep the P1 rule that an actual conflict or proposal-stage release cannot adopt an unreviewed remote base. Cover both kinds, newer edits retained during compensation, compensation retries, and later intent generations. No application fix was made in this review.

The reproducible controller probe is `frontend/node_modules/.cache/final-review-a/proposals.test.ts`. The final diagnostic log is `/tmp/ask-ai-final-review-a-compensation.log`.

## Prior finding dispositions

The S1 cross-record Undo overwrite and edit-session history defects remain closed in source. `RichRecordView` supplies record and edit-mode history ownership while retaining the editor DOM. `RichTextEditor` replaces the history plugin on scope changes. The real-editor history suite passed at this head. The sticky header and zero-gap CSS structure remain present. I did not measure native geometry.

The C1 bounded source pass remains consistent with this review. Ask AI mounts the existing Session chat once. Manual and generated records use the same saved-record selection and context path. Capture reads the unsaved rich editor synchronously before composer persistence. History retains immutable per-message context. Closing or expanding the panel does not reset the composer or conversation. Notes capture Session context.

The R1 P1 stale overwrite remains closed. `sessionChat.proposals.ts`, `recordActions.coordination.ts`, and their regression test are byte-identical to `e8a8a66`. Stage release preserves the dirty editor's original expected stored base. A conflict can update saved refs without authorizing a later overwrite. Explicit Discard resets that base, and a confirmed Save advances it. I reran the exact-head maintained P1 cases and the prior isolated review's 14 additional image, recovery, replacement-stage, Undo-status, and pending-write probes with imports rewritten to this checkout. All 14 additional cases passed. This is a current execution, not reliance on the prior review's pass count.

The R1 P2 fallback is closed. `chat_responses.rs:77` retains readable `markdown` from an invalid completed envelope when available, otherwise the raw response. It creates no proposal or question and stores a separate short warning. `chat_turns.rs:139` validates the original bytes before interpretation, validates the displayed result, checks readable-message capacity, and persists only after the active attempt and AI Run ownership checks. The warning does not consume the assistant message's 16 KiB allowance.

My core probes independently verified the original plain explanation on an explicit Finding refinement, malformed JSON retained as raw text, wrong-nonce Markdown retained without controls, 16,384 ASCII bytes, and 8,192 two-byte characters. Loaded history and replay retain the expected text. Note handoff retains the visible content in the rich document while preserving the existing Note. The over-limit 16,385-byte and 8,193-character two-byte responses reject atomically without changing the running chat. A question whose literal Markdown projection would exceed 16 KiB also rejects before persistence. I initially suspected replay poisoning here, but the per-message check in `append_capacity` correctly prevents it. It is not a finding.

## Whole-feature data flow and compatibility

The review followed the separate domain shapes `ChatTarget`, response contract and purpose, question and answer correlation, proposal state, editor stage, expected stored base, write origin, and record intent generation. Their ownership matters more than treating every transition as a generic chat update.

The completed-response parser consumes a whole JSON object, rejects unknown fields, and checks version and request nonce. Refinement patches are kind-specific and allowed only for explicit refinement purpose. Finding metadata merges preserve unknown fields. Managed image nodes are retained by the core merge and frontend document path. Apply changes only the dirty editor. Save for both record kinds compares the stored base and settles proposal state inside the same transaction. The new compensation finding concerns the next frontend base after a successful restoration.

For V2 questions, the service validates one through eight distinct visible strings, with a 160 Unicode-scalar bound and single-line restrictions. The normalized displayed string is the complete chip payload. The Finding subtask recommendation is a separate display badge for Finding sources. There is no hidden action value or callback in a choice. Any later user turn expires the old question. Typed equality trims for matching and remains case-sensitive. Different targets refuse chips and correlation while ordinary Send uses the current target.

The question resolver selects the original immutable source context. Tauri capture, verified recheck, and the service's transactional resolver all use that selection. A new local snapshot cannot replace the correlated source snapshot. Retry retains the user message, contract nonce, context, and answer association. The checked paths retain occupied text, images, image failures, and pending work. My added lost-acknowledgment probes retained text authored during a chip start both when the start had committed and when it had not. Neither case resent automatically. An edit authored while Prepare action message was saving also survived and was persisted.

Prepare action message fills an editable composer. Its Send is an ordinary message. Existing provider selection, images, tools, approval, denial, cancellation, and explicit retry remain the execution path. Jira drafting adds no Jira client or catalog and makes no app-verified Jira-result claim. The source instructions distinguish agent observations and ambiguous outcomes. No real Jira qualification is required or claimed.

The migration is additive through schema 18. Historical messages are not reparsed into controls. The legacy V1 contract deserializer and completion path remain. Focused migration tests exercise schema 15 context migration, schema 16 to 17 preservation, and schema 17 to 18 preservation with legacy contracts and historical prose. Existing migration definitions 16 and 17 were not repurposed. Production command wrappers, generated bindings, permissions, generated-record canonicalization callers, Note projection, fixtures, runner changes, and the surrounding editor paths were included in the source review.

## Independent execution and provenance

Local dependency and core-target caches were APFS copy-on-write copies from prior isolated review checkouts. They were not symlinks to the parent's mutable dependencies or target directory. Commands ran only in this isolated checkout.

The first focused frontend run passed 9 files and 70 tests. The files were `sessionChat.proposals`, `sessionChat.questions`, `useAppController.chat.context`, `recordPersistence`, `useAppController.sessionIntegrity.compensation`, `useAppController.workflows.settlement`, `RichRecordView.history`, `ChatProposalReview`, and `ChatQuestion`. The command also supplied a nonexistent `useSessionChat.test.ts` filter, which selected no additional file and is not included in the count. The log is `/tmp/ask-ai-final-review-a-frontend.log`.

A second focused frontend run passed 7 files and 142 tests for chat lifecycle, images, image recovery, permissions, permission recovery, permission UI, and Ask AI shell ownership. The log is `/tmp/ask-ai-final-review-a-chat-regression.log`.

The four core integration suites `chat_context`, `chat_questions`, `chat_refinement`, and `record_write_guards` passed 25 tests. An earlier progress message said 26. The actual log and this report use the correct count of 25. The log is `/tmp/ask-ai-final-review-a-core.log`.

The ignored controller review suite executed 19 selected cases. Seventeen passed, comprising the 14 P1 cases and three new async-input cases. The two compensation cases failed. Fifty copied baseline cases were intentionally filtered, not disabled. The log is `/tmp/ask-ai-final-review-a-adversarial.log`. The final focused diagnostic rerun again failed the same two compensation cases with explicit saved values and base tokens in `/tmp/ask-ai-final-review-a-compensation.log`.

Five disposable core probe tests passed. They cover fallback storage, replay and Note handoff, byte boundaries, refinement purpose, the rejected oversized readable-question hypothesis, and the backend compensation comparison. Their source is `target/final-review-a.rs`, and the executable is `target/final-review-a`. The log is `/tmp/ask-ai-final-review-a-core-probes.log`.

The initial disposable probe had a wrong working-directory assumption, then assumed a legacy HTML Note had rich JSON. Two async probes also assumed the harness deferred helper exposed `reject`. I corrected those probe errors before using their outcomes. They are not product findings. All frontend runs used `NODE_OPTIONS=--no-experimental-webstorage` for Node 26. Vite option-deprecation warnings were nonfatal.

Rerun controller adversarial cases from `frontend`:

```sh
NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config node_modules/.cache/final-review-a/vitest.config.mts -t REVIEW
```

Rerun core suites and the compiled probe from the checkout root:

```sh
cargo test --offline -p qa-scribe-core --test chat_context --test chat_questions --test chat_refinement --test record_write_guards
target/final-review-a --nocapture
```

All 55 Jira-handoff source hashes match both local files and committed blobs at the reviewed head. I also saved SHA-256 values for all 131 changed destination files, with local-to-head equality, in `/tmp/ask-ai-final-review-a-source-hashes.json`. No hash mismatch was found. `git diff --check 1c34f3e HEAD` passed.

Key SHA-256 values:

```text
6d697ff9b1c406c402b66bc234ada4d0af968fb35ee1acd9022e4e50a410ec40  frontend/src/app/recordActions.coordination.ts
03e9c6b4ce0cc0f3897e6561fe59f08919e0827d041505ccb3ecb12ecfbfefc1  frontend/src/app/sessionChat.proposals.ts
2d11e1887a8e1e92d7265a750e08964ef4af3b77888a0f6448573557b8e2906b  crates/qa-scribe-core/src/services/session_service/chat_responses.rs
d21e2b5dd52873d78bcc4636513002f13162d5f67081d4487dfc636530cf59a4  crates/qa-scribe-core/src/services/session_service/chat_turns.rs
e917e26109fffec7c5128f668970ee5a35d8abe6769d4fecc48b820bbf1c88e5  frontend/node_modules/.cache/final-review-a/proposals.test.ts
dbd358c0415c7a390767a6877e51fb15151c7f07f6f439d5cc5bd9eb78d901c2  frontend/node_modules/.cache/final-review-a/p1-regression.test.ts
efce52e779324a893dc5a4f68374943498d1ad907523799262b8046a6805d567  frontend/node_modules/.cache/final-review-a/questions.test.ts
a617dba7acba90595bb4c6f1b1eeb375bdc043fe1ac5bf2d018a759d5e9fd1aa  frontend/node_modules/.cache/final-review-a/vitest.config.mts
9da5f7d6b0dc6ec6b4546dd8fdaf9a2b7457d0b231383dfcfd23c56c3c3ab2b4  target/final-review-a.rs
```

## Independent Comment Sicko analysis

Yes... Ha ha ha... Yes!

I read the complete no-comments skill and its generic `references/comment-sicko-prompt.md`, then performed the analysis myself under the user's explicit portable-profile and no-nested-agent instructions. This is the independent source-review delegate's analysis, not a claim of a second nested review or model diversity.

The scope was every added or changed comment and suppression in the whole base-to-head diff. A Babel comment-node audit parsed all 71 changed JavaScript and TypeScript files and found zero comment nodes intersecting added lines. I also inspected the renamed Rust Markdown code, Rust and CSS comment candidates, TOML, and suppression markers. The moved Markdown comments are unchanged from their original paths.

Added manual comments are 0. Modified manual comments are 0. Removed manual comments are 0. Added or modified lint and TypeScript suppressions are 0. Added generated comments are 1, the permission TOML header. I verified its exact text in the installed `tauri-utils-2.9.3/src/acl/build.rs:293` generator and its command registration in `src-tauri/build.rs`. That machine-owned header is retained. The parsed audit is `/tmp/ask-ai-final-review-a-comment-audit.json`.

Proposed deletions, actual deletions, restored comments, MUST KILL comment or suppression flags, comment-review reruns, architect sketches, application fixes, encoding offers, encodings, and unenforced comment constraints are all 0. Pre-existing suppressions are outside the added-comment scope.

## Principles and limits

I read Poteto's complete Principles index and the applied leaf skills. Model the Domain changed the review to track editor base separately from stage and compensation state. Test Behavior, Not Implementation changed the adversarial checks to assert retained text, literal storage outcomes, and actual Save results. Prove It Works required current committed hashes and local service/controller execution instead of accepting handoff counts. The how investigation ran sequentially under the no-nested-agent fence. Technical-writing and unslop shaped this report. Throughput checkpoint is n/a for this read-only investigation. Trusted cross-turn Poteto activation was not verified.

The parent reports a later tests-only commit `367a12a` that changes three old schema-15 expectations to 18 in `attachment_cleanup.rs` and `creation_migrations.rs`, with 17 targeted migration tests passing. The parent also reports 951 frontend passes, a workspace rerun in progress, pre-existing macOS 27 cleanup EPERM reproduced at the initial main, and path-alias assertions resolved by canonical TMPDIR. These are parent-reported follow-ups. They do not change this exact reviewed head or count as my proof. The overlapping native-port diagnostic retry is excluded. Full-gate success is not claimed.

This is a source review, not native, CI, performance, real-model reliability, Jira integration, or release signoff. I compiled and ran core-library tests and a disposable core probe. I did not build or launch the native application, use the parent's native port, open a browser, access connectors, perform network or external writes, create a PR, spawn agents, or commit. Writes were limited to ignored isolated dependency and target artifacts, disposable probes, and `/tmp` logs and reports. The parent's five uncopied performance files and uncommitted architecture documents are outside this review. Source behavior at `73410b9` governs the verdict.
