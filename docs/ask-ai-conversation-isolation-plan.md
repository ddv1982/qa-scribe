# Separate Ask AI conversations from Notes

Delegation, lifecycle, isolation, history, and capability fallbacks follow the installed Poteto runtime contract linked in Appendix D.

Give testers a fresh conversation when they explicitly start Ask AI on a Finding or test case.
Keep Notes messages, unfinished input, images, and submission state in Notes.
Reuse the existing provider, transcript, image, permission, question, and refinement engine.
Deliver I1, then I2, then I3. These are proposed PR identifiers, not opened pull requests.
This document is a plan. It changes no application behavior and authorizes no release.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs the installed `skills/poteto-mode/playbooks/feature.md`, followed by Opening a PR. The paths are plugin resources, not files in this repository. Resolve them from the installed skill root in Appendix D. Stop every PR at merge-ready. The operator owns interaction review and merge authorization for this new work.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

Use the proposed lifecycle in Appendix A as the acceptance contract. The choice of fresh launch over automatic per-record resume follows the user's stated expectation. The prototype does not prove that preference or backend correctness. Retain literal persisted-state assertions from the existing Save, Undo, compensation, and retry tests.

## Program checklist

### Arm the program

- [ ] Present this plan and the lifecycle for operator review. Start implementation only after an explicit go.
- [ ] Record the execution baseline with `git rev-parse origin/main` and `git status --short`. Investigation baseline is `51189e3a388c12a53dd7c18eeb79571bad437902`.
- [ ] Do not create a goal, heartbeat, queue table, or hourly audit for this planning request. Skip those program-template lifecycle steps. They require separately authorized unattended execution.
- [ ] Read project guidance from trunk with `git show origin/main:CONTEXT.md`, `git show origin/main:docs/development.md`, and the relevant source at the recorded SHA.
- [ ] Read the installed Feature, runtime contract, how, architect, swarm, technical-writing, no-comments, and benchmark-checklist resources at execution start. Re-read applicable resources before their gates. Do not run nonexistent repository-local skill paths.
- [ ] Validate the live model catalog before delegation. Use OpenAI models only. Do not claim cross-family review when the available reviewers share a model family.
- [ ] On an operator hold, stop new writes and reconcile every owned worker through supported task status. Save a handoff without starting another task.

### Spawn owners

- [ ] Assign one owner to each phase. Use I1 as the base of I2 and I2 as the base of I3. Run them serially or stack only after the parent's exact-head gate passes.
- [ ] Hold each phase to its file list and direct generated bindings. Record a concrete reason before widening ownership. Parent owns integration and external writes.
- [ ] Partition read-only investigation from writes. Give each writable owner a separate worktree or exclusive modules. Keep native application runs serialized under one owner.
- [ ] Review I3's interaction in chat with screenshots and a video before merge. I1 and I2 preserve the visible released interaction while adding the durable foundation.

### PR mechanics, for every PR

- [ ] Resolve the forge with `gh`. Record a fallback only if that installed capability is unavailable. Register every created or worked PR through T3 `link_pull_request`.
- [ ] Run focused checks while editing. Before the PR-facing push, run the repository's required checks and retain exact logs. Keep Git hooks enabled.
- [ ] Run deslop before committing and independent no-comments review before source review. Record unavailable capabilities rather than self-certifying them.
- [ ] Triage automated comments against an actual reproduction. Preserve intentional question-snapshot, Saved-stage recovery, and failure-stop contracts unless this plan explicitly changes them.
- [ ] Update the PR title and body around its final diff. Keep screenshots synthetic. Exclude all content from the user's screenshot from fixtures.

### Verdict and merge, for every PR

- [ ] Review the exact head independently. Include storage, asynchronous conversation routing, and UX ownership in the coverage matrix. Resolve proven defects before advancing.
- [ ] Run all ten live scenarios and the phase performance check at that head. Queue lanes within actual capacity. Ten scenarios do not authorize ten simultaneous apps on a shared host.
- [ ] Preserve prior evidence only under a documented source or artifact-equivalence check. New runtime changes require fresh applicable live and performance evidence.
- [ ] Require current protected CI success and an independent verdict. Stop at merge-ready. Do not inherit the completed v0.8.22 publication authority as permission to release this redesign.

### Boot recipe, for every live lane

Each live lane uses the exact head and isolated app data. Detect native control before claiming native proof. Use the repository's maintained built-app driver for the native application. T3 HTML preview is only a design-prototype capability.

