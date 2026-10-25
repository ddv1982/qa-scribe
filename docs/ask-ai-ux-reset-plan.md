# Simplify Ask AI before implementation resumes

The minimal design is accepted. Continue with [the implementation and cleanup plan](ask-ai-minimal-implementation-plan.md).
This document retains the design-reset history and is no longer the execution checklist.

The historical phases below describe the stopped design-reset process.
Local implementation now follows the accepted minimal plan. Publication still requires final acceptance and protected CI.
This plan replaces the remaining execution steps in `ask-ai-conversation-isolation-plan.md`.
Keep its completed storage and routing work. Reconsider the unfinished interface against this plan.

## Phase 0. Preserve the stopped work

- [x] Stop the active interface repair and performance preparation tasks. Both report interrupted with no pending child runs.
- [x] Record the root baseline as `8a93675907a77f9628a25639dd27c7a8fa255b6a`, on `feat/ask-ai-fresh-chat-ux`.
- [x] Keep the uncommitted interface changes in the root checkout. Keep the author's partial repairs in `t3-d0c64033`.
- [ ] Before implementation resumes, compare those two copies and identify which changes serve the approved design.

Do not reset files, roll back merged work, or treat unfinished repairs as accepted.
Conversation ownership and routing are already on main. The visible redesign remains unmerged.
The current interface has two unresolved review findings involving History source selection and stale Notes permission callbacks.
If either affected path remains, retain its reproduction and fix it during implementation.
Prior evidence and handoffs are under `/tmp/qa-scribe-ask-ai-isolation-impl/`.

## Phase 1. Agree on the experience

Write a short interaction description and show one recommended layout using the app's existing styling.
Use a disposable prototype with synthetic content. Do not connect it to the provider or change production behavior.
Build another layout only if the first exposes a specific unresolved choice.

Start with these proposed rules.

- Put one **Ask AI** action on findings and test cases.
- Opening Ask AI from a closed panel starts a fresh conversation about that record. Notes history stays in Notes.
- Clicking Ask AI while that same record's panel is already open focuses its composer.
- Show the record title once as compact context. Keep the record and its chat visibly associated.
- Give the transcript the available height. Keep the composer and Send reachable without competing outer and transcript scrolling.
- Support free conversation, pasted images, refinement, and coding-agent actions through the existing engine.
- Make improvement the primary purpose for both findings and test cases. Keep the same chat interaction for manual and generated records.
- Show a plain empty state, the record title, messages, a composer, image attachment, Send, and Close.
- Reuse the app's Inter type scale, colour tokens, spacing, ActionButton styles, flat docked panels, and labelled Message field. Use a text Send button and plain role-labelled messages.
- Remove starter cards, the history menu, the model picker, and Jira-specific buttons from this minimal design.
- Keep Jira discoverable through one quiet tip. Users can request it in ordinary chat. Preserve **Finding subtask** when that configured type is relevant.
- Show one **Apply to editor** action when the response includes proposed changes. Keep the normal Save step.
- Close hides the panel and preserves the underlying conversation data. Reopening Ask AI starts fresh. Defer a history browsing interface.
- Keep Continue and History out of the record toolbar. Do not add a second Session-wide history control for this change.
- Keep Note submission controls in Notes. Remove routine saved-state banners from the record chat.

Review three representative screens.

1. A fresh empty chat beside its finding or test case, with improvement as the main purpose.
2. An active conversation with an image, a response, and a refinement review.
3. The same conversation in a short window, with its composer accessible.

Walk through opening, sending, applying a suggestion, closing, and starting fresh for both record kinds.
Settle the fresh-versus-resume behavior and visible controls during this review.
Finish this phase when the user approves both the interaction and the screens.
Do not start implementation from a verbal description alone.

## Phase 2. Implement the approved design in one focused change

Map each approved interaction to the existing ownership and routing APIs.
Reuse the image, provider, permission, question, proposal, and Save paths.
Compare the preserved local work against the approved screens. Keep useful changes and remove UI that no longer earns its place.
Do not introduce another conversation store, Jira integration, scheduler, or Save framework.
If the design requires a substantial backend change, explain the gap before expanding the work.

Use one implementation owner. Keep production edits separate from prototype work.
Finish with actual application screenshots matching the approved states.
Keep the change local until the user can review the implemented experience.

## Phase 3. Verify the changed behavior once

Use focused tests during editing. Add regression coverage for changed behavior or a reproduced defect.
Keep the existing regression suite. Do not add duplicate cases merely to increase coverage counts.

Use one focused native walkthrough with synthetic provider responses to check these results.

1. Fresh Ask AI contains the correct record and no Notes transcript. Notes remain unchanged.
2. Free text and a pasted image send through the existing path. Tool permissions remain usable.
3. Close preserves underlying conversation data. A fresh launch stays fresh and references the correct record.
4. A refinement changes the editor only after Apply. Storage changes through the ordinary Save action.
5. The short layout keeps messages, composer, and any required permission controls accessible. An error offers a reachable recovery action without automatic resend.

Run `bun run frontend:check` and the relevant frontend tests while editing.
Run the project's required checks on the stable candidate and require protected CI success before merge.
Use `QA_SCRIBE_E2E_SPEC=<selected-spec> bun run e2e` for the relevant maintained native spec.
Record the actual spec and result. Do not invent a new test system for this plan.

Use one independent review of the stable diff, focused on conversation ownership and changed interactions.
After a fix, rerun affected tests and review that fix. Repeat broader checks only when the change or a new failure justifies them.
Investigate slow tests once and fix their isolation where needed. Do not repeatedly split tests or extend deadlines without a demonstrated cause.
If two fixes fail for the same reason, stop and reconsider the design before another patch.

Do not start another performance campaign for this interface change.
If the walkthrough exposes a delay, measure that specific interaction before deciding whether a performance fix is needed.
Required repository checks still apply. A failed required check blocks merge.

## Phase 4. Review the result and release through CI

Present the implemented desktop and short-window screens, the walkthrough result, and any remaining limitations.
Wait for the user's review of the actual interface before merging.
Use one feature PR for the remaining interface change unless a concrete dependency requires a split.
Require the reviewed changes and current protected CI success.

After acceptance, recheck the current version and follow `docs/development.md` and the repository's release workflow.
Use the normal version-bump PR and merge-triggered release process.
Verify the resulting tag, published artifacts, signatures, and APT publication.
Do not choose a version or start publication during this planning reset.

## Keep the process proportional

Use Experience First to approve the visible workflow before writing more production code.
Use Laziness Protocol to reuse the merged foundation and reduce controls.
Use Sequence Work into Verifiable Units to separate design approval, implementation, verification, and publication.

This reset deliberately replaces the earlier mandatory ten-lane and repeated benchmark program with focused checks and normal CI.
Do not start parallel implementation or audit rounds by default.
Report progress through a changed screen, a proven defect, or a completed phase.
The latest reduced Phase 1 prototype is `/tmp/qa-scribe-ask-ai-ux-reset/cohesive.html`.
Earlier prototypes in that directory are superseded for design review.
The prototype uses synthetic content and simulated replies. Production source remains unchanged during Phase 1.
Prototype review is pending. Do not treat its screenshots as native application verification.
