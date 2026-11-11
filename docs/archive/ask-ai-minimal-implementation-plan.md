# Implement the minimal Ask AI experience

Implement the design accepted on 2026-10-25 for manual and generated findings and test cases.
Keep Notes conversations separate. Reuse the existing chat engine and ordinary record Save.
Deliver one feature PR, followed by the normal release metadata PR.
Implementation and cleanup are complete locally. Independent review accepted the feature and both recovery repairs.
The actual application screens have been presented. User screen acceptance and protected CI remain pending.
The full local `bun run verify` invocation failed in unchanged host-tooling tests for Rust LSP stdin handling and process cleanup permissions.
Affected checks and the remaining verification steps passed separately. This is not a green aggregate verification result.
The final lifecycle cleanup passed 68 affected tests and the parent's 15 original review probes.
The seven-case native run preceded that final cleanup. No newer native pass is claimed.

## How to read this

Run the four phases in order. Check each box against its named result.
Use one implementer and one independent review of the stable feature diff.
Phases are work boundaries inside one feature PR, not four stacked PRs.
Use the installed Poteto Feature playbook for implementation, narrowed by the focused verification policy below.
Keep the existing CI requirements. Do not restore the earlier ten-lane and repeated benchmark program.

The approved normal interface contains Ask AI, the record title, messages, Message, Attach images, Send, and Close.
Show Apply to editor only for a valid suggestion. Keep a quiet Jira tip in the empty state.
Conditional error recovery, Stop, and tool permissions remain available when needed.
Do not add History, Continue, New chat, expansion, a record model picker, starter cards, or a Jira wizard.

## Phase 1. Connect the small interaction to the existing engine

- [x] Compare the root overlay at `8a93675907a77f9628a25639dd27c7a8fa255b6a` with the stopped author's partial repairs in `t3-d0c64033`. Preserve both before choosing changes. Do not apply either wholesale.
- [x] Keep `ChatRef`, immutable conversation ownership, record snapshots, and the existing proposal and Save types. Add no conversation store or schema migration.
- [x] Make an open Ask AI action focus the same record composer, including when it contains text or images. The current `emptyStarter` condition incorrectly limits reuse to an empty chat.
- [x] Make an idle close persist input successfully before hiding. On failure, keep the panel and literal input visible. Reopening a settled chat starts fresh and leaves its stored rows intact.
- [x] Reuse the existing response contract for record assistance. Ordinary typed requests must permit an optional validated refinement for the bound record. Notes messages keep their current contract.
- [x] Adjust the trusted record instructions to answer questions, improve content when requested, and use configured tools when requested. Do not infer the request by matching English keywords.
- [x] Keep the existing parser, target validation, readable fallback, image framing, and permission policy. A plain answer or a Jira request must not require a local patch.

Use `sessionChat.send.ts`, `chat_questions.rs`, and `chat/response.rs` for that bounded contract adjustment.
Today `Message` resolves to Conversation, whose prompt forbids a refinement field. Removing the Refine starter alone would leave the promised Apply flow disconnected.
Reuse the existing Refinement purpose for record-owned assistance, with an optional patch and instructions that permit ordinary answers and requested tools.
Keep old stored contracts readable. Do not change the meaning of historical Notes messages or Retry snapshots.

### Preserve recovery without restoring a history browser

- [x] Before removing History, resolve pending work through exact existing references. Use engine attention and durable unresolved-stage metadata, not a list of completed conversations.
- [x] If the same record has a running turn, uncertain start, failed input save, pending permission, interrupted turn, or unresolved stage, reopen that exact unfinished work with a short reason. Do not start another provider operation automatically.
- [x] Once that work is settled, the next closed-panel Ask AI launch starts fresh. Never resume a completed conversation automatically or show the Notes transcript in record chat.
- [x] Apply the same rule after navigation or restart. Preserve missing-source recovery and legacy Notes stage ownership. Do not attach a missing source to the visible fallback record.
- [x] Reuse the existing record Save and Discard controls to settle staged edits. Keep Stop, Retry, and Recheck conditional. Do not silently cancel an external action because the panel closed.
- [x] Repair the stale Notes permission and Recheck callback scope in `useSessionChat.ts`, using the preserved reproduction. Dropping History does not remove that defect.

This is the one operational exception to fresh launch. The accepted screenshots show the settled state.
Show the exception during the final application review. It must not become a general conversation picker.
If the existing recovery APIs cannot support this boundary, stop and explain that specific gap before adding a new subsystem.

Finish this phase when public-controller checks show a fresh ordinary launch, unchanged Notes, a literal retained failed input, and reachable unfinished work.
Check record assistance at the core and Tauri boundary for both record kinds before changing the presentation.

## Phase 2. Replace the larger interface and delete its support code