- [ ] Fetch and select the exact branch and SHA in the isolated checkout. Install the repository-pinned toolchain and dependencies from `docs/development.md`. Record any host mismatch.
- [ ] Set the lane's named spec explicitly. On macOS use `QA_SCRIBE_E2E_SPEC=<spec> bun run e2e`. On Linux use `GDK_BACKEND=x11 QA_SCRIBE_E2E_SPEC=<spec> xvfb-run -a bun run e2e`. Keep the same spec on both commands.
- [ ] Add the new specs and deterministic provider-fixture routing in `scripts/run-e2e.mjs`. Use isolated app data and synthetic Codex responses. Never call real Jira or a real provider for these tests.
- [ ] Save screenshots, execution receipt, UI state, and read-only SQLite diagnostics under `artifacts/ask-ai-conversations/<phase>/lane-<n>/`. Retain spec, source SHA, binary hash, command, and pass predicate.
- [ ] Use UI input for the tested interaction. Use database reads to verify identity, stored content, and unchanged Notes. Do not substitute direct API writes for the user action a lane claims to drive.
- [ ] For I1 and I2, seed hidden record-owned conversations in an isolated fixture and exercise the unchanged Notes UI. Use a deterministic service or Tauri test for hidden APIs. Do not pretend a nonexistent Ask AI entry exercised them.

## Persist explicit conversation ownership (I1)

**Depends on.** None.

**Files.**

- [ ] Edit `crates/qa-scribe-core/src/domain/chat.rs` and add a dedicated conversation-owner type if the module size requires it.
- [ ] Edit `crates/qa-scribe-core/src/storage/schema.rs` and `storage/mod.rs`. Add the ownership migration beside the existing chat migration modules.
- [ ] Edit `crates/qa-scribe-core/src/services/session_service/chat.rs`, `chat_rows.rs`, and `chat_submission.rs`.
- [ ] Edit `src-tauri/src/commands/chat.rs` and command registration in `src-tauri/src/main.rs`. Update `frontend/src/tauri.ts` and generated `frontend/src/bindings.ts` as required.
- [ ] Create `crates/qa-scribe-core/tests/chat_conversation_ownership.rs` with bounded support modules. Extend existing migration and storage tests.
- [ ] Create `e2e/specs/ask-ai-ownership-migration.e2e.mjs` and `e2e/specs/ask-ai-conversations.benchmark.mjs`. Register fixture support in `scripts/run-e2e.mjs`.

**Build.**

- [ ] Name the data shape `ConversationOwner`. Encode Notes with a Session ID, or Ask AI with a Session ID and a Finding or Test cases record identity. Keep `chat_drafts.id` as the conversation ID. Do not conflate this owner with `ChatTarget`, `ChatMode`, or response purpose.
- [ ] Add checked, immutable owner metadata to `chat_drafts`. Restrict the active uniqueness index to Notes. Allow several retained Ask AI conversations for one record. Do not add a cascading record foreign key.
- [ ] Backfill every existing draft as Notes without changing messages, IDs, composer, image links, contexts, revisions, archives, proposal stages, or submission receipts. Preserve submitted rows. Replace the old index explicitly after owner columns exist. Do not rely on `CREATE INDEX IF NOT EXISTS` to change its predicate.
- [ ] Provide Notes lookup, exact conversation lookup, owner-scoped history listing, and idempotent Ask AI creation. Include the bounded composer request intent in durable input so I3 starters cannot change behavior after recovery. A client launch UUID is generated once per explicit request and can serve as the conversation ID. Reusing it with another owner fails.
- [ ] Keep genuinely archived and submitted conversations read-only. Starting or hiding a record chat does not archive another conversation. History reads preserve original identities rather than copying messages. Return durable activity ordering and recovery status. Continue last chat selects the most recently active nonempty conversation, not a newer empty starter.
- [ ] Restrict Note submission and Notes restart to Notes ownership at the backend boundary. Preserve old idempotent receipts and legacy refinement recovery. Keep new APIs disconnected from record UI until I2 and I3 are ready.
- [ ] Regenerate bindings with `bun run bindings:generate`, then run `bun run bindings:check` and `bun run tauri:commands:check`.

**You see.**

- [ ] The existing Notes workflow still opens its original conversation. Starting from a schema-18 fixture preserves its active, archived, submitted, and mixed-context history.
- [ ] The isolated service fixture creates two empty Ask AI conversations for one record. Their IDs and composers differ from Notes. Replayed launch UUID returns the original row.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `cargo test -p qa-scribe-core --test chat_conversation_ownership` and `cargo test -p qa-scribe-core --test chat_storage`. Assert literal IDs, row content, image hashes, receipts, typed owner rejection, and replay behavior.
- [ ] Run `cargo test -p qa-scribe-core --lib storage::tests`. Cover migration failure rollback, reopen twice, nullable-owner shape violations, and future-schema rejection. Select the next schema version from current trunk at implementation time.
- [ ] Run `cargo test -p qa-scribe-core --test saved_proposal_recovery` and `cargo test -p qa-scribe-core --test chat_image_cleanup`. Retain exact Saved recovery and image-reference safety.
- [ ] Run `bun run bindings:check`, `bun run tauri:commands:check`, and `bun run frontend:check`. Retain exact command outputs.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head. Use the boot recipe and `ask-ai-ownership-migration.e2e.mjs`. Select an OpenAI profile from the live catalog.

