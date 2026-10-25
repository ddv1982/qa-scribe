# Add Ask AI to findings and test cases plan

This is the original planning snapshot. The user subsequently authorized implementation and release, then clarified that Jira must reuse existing coding-agent chat without real Jira testing or a separate integration. The [implementation run](design/ask-ai/implementation.md) and [selected chat-reply contract](design/ask-ai/jira-chat-replies.md) supersede the delivery, authorization, JiraActionDraft, connector qualification, and remote execution journal requirements below. The original checkboxes remain historical planning work, not a current completion report.

Delegation, lifecycle, isolation, history, and capability fallbacks follow the [installed runtime contract](/Users/vriesd/.codex/plugins/cache/pstack-for-codex-local/pstack-for-codex/0.4.0/skills/poteto-mode/references/codex-agent-runtime.md).

Let testers ask questions, refine an item, paste images, and ask their coding agent to take action from a finding or test case.
Reuse the Session conversation, provider selection, image pipeline, and permission controls already available in Notes.
Use **Ask AI** for the entry action and **AI chat** for the panel. Use **Finding subtask** for the requested Jira subtask type.
Implement S1, C1, R1, J1, and J2 in that order. These are proposed PR identifiers, not existing PRs.
Keep item edits reviewable and saved through the ordinary editor. Keep Jira drafts separate from confirmed external results.
This document authorizes no implementation, Jira writes, goal, schedule, commit, push, or PR.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

Run the [Feature playbook](/Users/vriesd/.codex/plugins/cache/pstack-for-codex-local/pstack-for-codex/0.4.0/skills/poteto-mode/playbooks/feature.md) for each implementation phase.
Use the [Opening a PR playbook](/Users/vriesd/.codex/plugins/cache/pstack-for-codex-local/pstack-for-codex/0.4.0/skills/poteto-mode/playbooks/opening-a-pr.md) only when publication is authorized.
The operator reviews screenshots and video and merges each PR. Owners stop at merge-ready.
Core verification uses the real native app with deterministic provider and Jira fixtures. Real Jira qualification is a separate, explicitly armed check.
A missing Jira capability leaves that provider and feature unavailable. It does not invalidate the completed fixture checks.
Do not declare Jira creation delivered until at least one real provider and connector combination has the J2 qualification receipt.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

Read the delivery sequence before assigning an owner.

1. S1 fixes the sticky record header and content scroll region.
2. C1 opens the shared Session chat beside findings and test cases with explicit item context.
3. R1 adds reviewed local refinement proposals and protected apply behavior.
4. J1 adds the Jira draft and follow-up interaction, including **Finding subtask**.
5. J2 executes a reviewed Jira request through the configured coding agent and handles uncertain results.

Complete saved manual and generated records through the same path. Include unsaved edits of an existing record in a labelled snapshot.
For a first-time manual creation, use the shared entry after the existing creation save completes.
Keep free-form chat available throughout. The Jira shortcut does not turn the panel into a Jira-only wizard.

## Program checklist

### Arm the program

- [x] Read the Principles section and trace the current source. Evidence is in Appendix D and the [source inspection receipt](design/ask-ai/source-inspection.md).
- [x] Resolve the layout and follow-up direction with a throwaway prototype. Evidence and limits are in Appendix A.
- [ ] State this plan and stop. Start implementation only after the operator requests it.
- [ ] Skip create a goal and an hourly audit for this planning task. A continuing program requires separate lifecycle authorization.
- [ ] Read the execution playbooks from their installed paths before implementation. Skip `git show origin/main:skills/poteto-mode/playbooks/feature.md` because this app does not contain the skill bundle.
- [ ] Apply how and architect before production boundary changes. Record the selected target, proposal, interaction, and provider-result contracts.
- [ ] Prove the J1 structured-response contract with deterministic provider transcripts before production Jira cards. Compare app-owned validated response envelopes with provider-native questions. Preserve the chosen clickable design. Keep Markdown replies as a visible fallback when structured input is unavailable.
- [ ] Record a queue table in the decision log only if implementation becomes a continuing program.
- [ ] Record the current trunk SHA, supported provider versions, native-control capability, and isolated test data before each phase.
- [ ] Treat the missing real Jira connection and type discovery as unproven until J1 and J2 provide the named evidence.

### Spawn owners

- [ ] Assign one implementation owner per phase in an isolated worktree. Parent owns integration, authoritative checks, and publication.
- [ ] Start S1 from trunk. Start C1 after S1. Start R1 after C1. Start J1 after R1. Start J2 after J1.
- [ ] If a stack is explicitly requested, base each child on the exact parent commit. Otherwise wait for its parent to merge.
- [ ] Hold each phase to its listed files. Serialize shared chat, bindings, storage, and E2E changes.
- [ ] Keep S1, C1, R1, J1, and J2 review-gated. Review screenshots and video in chat before merge.
- [ ] Revalidate the configured implementation and fast verification profiles through the live model catalog before dispatch.
- [ ] At each phase, record the throughput checkpoint. Resolve blocking contracts first. Parallelize only disjoint work. Isolate shared state. Use one owner for each coupled change.

### PR mechanics, for every PR

- [ ] Resolve the repository through `gh`. Record the base and head SHA in the phase receipt. Use Graphite only for an explicitly requested stack.
- [ ] Run focused tests while editing. Run `bun run verify` once for the completed phase, plus its maintained built-app E2E workflows.
- [ ] Use the installed deslop and no-comments skills before commit and review. Apply technical-writing and unslop to PR text.
- [ ] Parent opens each authorized PR and immediately registers its full URL with T3 `link_pull_request`.
- [ ] Triage Bugbot and security findings against the actual diff and reproduction evidence.
- [ ] Rebase for merge preparation. Reuse evidence only when the tested patch and its relevant environment remain equivalent.

### Verdict and merge, for every PR

- [ ] Verify unit, live, and perf evidence at the exact head SHA. Run the ten live scenarios in bounded waves.
- [ ] Run independent checks of target identity, rich-text consistency, permission identity, persistence, and external-action recovery where the phase touches them.
- [ ] Use a gates lane, the named live lanes, a perf lane, and at least two independent diff audits under the installed swarm workflow.
- [ ] Keep missing live-control, provider authentication, or Jira access visible. Missing evidence blocks the affected support claim.
- [ ] Parent gives a clean verdict only when the evidence passes. Operator merges after the review gate.
- [ ] For a later stack, apply the Shipping playbook's patch-id rule. A changed patch receives fresh affected verification.

### Boot recipe, for every live lane

Each live scenario uses an isolated checkout, an isolated Tauri data directory, and the exact PR head.
Serialize native desktop control. Do not run competing app windows against the user's installed database.