- [x] Match [finding](design/ask-ai-minimal/finding.png), [test case](design/ask-ai-minimal/test-case.png), and [conversation](design/ask-ai-minimal/conversation.png).
- [x] Use existing ActionButton, base tokens, field rules, and docked-panel styles. Keep Message and text Send. Use one transcript scroll area with the composer outside it.
- [x] In `RecordCollectionView.tsx` and `AppShell.tsx`, remove record Continue, History, and the Session conversation-history trigger. Keep the ordinary record actions.
- [x] In `AppChat.tsx`, remove History, New chat, expansion, and the record model control. Keep exact bound references, source state, error recovery, Notes presentation, and conditional permissions.
- [x] In `SessionChatView.tsx`, remove record starters, the intent badge and Use as message, routine saved-status copy, and record diagnostic disclosure. Keep actual loading, operation, and failure feedback.
- [x] For record questions, render follow-up text in the transcript and accept ordinary typed answers. Remove record choice and action-handoff buttons. Keep shared stored response data and Notes behavior.
- [x] Simplify `ChatProposalReview.tsx` for record presentation. Show the suggested content and one Apply to editor action without requiring Review refinement, duplicate Before and Suggested editors, or routine state narration.
- [x] Keep target checks, pending prevention, conflict errors, and prepared-stage recovery. A recovered stage may need Keep current edits. Ordinary Undo and Discard remain in the record editor.
- [x] Show every field that Apply would change, including finding metadata. A simpler view must not conceal a severity or status change.
- [x] After migrating callers, remove the dead code listed below. Search imports, callbacks, CSS selectors, tests, and fixtures before deleting each item.

### Delete code that only serves removed interactions

| Candidate | Planned change | Required remainder |
| --- | --- | --- |
| `views/ConversationHistory.tsx` | Delete the general browser and its rendering branch. | Recovery-only routing from Phase 1, including legacy stages. |
| `useAskAiContext.ts` | Remove `continueLast`, `canContinue`, `historyScope`, dialog loading state, `showHistory`, `closeHistory`, and expansion state. | Fresh launch, exact ownership, source hydration, input persistence, and recovery references. Retain a narrow durable recovery lookup if needed. |
| `conversationPresentation.ts` | Remove `continueEntry` and the obsolete empty-only reuse rule. Trim helpers after their last caller disappears. | Keep shared identity, source capture, and stage helpers that still protect live work. |
| `AppChat.tsx` | Remove `Memento` and `RememberedConversation` if their only purpose is arbitrary History and Continue restoration. | Reclicking an open panel keeps input and focus. Recovery need not restore old scroll coordinates. |
| `sessionChat.context.ts` | Remove History and Continue callbacks from `RecordChatActions`. Remove reveal callbacks only after recovery no longer uses them. | Record selection and source identity. |
| `NextModelSelection.tsx` and `model-selection.css` | Remove the new compact presentation branch and its record-only CSS. | Keep the existing picker in Notes and Settings, including focus and catalog fixes. |
| `ask-ai.css` | Remove History dialog, expansion, starter, intent-badge, and compact-model rules once unused. | Keep shared Notes styles and the small record panel. |

The table uses filenames within `frontend/src/`, unless another directory is named.
Do not delete `useConversationSnapshot.ts` merely because it is small. It subscribes to the exact bound conversation.
Do not delete the backend history API or stored conversation rows because the browser UI is gone.
Do not remove shared question, Jira, or refinement protocol types while stored data or Notes still uses them.

Finish this phase when the small interface works for both record kinds and removed UI has no production callers.
Run frontend checks and affected tests. Record the actual production files and lines removed without setting a deletion quota.

## Phase 3. Reduce redundant tests and verify the retained behavior

Delete a test only when its feature is removed or its observable guarantee has a named retained owner.
For each deletion, record that reason in the feature PR. Do not delete a failing regression merely to make the suite pass.

| Test or fixture | Action |
| --- | --- |
| `views/ConversationHistory.test.tsx` | Remove dialog scoping and archive browsing tests with the component. Move its unique legacy-stage guarantee to the recovery controller tests first. |
| `app/AppShell.askAi.navigation.test.tsx` | Remove Continue and History filter-reveal scenarios. Retain ordinary dirty-editor navigation coverage and a recovery-specific wrong-source regression if that route survives. |
| `app/AppShell.askAi.test.tsx` | Keep fresh launch and Notes isolation. Replace the combined Continue, expand, DOM-identity, and New chat scenario with reclick and close-to-fresh behavior. Remove starter intent UI assertions. |
| `app/conversationPresentation.test.ts` | Delete the `continueEntry` test. Replace empty-only reuse assertions with one public reclick behavior check rather than a new helper-only matrix. |
| `components/NextModelSelection.test.tsx` | Remove the compact-presentation case and harness option if no caller remains. Keep shared model persistence, failure, focus, and keyboard coverage. |
| `app/useAppController.chat.context.test.ts` | Replace the expectation that occupied input creates a new chat while the panel is open. Keep literal snapshots, failed persistence, rapid launches, missing sources, and stale navigation coverage. |
| `e2e/specs/ask-ai-conversation-isolation.e2e.mjs` | Replace History, Continue, expansion, starter, and record model-catalog journeys with the focused walkthrough below. Keep user-visible isolation and persistence assertions. |
| `scripts/ask-ai-isolation-evidence.mjs` and its test | Replace the fixed ten-scenario receipt with the actual retained scenario set. Keep rejection of skipped, missing, and failed results. Remove whole-checkout hashing if it has no remaining qualification consumer. |
| `scripts/run-e2e.mjs` and its tests | Remove the extra restart invocation only if the maintained routing restart spec covers the same retained contract. Preserve fixture isolation and required native CI coverage. |