- [ ] Lane 1. Upgrade the isolated active Notes fixture. Save `artifacts/ask-ai-conversations/I1/lane-1/result.png`. Pass when the original composer, messages, and draft ID remain visible.
- [ ] Lane 2. Open already-submitted Notes after upgrade. Save `artifacts/ask-ai-conversations/I1/lane-2/result.png`. Pass when its receipt and Note content remain unchanged.
- [ ] Lane 3. Reopen the application twice. Save `artifacts/ask-ai-conversations/I1/lane-3/result.png`. Pass when the migration is not repeated and Notes loads the same ID.
- [ ] Lane 4. Open a legacy mixed-context conversation. Save `artifacts/ask-ai-conversations/I1/lane-4/result.png`. Pass when message order, images, and proposal outcome summaries remain readable.
- [ ] Lane 5. Read archived Notes through the scoped history API and fixture diagnostics. Save `artifacts/ask-ai-conversations/I1/lane-5/result.png`. Pass when original IDs and content remain unchanged and archives reject mutation.
- [ ] Lane 6. Seed two hidden Ask AI conversations with different owners. Save `artifacts/ask-ai-conversations/I1/lane-6/result.png`. Pass when the Notes UI displays neither transcript nor their inputs.
- [ ] Lane 7. Create and replay a launch UUID through the service fixture. Save `artifacts/ask-ai-conversations/I1/lane-7/result.png`. Pass when one row exists and a mismatched owner is rejected without mutation.
- [ ] Lane 8. Attempt Ask AI Note submission through the boundary fixture. Save `artifacts/ask-ai-conversations/I1/lane-8/result.png`. Pass when the command rejects it and the visible Note content stays unchanged.
- [ ] Lane 9. Recover a legacy staged edit in its original record editor. Save `artifacts/ask-ai-conversations/I1/lane-9/result.png`. Pass when guarded Save still settles the original stage without copying it to a new conversation.
- [ ] Lane 10. Delete an isolated source record through the UI. Save `artifacts/ask-ai-conversations/I1/lane-10/result.png`. Pass when read-only diagnostics retain its conversation snapshots and unrelated Notes images.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure legacy Notes opening, record Save, and first migrated launch time. Check row conservation separately from timing.
- [ ] Probe. Extend the shared native benchmark with the same schema-18 fixture at trunk and head. Retain five interleaved pairs with 20 repeated UI openings and Saves per run. Measure first-launch migration once per fresh fixture. Run `QA_SCRIBE_E2E_SPEC=ask-ai-conversations.benchmark.mjs bun run e2e` with an identical recorded probe at both SHAs.
- [ ] Baseline. Record trunk timings first. Use 100 historical conversations with 10 messages each and four small managed images. Preserve exact fixture bytes and distinguish first migration from warm opening.
- [ ] Rule. Fail if a common-operation median of per-run p95 values exceeds 1.25 times trunk plus 20 ms. Fail if first migrated opening exceeds 1.5 times fresh trunk opening plus 100 ms. These are proposed budgets, not measured results.

**Review gate.** None. I1 is not review-gated. It preserves the released interaction. Its source and live verification remain mandatory.

**Merge.**

- [ ] Obtain an independent exact-head verdict, current protected CI success, and completed automated-comment triage.
- [ ] Stop at merge-ready. Merge only within the operator's new authorization. Record any rebase and prove evidence equivalence or repeat affected checks.

## Route execution and recovery by conversation (I2)

**Depends on.** I1.

**Files.**

- [ ] Edit `src-tauri/src/commands/chat/preparation.rs`, `chat/lifecycle.rs`, and `chat/runner.rs` with their focused test modules.
- [ ] Edit `src-tauri/src/jobs.rs`, `jobs/registration.rs`, `jobs/permission.rs`, and `src-tauri/src/commands/ai/job_events.rs` where chat ownership crosses status transport.
- [ ] Edit `frontend/src/app/useSessionChat.ts`, `sessionChat.types.ts`, `sessionChat.actions.ts`, `sessionChat.send.ts`, `sessionChat.polling.ts`, and `sessionChat.permissions.ts`.
- [ ] Edit `frontend/src/app/sessionChat.proposals.ts`, relevant recovery helpers, `appSettlement.ts`, and `useAppController.ts` to supply explicit workspace identities.
- [ ] Edit core `chat_refinements.rs`, `chat_questions.rs`, and `chat_context.rs` only where conversation ownership or competing stages need boundary checks. Preserve both record persistence paths.
- [ ] Add focused ownership tests and `e2e/specs/ask-ai-conversation-routing.e2e.mjs`. Update generated bindings and fixture registration. Keep record entry behavior unexposed until I3.

**Build.**