- [ ] Install with `bun install --cwd frontend --frozen-lockfile`. Use the pinned Tauri CLI workflow from `docs/development.md`.
- [ ] Select the maintained spec named in the phase. For C1, run `QA_SCRIBE_E2E_SPEC=ask-ai-context.e2e.mjs bun run e2e`. Let the wrapper own fixture setup, data isolation, and artifact paths.
- [ ] On Linux, retain the selected spec before `GDK_BACKEND=x11 xvfb-run -a bun run e2e`. Use the exact platform command in each phase. On macOS, use the same spec with `bun run e2e`.
- [ ] Drive the built app through WebdriverIO Tauri control. Use native clipboard and file-dialog control for actual operating-system input proof.
- [ ] Use deterministic provider and Jira fixtures for all ten core live lanes in J1 and J2. Keep real Jira qualification separate and explicitly armed against a designated test project. Never let a fixture run invoke a real connector.
- [ ] Use read-only database inspection and redacted provider traces for diagnosis. Never retain credentials or image base64 in receipts.
- [ ] Save each lane's screenshot and JSON receipt at the exact paths named in the phase's live checkboxes. Record light and dark themes, desktop width, and a short native window.
- [ ] Apply benchmark-checklist before collecting perf values. Measure trunk first. Treat every threshold below as a proposed acceptance budget, not a measured claim.

## Phase 1. Fix the sticky record header and scroll region (S1)

**Depends on.** None.

**Files.**

- [ ] Edit `frontend/src/styles/collections.css`, `frontend/src/styles/editor.css`, and `frontend/src/views/RecordCollectionView.tsx`.
- [ ] Edit `frontend/src/views/RichRecordView.tsx` only where header ownership requires it.
- [ ] Add `e2e/specs/record-workspace-layout.e2e.mjs` and update affected collection tests.

**Build.**

- [ ] Reproduce the reported top gap in the built app with a synthetic long finding. Save before screenshots and scroll geometry.
- [ ] Put title, metadata, and item actions in one opaque sticky header directly beneath the Session tabs.
- [ ] Move vertical spacing onto the inner content. Give the document a scroll container with no top padding above its sticky header.
- [ ] Preserve existing Inter typography, theme tokens, action variants, search, sorting, record list, Copy, Edit, and Delete.
- [ ] Keep the header visible in findings and test cases. Handle wrapped actions and keyboard focus in short and narrow windows.

**You see.**

- [ ] Scroll a long record and see the header meet the Session tabs with no visible gap.
- [ ] Use Copy and Edit at the scrolled position without the document jumping or hiding focused controls.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Update `RecordCollectionView.test.tsx` for retained title, actions, and keyboard access. Run `bun run frontend:test -- src/views/RecordCollectionView.test.tsx`.
- [ ] Keep geometry verification in the built-app workflow. Do not add CSS-string assertions as layout proof.


**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe.

On macOS, run `QA_SCRIBE_E2E_SPEC=record-workspace-layout.e2e.mjs bun run e2e`. On Linux, run `QA_SCRIBE_E2E_SPEC=record-workspace-layout.e2e.mjs GDK_BACKEND=x11 xvfb-run -a bun run e2e`. Save the runner receipt for the lanes below.

- [ ] Lane 1. Reproduce the original long-finding scroll. Save `artifacts/ask-ai/S1/lane-1/result.png`. Pass when the before receipt shows the gap and the after header is within one CSS pixel of the Session tabs.
- [ ] Lane 2. Scroll manually created test cases. Save `artifacts/ask-ai/S1/lane-2/result.png`. Pass when the same header rule holds and the content stays readable.
- [ ] Lane 3. Scroll generated findings and test cases. Save `artifacts/ask-ai/S1/lane-3/result.png`. Pass when origin does not change sticky behavior.
- [ ] Lane 4. Return to the top of a record. Save `artifacts/ask-ai/S1/lane-4/result.png`. Pass when normal heading and search spacing remains intact.
- [ ] Lane 5. Resize to a 1280 by 700 content area. Save `artifacts/ask-ai/S1/lane-5/result.png`. Pass when actions wrap without clipping and the document still scrolls.
- [ ] Lane 6. Inspect light theme. Save `artifacts/ask-ai/S1/lane-6/result.png`. Pass when the sticky background is opaque and uses current tokens.
- [ ] Lane 7. Inspect dark theme. Save `artifacts/ask-ai/S1/lane-7/result.png`. Pass when scrolling text does not bleed through the header.
- [ ] Lane 8. Navigate actions by keyboard after scrolling. Save `artifacts/ask-ai/S1/lane-8/result.png`. Pass when focused controls remain visible and usable.
- [ ] Lane 9. Use Edit, Save, and Copy after scrolling. Save `artifacts/ask-ai/S1/lane-9/result.png`. Pass when existing record behavior and content remain correct.
- [ ] Lane 10. Open another record and return to Notes. Save `artifacts/ask-ai/S1/lane-10/result.png`. Pass when no extra outer scrollbar, header gap, or Note layout regression appears.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Document-scroll frame duration and header alignment for a long record.
- [ ] Probe. Record a 10-second controlled scroll at trunk and head, three interleaved runs each. Use identical viewport, data, and build mode.
- [ ] Baseline. Record trunk p95 frame time and header gap before the fix.
- [ ] Rule. Fail if head p95 exceeds the larger of 20 ms and 1.2 times trunk, or the pinned header gap exceeds one CSS pixel.

**Review gate.** The operator reviews before merge.

- [ ] Copy the key screenshots into `docs/design/ask-ai/implemented/S1/` and attach their head-SHA receipt.
- [ ] Record a 30 to 60 second video in the isolated native app. Save `artifacts/ask-ai/S1/review.mp4`.
- [ ] Post the screenshots and video in chat for the operator. Stop at merge-ready until the operator reviews the result.

**Merge.**

- [ ] Obtain the parent's clean verdict at the exact head SHA with unit, live, and perf receipts.
- [ ] Complete Bugbot triage and the operator review gate.
- [ ] Rebase onto current trunk and refresh evidence when the patch or relevant base changes.
- [ ] Let the operator merge. Record the merged SHA before starting the dependent phase.

## Phase 2. Open shared Ask AI chat with durable item context (C1)

**Depends on.** S1.

**Files.**

- [ ] Edit `frontend/src/app/AppShell.tsx`, chat actions and types, `RecordCollectionView.tsx`, and `SessionChatView.tsx`.
- [ ] Edit `crates/qa-scribe-core/src/domain/chat.rs`, chat prompt builders, chat service storage, and Tauri chat preparation.
- [ ] Add the required versioned chat-context migration and run `bun run bindings:generate` to regenerate `frontend/src/bindings.ts`.
- [ ] Add target-context controller tests and `e2e/specs/ask-ai-context.e2e.mjs`. Reuse chat image and permission workflows.