Keep the existing tests for Notes loading and submission, image failures, permission ownership, stale targets, malformed responses, source deletion, and Retry.
Keep the record Save, compensation, accepted-base, cross-Session, and prepared-stage regressions. They prove data integrity, not optional UI.
Do not recombine previously isolated test files just to reduce file count. Remove duplicate behavior, not working isolation boundaries.
Parameterize the common launch check across manual and generated findings and test cases. Do not repeat the whole suite for every origin.

### Run a bounded verification sequence

- [x] During edits, run the affected tests and `bun run frontend:check`. Add literal before and after assertions for changed behavior.
- [x] Run core coverage with `cargo test -p qa-scribe-core --test chat_refinement --test chat_questions --test chat_conversation_ownership --test saved_proposal_recovery` when changing response contracts or recovery.
- [x] Run `cargo test -p qa-scribe-tauri commands::chat` for the changed preparation and completion boundary. Regenerate bindings only if public types changed, using `bun run bindings:generate`, then check them.
- [x] Run the native walkthrough through the existing maintained driver with synthetic provider fixtures. Do not call real providers or Jira.
- [x] Run one full `bun run verify` on the stable feature candidate, as required by `docs/development.md`. Do not also run both aggregate gates and every constituent command on unchanged source.
- [x] Request one independent review of ownership, recovery, and the actual diff. Fix proven defects, then rerun affected checks. Broaden only when the fix or a new failure justifies it.

Use these native journeys, not ten copies of a single scenario.

1. Open fresh Ask AI on each record kind. Verify literal Notes text, images, and submission state stay unchanged.
2. Send an improvement request with an image. Review the proposed fields, Apply, inspect unchanged storage, then Save. Verify the exact stored body and record identity.
3. Reclick preserves current input. Close and a settled reopen create a fresh conversation. Stored earlier input remains intact.
4. Hide or navigate away during unfinished work. Return or restart, recover the exact reference, and resolve a permission or uncertain start without an automatic resend.
5. Use a typed Jira request and typed follow-up through the existing agent path. Verify no app-owned Jira wizard or new integration is needed. Synthetic responses only.
6. Check the desktop, short window, and keyboard path. Messages, Message, Attach images, Send, conditional permission controls, and Close remain reachable.

Use `QA_SCRIBE_E2E_SPEC=ask-ai-conversation-isolation.e2e.mjs bun run e2e` after updating that maintained spec.
On Linux, use `GDK_BACKEND=x11 QA_SCRIBE_E2E_SPEC=ask-ai-conversation-isolation.e2e.mjs xvfb-run -a bun run e2e`.
Use the existing routing restart spec for retained process-recovery coverage when removing the duplicate isolation restart run.
Keep screenshots and a short result log. A missing native capability remains a limitation, not a pass.
Do not start another benchmark campaign. Investigate a specific delay only if the walkthrough exposes it.

Finish when required checks pass, the independent review has no blocking findings, and the user has reviewed the actual application screenshots.
If two fixes fail for the same reason, reconsider that design before another patch.

## Phase 4. Merge and publish through the existing CI process

- [ ] Update `CONTEXT.md` and replace obsolete implementation instructions with this plan. Keep the accepted screenshots. Remove unused speculative prototype and benchmark helpers only after checking callers.
- [ ] Open one feature PR. Register it with the thread and require current protected CI success. Present actual finding and test-case screens before merge.
- [ ] After feature acceptance, recheck current main and the latest version. Use `bun run bump <version> --dry-run`, then the normal release metadata PR.
- [ ] Require the release PR's protected checks and follow the project's normal merge-triggered tagging workflow. Do not push a manual tag to bypass CI.
- [ ] Verify the successful release run, exact tag target, published assets, signed checksums, APT version, and non-draft release.

## Evidence and scope limits

Planning inspected the root at `8a93675907a77f9628a25639dd27c7a8fa255b6a` plus the preserved uncommitted interface overlay.
The screenshots in `docs/design/ask-ai-minimal/` preserve the accepted visual direction. They are prototypes with synthetic content.
No runtime tests or benchmarks were run for this planning pass. Deletion candidates are source-grounded, not yet proven unused after implementation.
Use the repository's verification guidance in `docs/development.md` and the existing `.github/workflows/` release process.

Subtract Before You Add removes the abandoned interactions and their support code.
Laziness Protocol keeps the merged engine and one feature PR.
Test Behavior, Not Implementation removes UI-shape assertions while preserving data-integrity regressions.
Experience First preserves the accepted minimal interface and reviews its real implementation before publication.

This compact plan follows the user's explicit request to simplify the process. The generic Poteto plan checker requires ten live lanes and a benchmark block per PR. Its template is not the verification policy for this plan.