- [ ] Load requested or prepared draft IDs in preparation, recheck, finish, failure, retry, and image import. Remove every Session-singleton rediscovery from these operations. Notes lookup remains an explicitly Notes-only entry path.
- [ ] Key mutable chat workspaces and asynchronous publication by conversation ID, with Session and owner checks. Generalize the existing engine rather than copying it. Keep Notes mode and canonical Note recovery in the Notes composition.
- [ ] Bind chat job status to its conversation from admission, before an AI Run exists. Route partial output, completion, cancellation, polling, hydration, permission requests, and uncertain-start recovery to that conversation.
- [ ] Keep the actual scheduler policy. Admission currently allows three active generation jobs globally. Preserve that bound and one running turn per conversation. Do not invent a one-chat-per-Session restriction. Test concurrent same-Session conversations and reject global capacity before consuming another composer.
- [ ] Keep permission approval bound to its exact job, request, provider, and conversation. An approval for a hidden chat never appears as the visible chat's approval. Keep explicit recovery and no automatic action retry.
- [ ] Bind proposal review, Stage, Apply, Save, Undo, Discard, and restore to the originating conversation, proposal, stage, and record. Permit only one unresolved local stage per record across conversations. Reject a new competing Stage at the existing transaction boundary and link to its owner. Preserve any legacy multiple prepared stages. List them for explicit resolution through their original conversations. Do not delete, reassign, or automatically install one. Existing bound-stage Save retains its established guard checks.
- [ ] Keep atomic stored-base checks for Findings and Test cases. Preserve accepted-base, compensation lease, Session ownership, joined-save, generated-baseline, and exact Saved-stage recovery behavior. This phase does not redesign record write coordination.
- [ ] Validate fresh record turns against the durable record owner. Capture current same-record editor contents on normal Send. Keep immutable question correlation and Retry snapshots, including the deleted-source Retry exception. Legacy Notes conversations may contain historical record turns.
- [ ] Add a source inventory that finds remaining `getChat(sessionId)` and `load_chat(session_id)` callers. Classify each as Notes entry or migrate it to explicit identity. Regenerate and check bindings.

**You see.**

- [ ] Notes remains visually unchanged. Fixture-originated Ask AI jobs finish into their own hidden conversations while Notes stays open.
- [ ] A hidden permission or staged proposal identifies its original conversation. A same-Session conversation cannot receive another chat's text, images, status, or approval.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run `cargo test -p qa-scribe-tauri --bin qa-scribe-tauri commands::chat` and the new `conversation_ownership` filter. Delay verification and completion while selecting another conversation.
- [ ] Run `cargo test -p qa-scribe-core --test chat_context`, `cargo test -p qa-scribe-core --test chat_retry_context`, `cargo test -p qa-scribe-core --test chat_questions`, and `cargo test -p qa-scribe-core --test chat_refinement`.
- [ ] Add public-controller tests for isolated autosave, late callback publication, image import, active-job enumeration, permission acknowledgment, and stage restore. Run the focused files with `bun run --cwd frontend test <changed-test-files>`.
- [ ] Run existing record-write coordination and ordinary-edit regression files, `bun run frontend:check`, binding checks, and command checks. Assert literal stored bodies and tokens rather than only mock call counts. Seed two legacy prepared stages for the same record. Verify explicit resolution, unchanged history, guarded Save of the bound stage, and rejection of a new competing Stage.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head. Use the boot recipe and `ask-ai-conversation-routing.e2e.mjs`. Select an OpenAI profile from the live catalog. The visible interaction remains the released Notes workflow. Hidden-owner assertions use separate controller or Tauri integration receipts. They are not native interaction proof for the future I3 controls.

- [ ] Lane 1. Complete a fixture response in A while Notes is displayed. Save `artifacts/ask-ai-conversations/I2/lane-1/result.png`. Pass when only A receives the assistant message and Notes keeps its text.
- [ ] Lane 2. Run conversations A and B in one Session with distinct fixture replies. Save `artifacts/ask-ai-conversations/I2/lane-2/result.png`. Pass when each result and image list reaches only its owner.
- [ ] Lane 3. Show a Notes permission while a hidden fixture conversation also has a pending request. Record hidden identity assertions in the boundary integration receipt. Save `artifacts/ask-ai-conversations/I2/lane-3/result.png`. Pass when the visible Notes request has its own job identity and a forged hidden-owner decision is rejected.
- [ ] Lane 4. Cancel the visible Notes response while hidden fixture conversation B runs. Save `artifacts/ask-ai-conversations/I2/lane-4/result.png`. Pass when B completes and only the visible Notes response becomes cancelled.
- [ ] Lane 5. Reload the WebView during a response. Save `artifacts/ask-ai-conversations/I2/lane-5/result.png`. Pass when enumeration reconnects the exact draft and job without another provider invocation.
- [ ] Lane 6. Restart the application after a committed user turn. Save `artifacts/ask-ai-conversations/I2/lane-6/result.png`. Pass when interrupted state belongs only to its original conversation and no Retry runs automatically.
- [ ] Lane 7. Hold the visible Notes image import while hidden B's composer changes through the controller fixture. Save `artifacts/ask-ai-conversations/I2/lane-7/result.png`. Pass when the imported image appears only in Notes and B retains its literal input. This is a Notes native check plus a separate controller assertion.
- [ ] Lane 8. Use the released shared-record UI to stage its Notes-owned suggestion. Request a competing stage from hidden B through the integration fixture. Save `artifacts/ask-ai-conversations/I2/lane-8/result.png`. Pass when the second stage is refused and A remains saveable.
- [ ] Lane 9. Complete Save or Undo in the released record UI while hidden B completes. Reserve native switching between isolated record conversations for I3. Save `artifacts/ask-ai-conversations/I2/lane-9/result.png`. Pass when SQLite shows the correct record result and original proposal settlement without a false conflict.
- [ ] Lane 10. Delete a failed turn's source and Retry explicitly. Save `artifacts/ask-ai-conversations/I2/lane-10/result.png`. Pass when it replays the original snapshot while fresh capture and Apply to the missing record remain unavailable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure normal Notes Send preparation and common record Save. Measure hidden-job routing without attributing provider latency to the app.
- [ ] Probe. Use the same I1 benchmark and recorded probe at current trunk and I2. Add a held deterministic provider response to show navigation finishes before provider release. Run five interleaved pairs with 20 common operations each.
- [ ] Baseline. Record trunk common-operation timing and invocation counts before the head. Keep reply bytes, images, fixture records, and active job count equal.
- [ ] Rule. Fail above 1.25 times trunk plus 20 ms for median per-run p95 preparation or Save. Fail any duplicated provider invocation, cross-owner event, consumed input on capacity rejection, or navigation that waits for the held provider.