**Build.**

- [ ] Name the shape first. Define `ChatTarget` as Session, Finding, or TestCasesDraft. Map TestCasesDraft to a stored `Draft` with `DraftKind::Testware`. Exclude Session Report Drafts from this feature. Keep record identity separate from chat draft identity and revision.
- [ ] Capture a bounded `RecordContextSnapshot` for each sent turn. Include session ID, record ID, title, canonical rich document, relevant metadata, and a base fingerprint.
- [ ] Include unsaved edits of an existing record when present. Label the snapshot as unsaved. Do not save the record merely to send chat context.
- [ ] Persist the turn target and snapshot with history so restart and replay cannot retarget old turns to the currently selected record.
- [ ] Place Ask AI beside Copy and Edit for saved findings and test cases. Reuse the same Session conversation for manual and generated records.
- [ ] Render the existing chat beside the document with a persistent item-context card. Expand and close without losing input, attachments, scroll state, or the running job.
- [ ] Route library items through Open in Session before attaching them to chat. Never mix records from different Sessions.
- [ ] Reuse image import, native paste, removal, retry, limits, provider capability checks, model selection, cancellation, and permission controls. Preserve Notes handoff behavior.
- [ ] Update trusted chat instructions to allow explicit refinement and action requests. Keep record text, note text, and tool output as data. Do not automatically include the full Session note or other records.
- [ ] Handle submitted conversations visibly through the existing restart lifecycle. Preserve unsent text and images. Do not silently clear history.

**You see.**

- [ ] Choose Ask AI on either record type and see its title and snapshot state in the existing AI chat.
- [ ] Switch between Notes and the item panel and see the same conversation and composer.
- [ ] Send a message with a screenshot and keep the document and composer independently scrollable.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add target identity, dirty snapshot, turn replay, detach, record-switch, deletion, and submitted-chat cases. Run `bun run frontend:test -- src/views/RecordCollectionView.test.tsx src/views/SessionChatView.attachments.test.tsx src/views/SessionChatView.permissions.test.tsx` plus the new controller tests.
- [ ] Add migration and prompt tests for bounded snapshots and cross-Session rejection. Run `cargo test -p qa-scribe-core chat` and `cargo test -p qa-scribe-tauri commands::chat`.
- [ ] Run `bun run bindings:check` and `bun run tauri:commands:check` after the contract changes.


**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe.

On macOS, run `QA_SCRIBE_E2E_SPEC=ask-ai-context.e2e.mjs bun run e2e`. On Linux, run `QA_SCRIBE_E2E_SPEC=ask-ai-context.e2e.mjs GDK_BACKEND=x11 xvfb-run -a bun run e2e`. Save the runner receipt for the lanes below.

- [ ] Lane 1. Open Ask AI on a manually saved finding. Save `artifacts/ask-ai/C1/lane-1/result.png`. Pass when the correct finding and Session appear without another conversation being created.
- [ ] Lane 2. Open Ask AI on a generated finding. Save `artifacts/ask-ai/C1/lane-2/result.png`. Pass when the same controls and context contract apply.
- [ ] Lane 3. Open Ask AI on manual and generated test cases. Save `artifacts/ask-ai/C1/lane-3/result.png`. Pass when Test cases draft identity and the correct body reach the provider fixture.
- [ ] Lane 4. Send after editing an existing record without saving. Save `artifacts/ask-ai/C1/lane-4/result.png`. Pass when the payload contains the labelled edited snapshot and the record remains dirty.
- [ ] Lane 5. Switch target during a running response. Save `artifacts/ask-ai/C1/lane-5/result.png`. Pass when the running turn retains its original target and history does not change identity.
- [ ] Lane 6. Paste an image with the native clipboard and remove it. Save `artifacts/ask-ai/C1/lane-6/result.png`. Pass when the ordinary image pipeline works and edited message text remains intact.
- [ ] Lane 7. Use a provider that rejects images. Save `artifacts/ask-ai/C1/lane-7/result.png`. Pass when the existing capability explanation appears and input is retained.
- [ ] Lane 8. Expand, close, and reopen the panel in a short window. Save `artifacts/ask-ai/C1/lane-8/result.png`. Pass when the composer, attachments, chat history, and document position survive.
- [ ] Lane 9. Restart the app and return to the Session. Save `artifacts/ask-ai/C1/lane-9/result.png`. Pass when persisted targets and images replay with the original turn.
- [ ] Lane 10. Use Notes chat, tool permissions, and Add conversation to note. Save `artifacts/ask-ai/C1/lane-10/result.png`. Pass when existing approvals and handoff behavior still pass.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. App-owned chat-open latency and existing Notes chat render latency with 100 messages and four images.
- [ ] Probe. At trunk measure Notes chat opening. At head repeat Notes and Ask AI opening, 20 times each, with the same native fixture. Exclude provider latency.
- [ ] Baseline. Record trunk Notes p95 and payload size. Record the new Ask AI metric separately.
- [ ] Rule. Fail if Notes p95 exceeds 1.2 times trunk plus 50 ms, or Ask AI opening p95 exceeds 250 ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy the key screenshots into `docs/design/ask-ai/implemented/C1/` and attach their head-SHA receipt.
- [ ] Record a 30 to 60 second video in the isolated native app. Save `artifacts/ask-ai/C1/review.mp4`.
- [ ] Post the screenshots and video in chat for the operator. Stop at merge-ready until the operator reviews the result.

**Merge.**

- [ ] Obtain the parent's clean verdict at the exact head SHA with unit, live, and perf receipts.
- [ ] Complete Bugbot triage and the operator review gate.
- [ ] Rebase onto current trunk and refresh evidence when the patch or relevant base changes.
- [ ] Let the operator merge. Record the merged SHA before starting the dependent phase.

## Phase 3. Review and apply local refinement proposals (R1)

**Depends on.** C1.

**Files.**

- [ ] Add typed refinement proposal domain and persistence beside chat domain and chat service modules.
- [ ] Add a validated proposal response contract in the chat completion boundary. Run `bun run bindings:generate` and update its migration as required.
- [ ] Add proposal review UI beside `frontend/src/views/ChatMessageList.tsx`. Edit `frontend/src/app/recordActions.findings.ts`, `recordActions.drafts.ts`, `recordPersistence.findings.ts`, and `recordPersistence.drafts.ts`.
- [ ] Edit `crates/qa-scribe-core/src/services/session_service/findings.rs` and `drafts.rs`. Update both `update_finding` and `update_draft` request contracts, including Tauri commands in `src-tauri/src/commands/findings.rs` and `generation.rs`.
- [ ] Edit rich-document conversion and managed-image preservation only where the apply path needs it.
- [ ] Add focused proposal tests and `e2e/specs/ask-ai-refinement.e2e.mjs`.