**Review gate.** None. I2 is not review-gated. It preserves the released interaction. Its source and live verification remain mandatory.

**Merge.**

- [ ] Obtain an independent exact-head verdict, current protected CI success, and completed automated-comment triage.
- [ ] Stop at merge-ready. Merge only within the operator's new authorization. Record any rebase and prove evidence equivalence or repeat affected checks.

## Expose a fresh and focused Ask AI workflow (I3)

**Depends on.** I2.

**Files.**

- [ ] Edit `frontend/src/app/useAskAiContext.ts`, `useAppController.ts`, `AppChat.tsx`, `AppShell.tsx`, navigation, settlement, and explicit conversation recovery selection.
- [ ] Edit `frontend/src/views/SessionChatView.tsx`, `ChatHandoff.tsx`, `ChatContextCard.tsx`, `StartNewConversation.tsx`, and `RecordCollectionView.tsx`. Add a small owner-scoped history view only if composition requires it.
- [ ] Edit `frontend/src/components/NextModelSelection.tsx` and `frontend/src/styles/ask-ai.css` for compact presentation. Reuse the current picker implementation and its keyboard behavior.
- [ ] Update `CONTEXT.md` and user-facing Help descriptions that currently promise one shared Session conversation. Preserve the meaning of Jira Bug Draft and Jira conversation draft.
- [ ] Add `e2e/specs/ask-ai-conversation-isolation.e2e.mjs` and update context, refinement, Jira draft, Notes handoff, images, and model-selection scenarios. Update fixture routing and Help contracts as needed.
- [ ] Update the benchmark and current synthetic design evidence. Keep production source separate from the throwaway HTML prototype.

**Build.**

- [ ] Make the explicit record Ask AI action start an empty conversation for that record. Open immediately without sending. Coalesce repeated clicks and uncertain creation retries with one launch UUID. An already-open truly empty starter is focused rather than duplicated.
- [ ] Provide separate Continue last chat and scoped History entry points. Restore the selected existing ID. Show title or first message, time, and draft, running, permission, or interrupted status. Default History to this record. Provide a This Session filter and a Session-menu history entry so deleted-source and hidden-record chats remain reachable. Keep archived history read-only. Do not build a cross-Session chat library.
- [ ] On Close, persist dirty input and hide the panel without cancelling, archiving, submitting, or discarding. Keep save failures and every running, permission-needed, or unresolved-stage conversation discoverable through the Session activity entry, even when it is not the most recent chat. If local input cannot be saved, retain it in memory and prevent a replacement that would lose it.
- [ ] Pin the conversation owner. Browsing, searching, or filtering another record hides the panel instead of retargeting it. Continue navigates back to the source through normal dirty-record protections. Never silently attach a fallback record.
- [ ] Restore saved conversation references after reload and Session changes. Default the panel to closed with explicit Continue. Distinguish saved input recovery from any promise to recover an unpersisted last keystroke.
- [ ] Compose Notes chat and record Ask AI explicitly around shared transcript, composer, images, and task controls. Remove Note submission, saved-conversation review, Note recovery, and shared-Session copy from record Ask AI. Enforce the same purpose restriction in I1's backend.
- [ ] Use one Ask AI heading and a compact source card. Keep the record identity fixed. Remove the detach X from this record-owned workflow. General questions and tool requests remain valid free text. A new record requires its own explicit launch.
- [ ] Use one compact provider/model picker beside the composer. Put catalog provenance, observed defaults, timestamps, and transcript limits in details or Settings. Keep actual warnings visible. Preserve the current global next-invocation preference semantics and pending-save behavior.
- [ ] Show optional empty-state starters for refinement and Jira drafting. They prepare editable input with the existing typed response intent. Preserve that intent when input is saved or recovered, and use it on the later explicit Send. They do not overwrite occupied input or create remote work. Keep ordinary free text on the normal message intent. Preserve free text, pasted pictures, image-only messages, permissions, reviewed Apply, and ordinary Save.
- [ ] Keep Jira follow-up questions about project, issue type, parent, and configured subtask type in this conversation. Preserve the exact Finding subtask label. Preparing an action still fills editable text and requires explicit Send.
- [ ] Handle missing sources with a readable retained conversation, unavailable fresh record actions, and the existing explicit snapshot Retry. Show unresolved stage ownership before another chat changes the same editor. Never install a recovered suggestion automatically.

**You see.**

- [ ] After any Notes conversation, Ask AI opens with zero old messages, empty input, no attached images, and no Notes submission controls. The record title is visible and the composer is ready.
- [ ] Close and Continue restore the same conversation. Ask AI or New chat starts fresh. Notes remains untouched, including after its conversation was submitted.
- [ ] The screenshot's Note handoff and provider diagnostics disappear from the task path. The conversation and composer receive the available space.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Replace old shared-conversation assertions in `AppShell.askAi.test.tsx`, `useAppController.chat.context.test.ts`, and the native context spec with literal isolation expectations. Prove the new cases fail on v0.8.22 first.
- [ ] Add lifecycle tests for new launch, coalesced double-click, occupied composer, Continue, History, close, record filters, Session changes, reload, missing source, unsaved images, and uncertain creation. Run `bun run --cwd frontend test <changed-test-files>`.
- [ ] Run Notes submission, images, permissions, questions, proposal, model-picker, and ordinary record-editing regression files. Verify that compact mode preserves keyboard focus and globally saved model choice.
- [ ] Run `bun run verify` at the final candidate and retain any host-specific failure with its baseline proof. Require the protected CI quality gate without suppressing a failure.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head. Use the boot recipe and `ask-ai-conversation-isolation.e2e.mjs`. Select an OpenAI profile from the live catalog.

- [ ] Lane 1. Write Notes messages and an unsent request with a picture, then Ask AI on a Finding. Save `artifacts/ask-ai-conversations/I3/lane-1/result.png`. Pass when Ask AI is empty and Notes' literal saved input and image hash stay unchanged.
- [ ] Lane 2. Submit Notes, then Ask AI on a manual and generated record. Save `artifacts/ask-ai-conversations/I3/lane-2/result.png`. Pass when every new record conversation has its own enabled composer and no Note-only controls.
- [ ] Lane 3. Close a conversation with unsent text and images, then Continue. Save `artifacts/ask-ai-conversations/I3/lane-3/result.png`. Pass when its ID and input return. Start a new chat and pass only when input is empty and previous work remains reachable.
- [ ] Lane 4. Ask AI on A, then browse B through a filter and launch there. Save `artifacts/ask-ai-conversations/I3/lane-4/result.png`. Pass when B starts empty and Continue A returns to A with no silently changed owner.
- [ ] Lane 5. Reload and switch Sessions with saved draft and running work. Save `artifacts/ask-ai-conversations/I3/lane-5/result.png`. Pass when Continue returns to the right owner and no automatic Send, Retry, or remote action occurs.
- [ ] Lane 6. Hide a permission-needed chat and open another chat. Save `artifacts/ask-ai-conversations/I3/lane-6/result.png`. Pass when its activity indicator returns to the original job and no approval can target the visible unrelated chat.
- [ ] Lane 7. Paste a picture, send an image-only message, and recover a failed import. Save `artifacts/ask-ai-conversations/I3/lane-7/result.png`. Pass when only the selected conversation owns the pictures and the documented provider limitation remains clear.
- [ ] Lane 8. Review, Apply, Save, Undo, and Discard a Finding and Test cases proposal across a chat switch. Save `artifacts/ask-ai-conversations/I3/lane-8/result.png`. Pass when stored bodies, stage states, and stale-base rejection match literal expectations.
- [ ] Lane 9. Draft Jira content, answer issue-type and parent follow-ups, and select Finding subtask. Save `artifacts/ask-ai-conversations/I3/lane-9/result.png`. Pass when preparing an action only fills editable input and fixture logs contain no external Jira operation.
- [ ] Lane 10. Exercise 1440 by 900, 640 by 488, and 360-pixel-wide layouts with long content and a 40-model catalog. Save `artifacts/ask-ai-conversations/I3/lane-10/result.png`. Pass when Send, images, permissions, context alerts, and keyboard picker choices remain reachable and the record header gap remains zero.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Measure new Ask AI opening, Continue, Apply, Notes reveal, record Save, and retained draft count after repeated empty opens.
- [ ] Probe. Use the same native benchmark at trunk and head with five interleaved pairs and 20 operations per run. Report new-conversation and Continue latency separately. Retain screenshots, SQLite work checks, machine load, failures, and exact binary hashes.
- [ ] Baseline. Measure common operations on trunk first with identical fixture bytes. New-chat and Continue have no comparable trunk UX, so report them against an explicit head-only budget rather than inventing a speedup.
- [ ] Rule. Fail if new Ask AI opening or Continue exceeds 250 ms p95, or Apply exceeds 100 ms p95. Fail if common operations exceed 1.25 times trunk plus 20 ms. Fail duplicate empty rows from repeated clicks or any lost input. Budgets require real native measurements before release.