**Build.**

- [ ] Name the shape first. Define a versioned `RefinementProposal` with proposal ID, turn ID, target identity, base fingerprint, and proposed editable fields.
- [ ] Validate a completed structured proposal at the boundary. Keep normal Markdown chat responses supported. Never apply partial output or infer an edit from arbitrary prose.
- [ ] Show title and body changes before apply. Show any allowed finding metadata changes separately. Preserve facts and mark suggestions as suggestions.
- [ ] Apply through the existing local editor actions. Update `body`, `bodyJson`, and `bodyFormat` together. Preserve managed image nodes and unknown metadata.
- [ ] Compare the current local editor fingerprint before apply. If the target changed, offer regeneration or a fresh review instead of overwriting.
- [ ] Add atomic expected-base checks to both `SessionService::update_finding` and `SessionService::update_draft` for proposal-derived saves. Carry the precondition through both Tauri update commands and frontend persistence coordinators. Reject a concurrent external update without silently dropping either edit.
- [ ] Keep ordinary Save as persistence. Support Dismiss and Undo within the proposal workflow. Record proposal status without disabling the rest of chat.
- [ ] Handle target deletion, navigation, duplicate apply, restart, and failed Save. Never redirect a proposal to a newly selected record.
- [ ] Include a readable proposal summary and result in conversation export and Note handoff. Adding the conversation to a note must not apply the proposal again.

**You see.**

- [ ] Ask for a clearer expected result and review the suggested replacement beside the original finding.
- [ ] Apply it and see an unsaved editor change. Save it through the existing record action.
- [ ] Edit the record after requesting refinement and see a visible stale-proposal explanation.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add literal proposal validation, wrong-target, stale-local-base, duplicate apply, Undo, and image-preservation cases. Run `bun run frontend:test -- src/app/useAppController.workflows.record-editing.test.ts src/editor/editorDocument.test.ts` plus the new proposal tests.
- [ ] Add transactional compare-and-update, wrong-Session, deleted-target, and restart cases. Run `cargo test -p qa-scribe-core` for the affected service and storage modules.
- [ ] Run `bun run bindings:generate`, `bun run bindings:check`, and `bun run tauri:commands:check` after the proposal and expected-base changes.


**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe.

On macOS, run `QA_SCRIBE_E2E_SPEC=ask-ai-refinement.e2e.mjs bun run e2e`. On Linux, run `QA_SCRIBE_E2E_SPEC=ask-ai-refinement.e2e.mjs GDK_BACKEND=x11 xvfb-run -a bun run e2e`. Save the runner receipt for the lanes below.

- [ ] Lane 1. Refine a finding title and expected result. Save `artifacts/ask-ai/R1/lane-1/result.png`. Pass when the review shows exact before and after content before any editor mutation.
- [ ] Lane 2. Refine manual and generated test cases. Save `artifacts/ask-ai/R1/lane-2/result.png`. Pass when the same proposal path updates the intended Test cases draft.
- [ ] Lane 3. Apply a completed proposal. Save `artifacts/ask-ai/R1/lane-3/result.png`. Pass when the record becomes dirty and storage remains unchanged until Save.
- [ ] Lane 4. Save and reopen the record. Save `artifacts/ask-ai/R1/lane-4/result.png`. Pass when the displayed rich body and stored body representations agree.
- [ ] Lane 5. Edit locally while the provider is responding. Save `artifacts/ask-ai/R1/lane-5/result.png`. Pass when apply detects the changed base and preserves the newer edit.
- [ ] Lane 6. Change the stored record through an isolated second client. Save `artifacts/ask-ai/R1/lane-6/result.png`. Pass when proposal Save rejects the stale stored base atomically.
- [ ] Lane 7. Apply then Undo, or dismiss a proposal. Save `artifacts/ask-ai/R1/lane-7/result.png`. Pass when the original content and managed image references remain intact.
- [ ] Lane 8. Switch to another record or delete the target. Save `artifacts/ask-ai/R1/lane-8/result.png`. Pass when the proposal never edits the wrong record and explains the unavailable target.
- [ ] Lane 9. Restart after a proposal or fail Save deliberately. Save `artifacts/ask-ai/R1/lane-9/result.png`. Pass when proposal identity and recoverable editor input remain available.
- [ ] Lane 10. Double-click apply and use unrelated free-form chat. Save `artifacts/ask-ai/R1/lane-10/result.png`. Pass when one local change occurs and the conversation remains open-ended.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Local proposal review and apply latency, plus ordinary record Save latency.
- [ ] Probe. At trunk time equivalent manual edit and Save of a 100 KB rich record with images. At head repeat it and apply the equivalent proposal, 20 runs each.
- [ ] Baseline. Record trunk p95 manual edit-to-paint and Save durations before measuring the new proposal path.
- [ ] Rule. Fail if proposal apply p95 exceeds 100 ms, or existing Save p95 exceeds 1.2 times trunk plus 50 ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy the key screenshots into `docs/design/ask-ai/implemented/R1/` and attach their head-SHA receipt.
- [ ] Record a 30 to 60 second video in the isolated native app. Save `artifacts/ask-ai/R1/review.mp4`.
- [ ] Post the screenshots and video in chat for the operator. Stop at merge-ready until the operator reviews the result.

**Merge.**

- [ ] Obtain the parent's clean verdict at the exact head SHA with unit, live, and perf receipts.
- [ ] Complete Bugbot triage and the operator review gate.
- [ ] Rebase onto current trunk and refresh evidence when the patch or relevant base changes.
- [ ] Let the operator merge. Record the merged SHA before starting the dependent phase.

## Phase 4. Draft Jira issues and collect missing details in chat (J1)

**Depends on.** R1.

**Files.**

- [ ] Add a provider-neutral structured chat interaction contract beside the chat domain, completion validation, persistence, and prompt builders.
- [ ] Add Jira draft and question renderers beside `ChatMessageList.tsx`. Keep `SessionChatView.tsx` as the shared composer.
- [ ] Update `CONTEXT.md` with the remote Jira action terms while retaining the local Jira Bug Draft definition.
- [ ] Add an app-side Jira draft state module and validated answer actions. Run `bun run bindings:generate` and add schema migration tests.
- [ ] Add Jira metadata fixtures and `e2e/specs/ask-ai-jira-draft.e2e.mjs`.

**Build.**

- [ ] Name the shape first. Define `JiraActionDraft` with a versioned content snapshot and a discriminated destination. Use NewIssue with project and issue type, or Subtask with parent identity, inherited project, and subtask type.
- [ ] Define correlated `ChatQuestion` and `ChatAnswer` records for a known draft version. Keep destination, type, required-field, review, and recovery states explicit.
- [ ] Prove and select the structured response contract before implementation. Treat model output as untrusted input. Validate schemas, sizes, target identity, draft version, and question ownership.
- [ ] Keep the reviewed design clickable. Render known choice controls in chat and allow equivalent typed answers. A plain-text fallback must remain usable and explain unsupported structured interaction.
- [ ] Record clicked and typed answers as the same correlated user-message shape. Include readable questions, answers, and draft summaries in transcript export and Note handoff. Never serialize executable controls as note content.
- [ ] Make Draft Jira issue prepare the selected Finding or Test cases draft without assuming a story or two subtasks. Preserve the source type. Use finding reproduction details for a Finding and test scope for Test cases. Show the content draft before the destination follow-up.
- [ ] Keep the existing Jira Copy action and `copyRecordForJira` as clipboard-only behavior. `JiraActionDraft` is a chat-owned remote-action draft, distinct from the existing local Jira Bug Draft. Do not create a remote issue from Copy.
- [ ] Ask for a new issue or a subtask only when the request has not already answered that choice. Preserve all known answers.
- [ ] For a new issue, ask for the missing project, then obtain its creatable non-subtask types, including custom types through the coding agent tools. Keep optional parent relationships separate from the subtask path.
- [ ] For a subtask, search or accept a Jira parent link or key, validate it, derive its project, and obtain the configured subtask types.
- [ ] For a finding subtask request, resolve the exact configured name Finding subtask to its real type ID. If unavailable, explain the limitation and retain the draft. Never silently substitute another type or create Jira configuration. Other configured types remain available when the user explicitly selects one.
- [ ] If several valid subtask types exist, list Finding subtask first with a Recommended label for a Finding. Do not preselect it. If it is the sole valid type, select it and show the selection in review. For Test cases, offer the actual configured types without assuming the finding-specific default.
- [ ] Ask only for missing required fields for the selected project and type. Clear only invalid dependent answers when project, parent, or type changes.
- [ ] Keep images in the ordinary chat pipeline. List proposed Jira evidence transfers separately in review. Pasting into chat does not itself upload evidence to Jira. Enable file transfer only for a connector qualified in J2.
- [ ] Persist the draft, correlated answers, and metadata provenance across restart. Retain the draft on missing tools, denied reads, no results, or unsupported provider interaction.
- [ ] In J1 keep the creation action visibly unavailable with a clear phase boundary. Do not show a working Create button until J2 can execute and report the result.

**You see.**

- [ ] Choose Draft Jira issue and see the finding drafted before the first missing-detail question.
- [ ] Choose an existing parent and see Finding subtask among the actual project types.
- [ ] Answer with either a click or a message and keep the same draft and general chat composer.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add correlated-answer, stale-question, route-change, draft-resume, schema-validation, and typed-answer cases. Create `frontend/src/app/sessionChat.jiraDraft.test.ts` and `frontend/src/views/ChatQuestion.test.tsx`. Run `bun run frontend:test -- src/app/sessionChat.jiraDraft.test.ts src/views/ChatQuestion.test.tsx`.
- [ ] Add fixtures for custom type IDs, absent Finding subtask, no subtask support, project-specific required fields, permission denial, and tool unavailability. Run `cargo test -p qa-scribe-core chat` and the affected Tauri chat tests.
- [ ] Replay supported provider transcripts through the structured boundary. Preserve existing plain-text and image conversation fixtures. Run `bun run bindings:generate` and `bun run bindings:check`.


**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe.

On macOS, run `QA_SCRIBE_E2E_SPEC=ask-ai-jira-draft.e2e.mjs bun run e2e`. On Linux, run `QA_SCRIBE_E2E_SPEC=ask-ai-jira-draft.e2e.mjs GDK_BACKEND=x11 xvfb-run -a bun run e2e`. Save the runner receipt for the lanes below.

All ten lanes below use deterministic fixtures in the built app. They prove interaction and recovery, not a real Jira connection.

- [ ] Lane 1. Start from a saved Finding and repeat with saved Test cases, with no Jira details supplied. Save `artifacts/ask-ai/J1/lane-1/result.png`. Pass when the content draft appears first and no story or subtasks are invented.
- [ ] Lane 2. Ask explicitly for a new Bug in a named project. Save `artifacts/ask-ai/J1/lane-2/result.png`. Pass when the agent retains those answers and asks only for remaining required details.
- [ ] Lane 3. Choose Subtask and search or paste a valid parent. Save `artifacts/ask-ai/J1/lane-3/result.png`. Pass when the selected parent determines the project and invalid parents cannot advance.
- [ ] Lane 4. Use fixture metadata for a project with Finding subtask and another custom type. Save `artifacts/ask-ai/J1/lane-4/result.png`. Pass when the fixture-returned type names and IDs populate the choices and Finding subtask is used when selected.
- [ ] Lane 5. Use fixture metadata where Finding subtask is absent. Save `artifacts/ask-ai/J1/lane-5/result.png`. Pass when the draft stays available and the chat explains the missing type without silent substitution.
- [ ] Lane 6. Use fixture metadata where Finding subtask is the sole subtask type. Save `artifacts/ask-ai/J1/lane-6/result.png`. Pass when it is selected without a redundant question and remains visible in review.
- [ ] Lane 7. Change parent, project, or type after answering fields. Save `artifacts/ask-ai/J1/lane-7/result.png`. Pass when only invalid dependent choices are cleared and the content draft survives.
- [ ] Lane 8. Type an answer, then click an old question from history. Save `artifacts/ask-ai/J1/lane-8/result.png`. Pass when the typed answer advances the current draft and the stale question cannot mutate it.
- [ ] Lane 9. Restart with a draft and a pasted screenshot. Save `artifacts/ask-ai/J1/lane-9/result.png`. Pass when the draft, answers, images, and optional Jira attachment choice are retained.
- [ ] Lane 10. Deny metadata access or remove Jira tools. Save `artifacts/ask-ai/J1/lane-10/result.png`. Pass when the visible limitation preserves the draft and free-form chat remains usable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Chat question render latency and redundant Jira metadata requests.
- [ ] Probe. Measure ordinary fixture chat render at trunk. At head use deterministic identical metadata responses and replay 20 draft questions with the same dataset.
- [ ] Baseline. Record trunk p95 chat render and a fixed expected metadata-call sequence before measuring the draft path.
- [ ] Rule. Fail if question render p95 exceeds 250 ms, ordinary chat render exceeds 1.2 times trunk plus 50 ms, or unchanged answers trigger repeated metadata requests in the same draft version.

**Review gate.** The operator reviews before merge.