**Review gate.** The operator reviews before merge.

- [ ] Post desktop, compact, empty, active, History, and permission screenshots from this exact candidate in chat. Save them under `artifacts/ask-ai-conversations/I3/review/`.
- [ ] Record a 30 to 60 second video showing Notes, a fresh Ask AI launch, close, Continue, and a second record. Post the video for operator review.
- [ ] Wait at merge-ready for the operator's interaction review and merge instruction.

**Merge.**

- [ ] Obtain an independent exact-head verdict, current protected CI success, and completed automated-comment triage.
- [ ] Stop at merge-ready. Merge only within the operator's new authorization. Record any rebase and prove evidence equivalence or repeat affected checks.

## Close the program

- [ ] Check every phase box only after reading its evidence. Keep failed or unsupported lanes visible.
- [ ] Confirm old Notes data remains reachable and immutable where required. Confirm record conversations remain separate after restart and source deletion.
- [ ] Remove obsolete shared-conversation terminology and unused Session-singleton record call paths. Retain one engine and explicit owners.
- [ ] Hand back the final screenshots, video, regression and performance results, risks, and PR URLs. Check T3 PR linkage. Do not publish a release under this planning-only request.

## Appendix A. Prototype evidence

The throwaway prototype is `docs/design/ask-ai-conversations/prototype.html`. Run `python3 -m http.server 5191 --bind 127.0.0.1 --directory docs/design/ask-ai-conversations` and open `http://127.0.0.1:5191/prototype.html`.

It compares A, fresh on explicit Ask AI, with B, automatic resume per record. It uses the app's current dark palette, typography scale, spacing, and rectangular controls. The navigation is schematic, not a proposed replacement of the Session sidebar.

Investigation branch is `main` at `51189e3a388c12a53dd7c18eeb79571bad437902`. The prototype and plan are uncommitted artifacts at this base. There is no prototype commit SHA.

Images are `01-fresh-desktop.png`, `02-fresh-narrow.png`, and `03-resume-alternative.png` in that directory. Each is rendered HTML, not a native QA Scribe screenshot. Responses, pictures, and persistence are simulated. The original screenshot's content is not used.

The observations in `/tmp/qa-scribe-ask-ai-isolation/prototype-observations.json` show separate Notes state, fresh record input, explicit history restoration, and the difference from automatic resume. They prove only the throwaway model's transitions. They do not prove production migration, permissions, persistence, keyboard input, or backend isolation.

The collaborative browser twice returned `Preview automation snapshot timed out after 15000ms`. A tab reuse attempt also returned that the tab was not found. HTML preview supplied the visual study. Native interaction proof remains an implementation gate.

Proposed lifecycle for review follows.

| Event | Result |
| --- | --- |
| Explicit Ask AI on a saved record | Open an empty conversation owned by that record. Do not send or run a tool. |
| Repeated launch while the same empty starter is already open | Focus it and reuse the launch UUID. Images, pending imports, jobs, or unresolved stages mean it is not empty. |
| Ordinary follow-up | Stay in the same conversation. Capture current content of the same record. |
| Question choice or Retry | Keep the existing correlated snapshot. Do not silently substitute newer record content. |
| Close or navigate away | Hide and preserve work. Show an explicit Continue or activity entry. |
| Continue last chat or select History | Open that existing conversation ID. Never copy it into a fresh chat. |
| New chat or Ask AI after leaving a nonempty conversation | Start empty. Retain earlier work with its own ID and show where it can be continued. |
| Browse or filter another record | Hide the old record panel. Preserve its owner. New Ask AI is a separate launch. |
| Reload or reopen a Session | Recover saved references and input. Keep the panel closed until Continue. Do not automatically send. |
| Submitted Notes | Keep Notes' receipt. Do not make Ask AI read-only. |
| Unsaved or failed-to-save chat input | Retain local input and surface its owning conversation. Do not abandon it during replacement. |
| Running response or pending permission | Keep execution attached to its original conversation and provide an activity route back. Closing does not cancel. |
| Competing proposal for one record | Keep one unresolved local stage and direct the user to its conversation before another Apply. |
| Deleted source | Retain history and stored-snapshot Retry. Disable fresh record capture and Apply. |

History defaults to the current record. A lightweight Continue last chat entry provides direct recovery without forcing another new chat just to reach History. A This Session filter and Session-menu entry expose chats for hidden or deleted records. Every pending job or unresolved stage also remains visible through Session activity. Notes needs a reachable read-only reader for its archived legacy conversations. A cross-Session conversation library is outside this plan.

## Appendix B. Alternatives rejected