- [ ] Copy the key screenshots into `docs/design/ask-ai/implemented/J1/` and attach their head-SHA receipt.
- [ ] Record a 30 to 60 second video in the isolated native app. Save `artifacts/ask-ai/J1/review.mp4`.
- [ ] Post the screenshots and video in chat for the operator. Stop at merge-ready until the operator reviews the result.

**Merge.**

- [ ] Obtain the parent's clean verdict at the exact head SHA with unit, live, and perf receipts.
- [ ] Complete Bugbot triage and the operator review gate.
- [ ] Rebase onto current trunk and refresh evidence when the patch or relevant base changes.
- [ ] Let the operator merge. Record the merged SHA before starting the dependent phase.

## Phase 5. Create reviewed Jira issues through coding-agent tools (J2)

**Depends on.** J1.

**Files.**

- [ ] Edit provider protocol adapters and duplex completion only where a verified external-result contract requires it.
- [ ] Add a durable Jira action request and result receipt beside chat service persistence and migrations.
- [ ] Connect Jira review controls to existing chat start, permission, cancellation, recovery, and message result handling.
- [ ] Add deterministic provider fixtures and `e2e/specs/ask-ai-jira-action.e2e.mjs`. Add an explicitly armed real-Jira test workflow.

**Build.**

- [ ] Name the shape first. Define `JiraActionRequest` with operation ID, reviewed draft version, exact destination and type IDs, field payload, and selected attachment transfers.
- [ ] Track action state as Ready, Dispatching, WaitingForPermission, Completed, Failed, or OutcomeUnknown. Distinguish a pre-dispatch failure from a verified remote rejection inside Failed. Store a correlated result with Jira key and URL only when verified.
- [ ] Make Create issue in Jira or Create subtask in Jira send the reviewed operation through the selected coding agent tools. Revalidate current draft identity and required fields at dispatch.
- [ ] Keep Jira credentials and transport inside the configured coding agent connection. Do not add a separate Jira login, token store, or app-owned REST client.
- [ ] Record a real capability receipt before enabling a connector combination. Include provider and CLI versions, tool names and schemas, creatable-type discovery, parent lookup, required-field metadata, create, read, search, and upload support. Discover optional features independently. Do not infer a tool exists from Jira Cloud REST documentation.
- [ ] Reuse existing provider permission controls and policy. Keep draft review separate from tool approval. Do not interpret Approve once as an edited form submission.
- [ ] Normalize a successful correlated create-tool result into a receipt. If only assistant text is returned, require a trusted read-only lookup with operation correlation before marking Completed. Do not infer creation from prose or an unrelated existing issue key.
- [ ] Use the returned issue key for exact read-back when a correlated tool result exists. For uncertain-outcome search, add an operation-specific label beginning `qa-scribe-op-` plus the operation UUID only when create metadata permits labels and the connector can search them. Show that label in the reviewed payload. Match the exact label, project, type, and parent. Zero or multiple matches remain OutcomeUnknown.
- [ ] If the connection cannot carry and search the correlation label, keep post-dispatch uncertainty unresolved and offer manual Jira search. Do not require automatic reconciliation or advertise exactly-once creation for that connection.
- [ ] Disable duplicate dispatch while an operation is pending. Persist the operation before dispatch. Do not claim server-side exactly-once creation when Jira tools do not provide it.
- [ ] On cancellation, timeout, lost completion, or app restart after dispatch, show OutcomeUnknown and reconcile through read-only Jira lookup where reliable correlation exists. Never automatically resend creation.
- [ ] If reliable reconciliation is unavailable, keep the unknown result visible and offer an explicit search or open-in-Jira path. Require a deliberate new creation request after the user resolves the prior outcome.
- [ ] For a definite failure before dispatch, allow retry with the same reviewed draft. For a verified remote rejection, retain the draft and correct the reported fields. For changed metadata or a changed draft, require a new review.
- [ ] After verified success, show the real Jira key and link and any attachment warnings. Keep the source Finding or Test cases unchanged and the same chat available.
- [ ] For explicitly selected evidence, resolve each managed attachment through the existing ownership checks and stage a temporary copy for the reviewed operation. Pass only approved absolute staged paths to a connector that accepts file uploads. Keep the provider cwd neutral and respect its file-access permissions. Retain staged files while an uncertain upload needs recovery, then clean them through the owning operation lifecycle.
- [ ] Qualify staged-file access and upload schema before enabling Jira evidence transfer. When unsupported, retain chat images and explain that Jira upload is unavailable. Never expose the whole managed attachment store or serialize image bytes into a text request.
- [ ] Qualify each provider and tool combination independently. Preserve the text draft when a selected provider cannot support reliable structured action results.

**You see.**

- [ ] Review one Finding subtask under the intended parent and dispatch exactly that request on a qualified connector.
- [ ] See the verified issue key and link in the same chat, then ask another question.
- [ ] Cancel or lose a response after dispatch and see an uncertain outcome instead of a misleading failure or automatic duplicate.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add reviewed-payload, duplicate-click, stale-draft, permission identity, pre-dispatch failure, uncertain outcome, and restart cases. Run the new action tests and `bun run frontend:test -- src/views/SessionChatView.permissions.test.tsx src/app/sessionChat.permissionRecovery.test.tsx`.
- [ ] Add provider-result correlation and transaction tests. Run `cargo test -p qa-scribe-core chat`, `cargo test -p qa-scribe-tauri chat_duplex`, and the affected Tauri chat command tests.
- [ ] Repeat existing tool-authorization workflows for codex, claude, and copilot. Do not count fixture output as real Jira creation proof.


**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe.

On macOS, run `QA_SCRIBE_E2E_SPEC=ask-ai-jira-action.e2e.mjs bun run e2e`. On Linux, run `QA_SCRIBE_E2E_SPEC=ask-ai-jira-action.e2e.mjs GDK_BACKEND=x11 xvfb-run -a bun run e2e`. Save the runner receipt for the lanes below.

All ten lanes below use deterministic fixtures in the built app. They prove interaction and recovery, not a real Jira connection.