| Alternative | Judgment |
| --- | --- |
| Clear the panel or hide unrelated messages | Reject. Composer, submission state, replay, limits, retries, and terminal writes still use the Session conversation. |
| Call the existing restart operation on Ask AI launch | Reject. It archives Notes and can interfere with staged proposals. |
| Resume automatically for every record | Viable alternative. It fixes cross-purpose mixing but does not follow the user's stated fresh-start expectation. Keep Continue explicit unless the user chooses this policy. |
| Duplicate the chat controller, tables, or provider stack | Reject. It creates two engines to maintain while leaving common identity mistakes possible. |
| Infer purpose from old message snapshots | Reject. Legacy mixed conversations have no reliable owner discriminator. Preserve them intact in Notes. |
| Add a per-Session response lock | Reject for this scope. The actual backend admits up to three jobs globally. Preserve that bound and route each conversation correctly. |
| Build a global chat library, new Jira integration, or task agent | Defer. None is needed to correct conversation ownership and the record task UX. |

## Appendix C. Risks

I1 owns schema ordering. `SCHEMA` currently runs before and after migration helpers. A purpose-dependent index cannot run before its columns exist. Migration must preserve old submitted-row protections. The current schema is 18, but the execution owner must check trunk before choosing its successor.

I2 owns asynchronous routing. Preparation and finalization currently reload by Session even though writes carry a draft ID. Changing only creation will fail valid completions. Job status needs conversation identity from admission, including uncertain starts. Session deletion must still cancel every descendant job.

I2 owns the shared editor. Two separate conversations may discuss the same record. Their stages need explicit origin and an atomic competing-stage check. Existing record Save and compensation tests are retained requirements, not candidates for a general rewrite.

I3 owns recovery visibility. Fresh launch is incomplete without reachable earlier work. History lists must distinguish editable retained chats from archived or submitted read-only history. Closing must not conceal unsaved failures or tool permission requests.

I3 owns model preference copy. The current provider model preference applies globally to the next invocation. A compact picker must disclose that scope in its details instead of implying per-record settings.

I3 owns deletion behavior. An owner anchor must survive deletion of its record. Preserve the existing missing-source Retry exception while rejecting fresh record operations and foreign or wrong-kind replacements.

All phases own proof limits. No native app was exercised for this plan. No migration, application test, provider call, Jira action, benchmark, commit, PR, or release was performed. Proposed budgets are acceptance rules, not current measured performance. Missing native control blocks native claims.

## Appendix D. Links and reading list

Read `CONTEXT.md`, `docs/development.md`, `docs/verification/check-inventory.md`, and `docs/ask-ai-phased-plan.md`. The previous plan records the now-rejected shared-conversation decision. It does not override this corrected product requirement.

Source evidence was inspected at the baseline SHA. Start with these files.

- `frontend/src/app/AppChat.tsx` explicitly calls the panel the shared Session conversation and supplies one `c.sessionChat`.
- `frontend/src/app/useAskAiContext.ts` changes selection and panel visibility without creating a conversation.
- `frontend/src/app/useSessionChat.ts` and `sessionChat.actions.ts` own workspaces by Session.
- `frontend/src/views/SessionChatView.tsx` unconditionally mounts `ChatHandoff`.
- `crates/qa-scribe-core/src/storage/schema.rs` enforces `idx_chat_active_session`.
- `crates/qa-scribe-core/src/services/session_service/chat.rs` loads and restarts the Session singleton.
- `src-tauri/src/commands/chat/preparation.rs` and `chat/lifecycle.rs` rediscover the Session chat during execution.
- `src-tauri/src/jobs/registration.rs` enforces global capacity, not a per-Session lock.
- `frontend/src/app/sessionChat.proposals.ts` and core `chat_refinements.rs` contain stage and guarded-save ownership.

The installed skill root for this run is `/Users/vriesd/.codex/plugins/cache/pstack-for-codex-local/pstack-for-codex/0.4.0/skills/`. Read `poteto-mode/references/codex-agent-runtime.md` from that root. I1 and I2 require how and architect before implementation. I3 requires architect for shared UI boundaries and interrogate before its interaction ships. Apply technical-writing, no-comments, and benchmark-checklist at their named gates.

Investigation reports are `/tmp/ask-ai-isolation-storage-exploration.md` and `/tmp/ask-ai-isolation-ui-exploration.md`. Independent critique is `/tmp/ask-ai-isolation-architecture-critique.md`. They distinguish source observations from future acceptance requirements.

The decision trail is `/tmp/qa-scribe-ask-ai-isolation/decisions.tsv`. The final planning review and plan-check receipt are retained beside it after completion. These are local working artifacts, not production audit records.

Experience First changed the target to a clean record conversation with explicit continuation. Redesign from First Principles changed the fix from hiding Notes controls to separating ownership. Model the Domain separated conversation owner from turn snapshot. Sequence Work into Verifiable Units put storage before routing and user exposure. Prove It Works kept the prototype, source evidence, and unperformed native checks distinct.