- [ ] Lane 1. Create a reviewed new issue through deterministic Jira fixtures in the native app. Save `artifacts/ask-ai/J2/lane-1/result.png`. Pass when the captured fixture request matches the reviewed payload and one correlated fixture key is rendered.
- [ ] Lane 2. Create Finding subtask under a fixture parent. Save `artifacts/ask-ai/J2/lane-2/result.png`. Pass when the fixture receipt confirms the exact configured type ID, parent, and inherited project.
- [ ] Lane 3. Approve once when the provider asks. Save `artifacts/ask-ai/J2/lane-3/result.png`. Pass when the original correlated tool request executes under existing permission rules.
- [ ] Lane 4. Deny the create tool request. Save `artifacts/ask-ai/J2/lane-4/result.png`. Pass when the draft stays available and the app does not claim issue creation.
- [ ] Lane 5. Double-click Create and repeat after a slow response. Save `artifacts/ask-ai/J2/lane-5/result.png`. Pass when one pending operation exists and the app dispatches no duplicate request.
- [ ] Lane 6. Fail before dispatch. Save `artifacts/ask-ai/J2/lane-6/result.png`. Pass when the app shows a definite failure and retains a safely retryable reviewed draft.
- [ ] Lane 7. Cancel or time out after the remote create succeeds. Save `artifacts/ask-ai/J2/lane-7/result.png`. Pass when the app shows OutcomeUnknown and never automatically creates again.
- [ ] Lane 8. Restart during a dispatched operation with both searchable-correlation and no-correlation fixtures. Save `artifacts/ask-ai/J2/lane-8/result.png`. Pass when the searchable exact match becomes Completed without a second create, while the unsupported case remains OutcomeUnknown.
- [ ] Lane 9. Stage selected evidence for an upload-capable fixture, then force an upload failure. Save `artifacts/ask-ai/J2/lane-9/result.png`. Pass when the fixture receives the intended staged bytes, issue status stays accurate, and the upload failure stays separate.
- [ ] Lane 10. Switch provider, continue chat, and retest Notes permissions. Save `artifacts/ask-ai/J2/lane-10/result.png`. Pass when unsupported result contracts are explained and existing general chat workflows remain intact.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. App-owned action dispatch and result rendering latency, excluding Jira and model network time.
- [ ] Probe. At trunk measure normal tool-enabled chat dispatch with the deterministic provider. At head measure 20 reviewed dispatches and result renders with the same fixture.
- [ ] Baseline. Record trunk p95 dispatch overhead and separate model and tool durations before head measurements.
- [ ] Rule. Fail if dispatch p95 exceeds the larger of 250 ms and 1.2 times trunk plus 50 ms, or result rendering p95 exceeds 100 ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy the key screenshots into `docs/design/ask-ai/implemented/J2/` and attach their head-SHA receipt.
- [ ] Record a 30 to 60 second video in the isolated native app. Save `artifacts/ask-ai/J2/review.mp4`.
- [ ] Post the screenshots and video in chat for the operator. Stop at merge-ready until the operator reviews the result.
- [ ] Keep real Jira execution disabled until an explicitly armed qualification passes in a designated test project. Record the provider, CLI, connector, tool schemas, reviewed payload, verified created key, parent, and Finding subtask type ID. No live access means unqualified support, not a passing fixture-based integration claim.
- [ ] Qualify optional correlation search and evidence upload separately. A missing capability leaves that option disabled. Prove uncertainty remains safe when those options are absent.

**Merge.**

- [ ] Obtain the parent's clean verdict at the exact head SHA with unit, live, and perf receipts.
- [ ] Complete Bugbot triage and the operator review gate.
- [ ] Rebase onto current trunk and refresh evidence when the patch or relevant base changes.
- [ ] Let the operator merge. Record the merged SHA before starting the dependent phase.

## Close the program

- [ ] Check every completed phase against its acceptance evidence. Keep unavailable provider and platform combinations visible. Require at least one armed real-Jira creation qualification before declaring the requested Jira action delivered.
- [ ] Update user documentation for Ask AI, record context, refinement review, Finding subtask, and external-action recovery.
- [ ] Preserve screenshots, videos, head SHAs, and test receipts with the final report.
- [ ] Register every created PR with T3 and inspect `list_thread_pull_requests` before handoff.
- [ ] Hand back the delivered behavior and remaining limits. Do not mark the program complete from passing unit tests alone.

## Appendix A. Prototype evidence

The design source was inspected on local branch `main` at SHA `1c34f3e229ccf471241f7dfc7248b4d73c2ce6d9`.
The prototypes were not committed. Their source is a throwaway design instrument, not production code.

The app-cohesion prototype remains at `/tmp/qa-scribe-ask-ai-v3-20261024/`.
The Jira follow-up prototype was created at `/tmp/qa-scribe-jira-v4-20261024/`.
A durable [prototype copy](design/ask-ai/prototype.html) uses the corrected **Finding subtask** label.
The prototype uses [synthetic evidence](design/ask-ai/checkout.png) for its image example.
Serve it with `python3 -m http.server 5189 --bind 127.0.0.1 --directory docs/design/ask-ai` and open `http://127.0.0.1:5189/prototype.html`.
Use its phase buttons to inspect the new-issue and subtask paths. The toolbar is a review aid and does not ship.

- [Draft and first follow-up](design/ask-ai/01-draft-followup.png) records the draft-first direction.
- [Finding subtask choice](design/ask-ai/03-subtask-type.png) records the corrected configured-type example.
- [Review before creation](design/ask-ai/05-review.png) records the proposed final J2 action, not the J1 drafting-only slice.
- [Prototype observations](design/ask-ai/prototype-observations.json) records synthetic interaction checks at desktop and short-window sizes. It predates the wording correction and contains the former synthetic custom-type name. It also lists historical screenshot captures retained only in the original scratch directory. The durable copy includes the three linked current screenshots only.
- [Corrected-label render receipt](design/ask-ai/render-receipts.json) records the three current screenshots and label verification.

The prototypes demonstrated two destination paths, preserved draft content, typed answers, unknown-parent handling, context retention, image paste events, and an independently scrolling composer.
A source-derived reproduction showed the old scroller's 32-pixel top padding above a sticky action row. The revised prototype measured a zero-pixel gap.
This is prototype evidence only. S1 must reproduce and verify the actual native-app defect.
Browser ClipboardEvent dispatch does not prove native clipboard access. Simulated Jira lookup and creation do not prove a connector integration.
The collaborative browser timed out twice, so T3 headless HTML preview supplied the browser evidence.
No production implementation, real Jira write, native-platform qualification, or performance baseline was completed in this planning task.
All examples are synthetic. The user's screenshot supplied layout reference only and is not included in the assets.

## Appendix B. Alternatives rejected

A separate AI system for each record would duplicate the existing conversation, images, and permission handling.
The selected design reuses one Session conversation and records the target of each turn.
A refinement-only panel would exclude the requested general chat and coding-agent actions.
A default story with two subtasks would invent scope. The draft-first flow asks for the missing destination and type instead.
The former custom subtask name is superseded by the operator's explicit **Finding subtask** correction.
A hardcoded Jira type ID would break across projects and installations. Resolve the actual configured ID.
A plain Markdown-only Jira flow would be the smallest code change, but it would omit the selected clickable follow-ups.
J1 therefore includes an explicit structured interaction contract. Plain text remains a capability fallback, not the only planned experience.
A broad provider-native question bridge would expand the provider protocol surface. Compare it against a bounded app-owned interaction envelope before choosing.
An app-owned Jira credential store and client would duplicate the coding agent's tools. Keep external execution in that configured connection.
Automatic retry after cancellation could create another Jira issue. Track uncertainty and reconcile before a deliberate new request.

## Appendix C. Risks

S1 changes a shared scroll container. It must preserve creation screens, keyboard focus, normal collection spacing, and Notes layout.
C1 needs durable context ownership across reload and turn replay. A mutable selected-record reference is insufficient.
C1 must bound record snapshots and distinguish unsaved editor content from saved content. Session identity and record identity are separate from chat revision.
Existing Copilot Chat explicitly rejects image attachments. Reuse its visible limitation. Do not advertise cross-provider image parity without new native proof.
R1 needs a local stale-base guard and an atomic storage guard. Existing record updates have no expected-base argument.
R1 must preserve canonical rich text, image references, and unknown metadata. Updating HTML alone can leave the displayed editor unchanged.
J1 introduces a new structured interaction contract. Current adapters expose text and permissions, not typed Jira forms or arbitrary user-question replies.
J1 must validate model-proposed choices against tool-derived metadata. A synthetic Finding subtask example does not prove that type exists in a real project.
J1 must distinguish project-specific required fields, permissions, and Jira product configuration. The draft remains useful when metadata access is unavailable.
J2 needs a trustworthy result before marking creation complete. Current duplex output does not return a normalized Jira issue object.
J2 cannot promise server-side exactly-once creation without tool support. Operation IDs prevent local duplicates but do not guarantee remote idempotency. Automatic lookup requires the visible, supported correlation label. Without it, OutcomeUnknown remains unresolved.
J2 requires a designated Jira test project and working coding-agent connection for live proof. Do not use the user's production issues for tests by default.
J2 must stage approved image copies and qualify the connector upload interface before offering file transfer. The current neutral provider cwd does not provide managed-store access.
J2 must keep issue creation and optional evidence upload as separate outcomes. A failed upload does not undo a created issue.
Native macOS and Linux control must be qualified at execution time. Missing native control blocks the affected platform's release proof.
All performance budgets are proposed acceptance criteria. No speedup or regression was measured in this task.

## Appendix D. Links and reading list

Read these current entry points before implementation.

- [Shared record collection](../frontend/src/views/RecordCollectionView.tsx), [rich record view](../frontend/src/views/RichRecordView.tsx), and [app shell](../frontend/src/app/AppShell.tsx).
- [Chat view](../frontend/src/views/SessionChatView.tsx), [message rendering](../frontend/src/views/ChatMessageList.tsx), and [chat actions](../frontend/src/app/sessionChat.actions.ts).
- [Chat domain](../crates/qa-scribe-core/src/domain/chat.rs), [chat service](../crates/qa-scribe-core/src/services/session_service/chat.rs), and [turn preparation](../src-tauri/src/commands/chat/preparation.rs).
- [Trusted chat instructions](../crates/qa-scribe-core/src/chat/mod.rs) and [typed image input](../crates/qa-scribe-core/src/chat/input.rs).
- [Provider tool defaults](../crates/qa-scribe-core/src/ai/chat.rs), [protocol events](../crates/qa-scribe-core/src/ai/chat_protocol.rs), and [duplex execution](../src-tauri/src/commands/ai/chat_duplex.rs).
- [Record editor conversion](../frontend/src/editor/editorDocument.ts), [finding actions](../frontend/src/app/recordActions.findings.ts), and [finding storage updates](../crates/qa-scribe-core/src/services/session_service/findings.rs).
- [Test cases draft actions](../frontend/src/app/recordActions.drafts.ts), [draft persistence](../frontend/src/app/recordPersistence.drafts.ts), [draft storage updates](../crates/qa-scribe-core/src/services/session_service/drafts.rs), and [draft commands](../src-tauri/src/commands/generation.rs).
- [Product language](../CONTEXT.md) and [existing Jira clipboard export](../frontend/src/editor/clipboardExport.ts).
- [Existing chat authorization plan](chat-tool-authorization-plan.md), [chat images plan](manual-formats-chat-attachments-plan.md), and [native development and testing](development.md).
- [Jira create issue and metadata API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/).
- [Jira issue and subtask creation](https://support.atlassian.com/jira-software-cloud/docs/create-a-work-item-and-a-subtask/).
- [Jira subtask type configuration](https://support.atlassian.com/jira-cloud-administration/docs/configure-sub-tasks/).

Exa search and page fetch, plus Ref's official API reader, established the Jira rules during the design turn on 24 October 2026.
Those sources describe Jira Cloud. They do not establish the configured project types, permissions, fields, or available tools in the user's Jira connection.
Apply [how](/Users/vriesd/.codex/plugins/cache/pstack-for-codex-local/pstack-for-codex/0.4.0/skills/how/SKILL.md) to each phase before editing. Apply architect to C1, R1, J1, and J2 boundary changes.
Use interrogate if context ownership, structured interactions, or external-result recovery remain contested.
Keep the local decision trail at `/tmp/qa-scribe-ask-ai-plan-20261024/decisions.tsv` under the installed show-me-your-work skill.

Experience First kept general chat, images, and follow-ups in the existing panel.
Model the Domain separated Session scope, per-turn item context, local proposals, Jira destinations, and uncertain external outcomes.
Sequence Work into Verifiable Units separated the five PRs so each ends in a reviewable state.
Prove It Works kept source findings and prototype observations separate from native and real-Jira proof.

## Appendix E. Planning and capability receipt

One read-only how investigator completed on Codex `gpt-6.1-sol`, reasoning high, service tier priority.
The generic investigator received the portable Poteto persona and shared read-only checkout access. No installed custom agent profile was found in the checked agent locations.
The parent checked the reported protocol-event, duplex-output, image-capability, and record-update boundaries directly.
The parent owns this document and copied design evidence.
One independent Grok `grok-4.7` review, reasoning high, found seven material planning gaps. The parent corrected them and reran structural checks. These corrections have not received a second independent review.
The scoped comment review found nine CSS narration comments in the copied prototype. The parent removed all nine. No MUST KILL symbols, suppressions, application fixes, or constraint encodings were needed. No implementation owner, goal, recurring task, commit, push, or PR was created.
The [checker receipt](design/ask-ai/plan-check.txt) records structural validation of the final document. It does not prove the future implementation.
The local [independent review receipt](/tmp/qa-scribe-ask-ai-plan-20261024/review-summary.md) and decision log record the plan choices and outstanding proof requirements. The [parent response](design/ask-ai/review-response.md) records the accepted corrections.
The first six log rows were appended together after the decisions. They are a retrospective batch. A later correction clarifies that no real Jira type ID was discovered.
Encode Lessons in Structure drove the use of the installed plan checker for headings, verification blocks, and lane evidence requirements.
