# Improve laptop workflows and QA output sharing

Delegation and capability fallbacks follow the installed Poteto `references/codex-agent-runtime.md`.
Improve capture, record creation, generation, sharing, and Chat handoff for testers.
Keep the current visual style, TypeScript tooling, storage schema, and provider protocols.
Deliver five sequential PRs, UX-1 through UX-5. These are plan labels, not assigned GitHub numbers.
Implementation and the final release are authorized. Use OpenAI models only. Merge each reviewed phase through protected CI, then publish one final version through the maintained release workflow.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. Check a box only when its evidence exists, such as a command result, native screenshot, interaction recording, or commit SHA.
The body is a how-to. The appendices hold findings, alternatives, and risks.
Run implementation through the installed `poteto-mode/playbooks/feature.md`, then Opening a PR. Use Babysit and Shipping only within the active user authorization.
The parent owns integration, authoritative checks, PRs, and any authorized merge or release.
Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
Use the bounded verification approach already recorded in [the tsc-rs plan](tsc-rs-only-plan.md). Ten live lanes mean ten scenario labels, run sequentially in disposable sessions by the same owner. They do not require ten agents, ten machines, or ten profiles.
Treat UX-1 and UX-2 as the first delivery checkpoint. Review their actual usability before adding the later workflow changes.
Use existing tests and the maintained native desktop harness. Do not add another performance framework or long memory study. No performance improvement is claimed by this plan.

## Program checklist

### Arm the program

- [x] Record the observed UX problems and compare two disposable dialog layouts. Evidence is Appendix A and `artifacts/ux-plan-v0815/prototype/`.
- [x] At implementation start, fetch current `origin/main`, record the SHA, and create a fresh branch.
- [ ] Reproduce each phase's relevant baseline before editing production files. UX-1 is captured; later phase baselines remain pending.
- [x] Do not create a goal, schedule, heartbeat, or hourly audit for this bounded task without a separate user request. Keep the queue table and throughput checkpoint in `artifacts/ux-improvements/decisions.tsv`.
- [x] Read the installed Feature, Control UI, Opening a PR, and applicable review skills. Use `git show origin/main:package.json` for current repository commands. Skills are installed outside this repository.
- [x] Keep Windows, new AI providers, database migrations, dependency upgrades, compiler changes, a new UI framework, and a visual rebrand outside this program.

Implementation started from `origin/main` at `efaf81615b9ab2e14b904db2b58d186d4417bf6d` on `ux/laptop-action-layout`. The fresh native UX-1 baseline reproduces the original measurements under `artifacts/ux-improvements/UX-1/baseline/`. Later phases refresh trunk and reproduce their own affected baseline.

### Spawn owners

- [ ] Use one OpenAI implementation owner at a time. Use one independent OpenAI review for each final PR patch. Do not use Claude.
- [ ] Follow the dependency order `UX-1 -> UX-2 -> UX-3 -> UX-4 -> UX-5`. Branch each successor from current main after its predecessor merges within the active authority.
- [ ] Hold each phase to its file list. Shared views, controller wiring, CSS, and E2E fixtures have one writer.
- [x] Record the throughput checkpoint. Shared UI and controller files prevent useful parallel implementation. Run source review separately from the sole desktop and Cargo writer. Do not duplicate independent review after a clean verdict without a changed patch or new defect.
- [ ] Review real screenshots and a short interaction video for every phase. Stop at merge-ready when the active authority does not include merge.

### PR mechanics, for every PR

- [ ] Use normal repository branch protection and the available forge, normally `gh`. Open and link each PR to the T3 thread. Record its actual number beside the UX label.
- [ ] Run `bun run frontend:check`, `bun run frontend:test`, and the phase's focused checks before the PR-facing push. Keep hooks enabled.
- [ ] Run deslop before commits and no-comments before independent review. Keep code changes specific to the observed problem.
- [ ] Record head, base, stable patch-id, test receipts, and source-bound screenshots. Triage automated comments against real behavior.
- [ ] Preserve existing CI. Extend relevant native scenarios rather than adding a duplicate matrix. Do not bump the version or publish a release for each phase.

### Verdict and merge, for every PR

- [ ] Require an independent exact-patch OpenAI verdict, all protected checks, and completed review triage. Reuse unchanged evidence only within Shipping's patch retention rules.
- [ ] Provide actual native screenshots and a 30 to 60 second video. Label operating system, theme, viewport, fixture scope, and any missing platform proof.
- [ ] On a verification failure, retain the receipt and diagnose the observation method and feature once. Fix a proven cause. Do not rerun until green, add retry loops, or relax the pass rule.
- [ ] Merge only within current authorization. Do not infer new release authority from the earlier compiler release task.

### Boot recipe, for every live lane

- [ ] Use the exact candidate head, pinned tools, a frozen frontend install, and task-owned application data. Use deterministic fixture providers and no real service requests.
- [ ] Drive the real Tauri desktop through the installed `cursor-team-kit:control-ui` skill and maintained `e2e/wdio.conf.mjs` harness. Use the collaborative T3 preview for web prototypes when applicable.
- [ ] Record actual `innerWidth` and `innerHeight` after resize settles. Wait for committed UI state and dialog animation before capture. Reset scroll origin for initial visibility checks.
- [ ] Check geometry, clipping ancestors, keyboard focus, and hit targets. A control below the viewport is reachable by scroll, but does not pass an initial-visibility requirement.
- [ ] Save proof under `artifacts/ux-improvements/<UX-id>/`. Use the file names below. Preserve failures separately and stop only processes owned by the launch receipt.
- [ ] Capture laptop layouts at 1280 by 720 and 1024 by 768. Check 640 by 520 and the production minimum 320 by 520 through an isolated E2E configuration that permits those sizes. The current E2E configuration has a 640-pixel minimum. Do not change production window limits silently.
- [ ] Verify affected flows on Linux and macOS before claiming support on both. Use one supported macOS desktop host for UI proof, plus existing CI for packaging. Missing access remains an explicit gap.

## Keep actions reachable in laptop windows (UX-1)

**Depends on.** None.

**Files.**

- [x] Fix sizing and scroll ownership in `frontend/src/styles/editor.css`, `frontend/src/styles.css`, and `frontend/src/styles/collections.css`. The existing responsive fallback required no change.
- [x] Add structural action regions in `frontend/src/views/SessionChatView.tsx` and `frontend/src/views/RichRecordView.tsx`. The Note view required CSS changes only.
- [x] Extend `e2e/specs/ui-polish.e2e.mjs` using the existing actual-viewport calibration in `e2e/specs/generation-preflight-layout.e2e.mjs`.

**Build.**

- [x] Fix the horizontal action overflow at 1024 pixels. Let action groups reflow or expose clearly labelled overflow actions instead of clipping.
- [x] Keep the Chat composer and Send action together. Let the conversation scroll without pushing its primary action below the initial laptop viewport.
- [x] Keep record Edit, Save, and Discard reachable without scrolling past an empty preview. Preserve useful document space and existing long-content scrolling.
- [x] Preserve the narrow-window fallback. At 320 by 520, allow document scrolling and compact labelled actions instead of requiring every control on one row.

**You see.**

- [x] At both laptop sizes, initial Chat shows its composer and Send action, a new record shows its editing action, and Note actions fit inside the viewport. Save the matched baseline and candidate captures.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Run `bun run frontend:check` and `bun run frontend:test`. Keep behavioral accessibility checks for any changed action container. Do not use JSDOM dimensions as native layout proof.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head are bounded scenario labels under the boot recipe.

- [x] Lane 1. Open Note at 1280 by 720 in dark mode. Save `note-dark-laptop.png`. Pass when all primary actions are visible and hit-testable.
- [x] Lane 2. Repeat in light mode. Save `note-light-laptop.png`. Pass when actions and focus remain clear.
- [x] Lane 3. Open Note at 1024 by 768. Save `note-1024.png`. Pass when no action extends beyond the viewport.
- [x] Lane 4. Open empty Chat at laptop height. Save `chat-empty.png`. Pass when composer and Send are initially visible.
- [x] Lane 5. Open a long fixture conversation. Save `chat-long.png`. Pass when transcript scrolling leaves the composer usable.
- [x] Lane 6. Open an empty manual record. Save `record-empty.png`. Pass when Edit is initially visible.
- [x] Lane 7. Edit a long record with evidence. Save `record-long.png`. Pass when Save and Discard remain usable without losing content access.
- [x] Lane 8. Open 640 by 520. Save `narrow-640.png`. Pass when creation, navigation, and task actions remain reachable without horizontal page scrolling.
- [x] Lane 9. Open 320 by 520 through the isolated configuration. Save `minimum-320.png`. Pass when controls remain reachable and content can scroll without clipping action labels.
- [x] Lane 10. Use keyboard navigation with a long title and visible error. Save `keyboard-error.png`. Pass when focus is visible and status content does not cover actions.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [x] Metric. Record initial action reachability, horizontal overflow, and ten local edit or navigation completions.
- [x] Probe. Extend the existing native geometry receipt. Run matching fixtures on trunk first and head second. Keep profiling and builds outside the walkthrough.
- [x] Baseline. Capture the known below-fold Send and Edit actions and the clipped 1024-pixel action before the fix.
- [x] Rule. Fail on more than 1 pixel of page overflow, an obscured required action, a lost edit, or any local action that exceeds the existing 10-second WebDriver wait. Do not claim a speedup from this check.

**Review gate.** Review the interaction before merge.

- [ ] Provide the operator with matched screenshot pairs and `UX-1-review.mp4`, a 30 to 60 second video of resize, scroll, and keyboard use. Obtain the independent verdict at the same patch.

Local evidence is `artifacts/ux-improvements/UX-1/UX-1-handoff.json`. Final Linux X11 native proof passed two tests with no skips at all four sizes. Parent frontend checks and 572 tests passed. The 34-second video and matched screenshots are retained locally. Hosted macOS and exact-patch review remain pending.

**Merge.**

- [ ] Require protected CI, exact-patch review, and applicable user authority. Keep UX-1 independently revertible without data migration.

## Open new records directly in the editor (UX-2)

**Depends on.** UX-1.

**Files.**

- [ ] Edit `frontend/src/app/recordActions.ts`, the current controller navigation types, `frontend/src/app/AppShell.tsx`, and `frontend/src/views/RecordCollectionView.tsx`.
- [ ] Extend `frontend/src/app/useAppController.workflows.record-editing.test.ts`, `frontend/src/app/useAppController.autosave.records.test.ts`, `frontend/src/views/RecordCollectionView.test.tsx`, and the maintained manual-testware E2E scenario.

**Build.**

- [ ] Retain the returned created record ID. Pass a single-use edit intent containing session identity, record kind, and record identity through the existing controller boundary.
- [ ] Select the new record, enter editing mode, and focus its title. Consume the intent once so ordinary library navigation does not reopen editing.
- [ ] Clear or adjust filters that hide the new record. Do not select the first record by sort order.
- [ ] Preserve existing persistence and navigation settlement. Describe Note autosave and record saving accurately. Do not claim record edits persist only when Save is clicked because navigation can already flush dirty records.
- [ ] Keep Discard behavior explicit. Restore the existing saved snapshot without silently deleting the newly created record.

**You see.**

- [ ] One New Testware or New Finding action opens the correct editable record with its title focused. No additional Edit click is required.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run focused tests for creation identity, one-time intent consumption, stale session completion, active filters, failed Save retaining edits, Discard, and navigation settlement. Run `bun run frontend:test` and the manual-testware E2E scenario.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head are bounded scenario labels under the boot recipe.

- [ ] Lane 1. Create a test case in an empty session collection. Save `new-test-case.png`. Pass when its title is focused in edit mode.
- [ ] Lane 2. Create a Finding. Save `new-finding.png`. Pass when the correct Finding opens directly in edit mode.
- [ ] Lane 3. Create among existing records. Save `new-among-existing.png`. Pass when the returned new ID is selected.
- [ ] Lane 4. Create while a search filter excludes the default title. Save `new-with-filter.png`. Pass when the new editor is visible.
- [ ] Lane 5. Rename, edit, and Save. Save `record-saved.png`. Pass when reopening shows the exact stored title and content.
- [ ] Lane 6. Edit and Discard. Save `record-discarded.png`. Pass when the saved snapshot returns.
- [ ] Lane 7. Inject a fixture persistence failure. Save `record-save-failed.png`. Pass when input remains editable and an actionable error appears.
- [ ] Lane 8. Navigate while a record is dirty. Save `record-navigation.png`. Pass when current settlement and recovery protections retain the intended content.
- [ ] Lane 9. Open an existing library record. Save `existing-preview.png`. Pass when the creation intent does not turn ordinary navigation into editing.
- [ ] Lane 10. Create using the command palette at laptop height. Save `new-keyboard.png`. Pass when one creation action reaches the visible focused editor.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Count user actions from New to a focused title and record persistence outcomes across ten creations.
- [ ] Probe. Use the maintained creation scenario with the same seeded records on trunk first and head second. Record command and navigation events.
- [ ] Baseline. Record the current New, scroll, and Edit sequence before implementation.
- [ ] Rule. Require one creation activation, zero extra Edit activations, no duplicate records, and local settlement within the existing 10-second wait. Do not add network calls or periodic work.

**Review gate.** Review the interaction before merge.

- [ ] Provide the operator with creation and failure screenshots and `UX-2-review.mp4`, a 30 to 60 second video. Obtain the independent verdict at the same patch.

**Merge.**

- [ ] Require protected CI, exact-patch review, and applicable user authority. Keep persistence semantics unchanged.

## Put test choices before execution details (UX-3)

**Depends on.** UX-2.

**Files.**

- [ ] Edit `frontend/src/workflows/generationPreflight.tsx`, `frontend/src/views/SettingsView.tsx`, `frontend/src/components/NextModelSelection.tsx`, and their existing tests.
- [ ] Edit the relevant rules in `frontend/src/styles/shell.css`, `frontend/src/styles/model-selection.css`, and `frontend/src/styles/responsive.css`.
- [ ] Extend `e2e/specs/generation-preflight-layout.e2e.mjs` and preserve the current model-selection scenarios.

**Build.**

- [ ] Adopt prototype B's task-first order. Show material and execution choice in one short summary, then Output, Depth, and Test design. Put full provenance and model controls inside expandable execution details.
- [ ] Keep warnings, blockers, pending model writes, and destructive Summary consequences visible outside collapsed details. Expand details automatically when user action there is required.
- [ ] Preserve default delegation, saved overrides, source information, timestamps, and global preference scope. Do not show an unresolved CLI default as a known model.
- [ ] Update the dialog's focus handling to exclude hidden controls in collapsed details. Verify native select and model-popover placement after the move.
- [ ] Simplify Settings into provider, model, and reasoning choices with an optional diagnostic section. Keep readiness and concrete recovery steps visible. Link existing setup guidance rather than executing installation or sign-in commands automatically.

**You see.**

- [ ] At 1280 by 720, the initial test-case dialog shows Output, Depth, Auto, and Generate without scrolling. All presets and execution details remain available at normal text sizes.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run the existing generationPreflight, NextModelSelection, SettingsView, settings defaults, and controller model-selection tests. Add behavior checks for visible blockers, preserved values, and collapsed-details keyboard handling.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head are bounded scenario labels under the boot recipe.

- [ ] Lane 1. Open test-case generation in dark mode at laptop height. Save `preflight-dark.png`. Pass when the common choices and Generate are initially visible.
- [ ] Lane 2. Repeat in light mode. Save `preflight-light.png`. Pass when hierarchy and focus remain clear.
- [ ] Lane 3. Select each technique, output, and depth using fixture generation. Save `preflight-options.png`. Pass when the submitted request preserves the selected values.
- [ ] Lane 4. Expand execution details. Save `execution-expanded.png`. Pass when provenance, model selection, and preference scope remain accessible.
- [ ] Lane 5. Tab and Shift-Tab with details collapsed and expanded. Save `execution-keyboard.png`. Pass when focus never enters hidden controls or escapes the dialog.
- [ ] Lane 6. Show an unavailable or stale provider fixture. Save `execution-blocked.png`. Pass when the reason and recovery action are visible without opening details.
- [ ] Lane 7. Change a model while its preference write is pending. Save `model-pending.png`. Pass when generation remains disabled until the correct selection settles.
- [ ] Lane 8. Open Summary and Finding preflights. Save `other-preflights.png`. Pass when their actual consequences remain explicit.
- [ ] Lane 9. Use Settings with no ready provider. Save `provider-setup.png`. Pass when setup guidance is actionable and no command runs automatically.
- [ ] Lane 10. Open model selection at 640 by 520. Save `model-popover-narrow.png`. Pass when choices, warnings, and confirmation remain reachable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Count steps to accept defaults, metadata sections shown initially, preference writes, and provider invocations.
- [ ] Probe. Run the same preflight and discovery fixtures on trunk first and head second. Use existing event receipts, not a new benchmark system.
- [ ] Baseline. Capture the current repeated model details and initial test-design clipping at laptop height.
- [ ] Rule. Require no extra mandatory confirmation for accepted defaults, zero provider invocations from opening or expanding details, and exactly the intended preference writes. Keep local actions within the existing 10-second wait.

**Review gate.** Review the interaction before merge.

- [ ] Provide the operator with collapsed, expanded, and blocked screenshots and `UX-3-review.mp4`, a 30 to 60 second video. Obtain the independent verdict at the same patch.

**Merge.**

- [ ] Require protected CI, exact-patch review, and applicable user authority. Do not change provider protocols or generation prompts to solve a layout problem.

## Make finished output easier to copy and find (UX-4)

**Depends on.** UX-3.

**Files.**

- [ ] Edit `frontend/src/views/SessionEditorView.tsx`, `frontend/src/views/RichRecordView.tsx`, `frontend/src/views/OutputLibraryView.tsx`, `frontend/src/app/AppShell.tsx`, and `frontend/src/app/copyActions.ts`.
- [ ] Align collection and action labels in `frontend/src/views/TestwareView.tsx`, `frontend/src/app/commandRegistry.ts`, related notices, and relevant documentation. Preserve domain names and generated bindings.
- [ ] Extend `frontend/src/views/OutputLibraryView.test.tsx`, `frontend/src/views/copySuccess.test.tsx`, clipboard tests, and the maintained clipboard E2E scenario. Extend the terminology guard narrowly where useful.

**Build.**

- [ ] Add a visible Copy for Jira text action to the Note and output record. Keep screenshot copying separate and label the first-screenshot limit accurately.
- [ ] Add Copy for Jira to the selected library record. Reuse the existing clipboard exporter and retain the full selected record identity through library normalization.
- [ ] Keep copy feedback scoped to record ID and action. Do not change the active Session, save a different Session's edits, or silently open a library record to copy it.
- [ ] Use Test cases for this collection's visible navigation and creation labels. Keep Testware as the documented domain umbrella. Do not rename routes, `Draft`, `kind: 'testware'`, command IDs, or database values.
- [ ] Change the empty session state to offer a central Create Session action while retaining the header action. Keep examples optional and local.

**You see.**

- [ ] A user can copy the selected saved library output directly. Labels identify the output and destination without tooltip discovery or a Session switch.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run OutputLibraryView, copySuccess, clipboardExport, and richContentConsistency tests, `bun run terminology:check`, and `node --test scripts/check-frontend-terminology.test.mjs`. Assert exact copied content and record identity.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head are bounded scenario labels under the boot recipe.

- [ ] Lane 1. Copy a Note with formatting. Save `copy-note.png`. Pass when the labelled action copies the expected Jira content.
- [ ] Lane 2. Copy a saved test case. Save `copy-test-case.png`. Pass when the selected title and body reach the clipboard.
- [ ] Lane 3. Copy a Finding. Save `copy-finding.png`. Pass when the correct Finding reaches the clipboard.
- [ ] Lane 4. Copy from the test-case library. Save `copy-library.png`. Pass when no Session switch occurs.
- [ ] Lane 5. Select duplicate titles from different Sessions. Save `copy-identity.png`. Pass when each copied payload matches its selected record ID.
- [ ] Lane 6. Copy while another Session has dirty edits. Save `copy-dirty-other-session.png`. Pass when those edits are neither lost nor substituted into the payload.
- [ ] Lane 7. Inject a clipboard failure. Save `copy-failed.png`. Pass when no success state is shown and retry remains explicit.
- [ ] Lane 8. Copy a record with several screenshots. Save `copy-screenshot.png`. Pass when the label states the scope and the correct supported image is copied.
- [ ] Lane 9. Navigate through tabs, libraries, commands, and empty states. Save `test-case-labels.png`. Pass when the collection uses Test cases consistently without changing Session or Finding terminology.
- [ ] Lane 10. Create the first Session through the central action at laptop and narrow widths. Save `first-session.png`. Pass when the labelled action opens the editable Note without extra setup.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Count actions from a selected library record to a verified clipboard payload and record any navigation or persistence side effects.
- [ ] Probe. Use the maintained clipboard scenario on trunk first and head second with duplicate-title fixtures. Inspect the actual clipboard payload.
- [ ] Baseline. Record the current Open in Session, locate action, and Copy sequence.
- [ ] Rule. Require one Copy activation from the selected library record, zero Session switches, zero unintended record writes, and completion within the existing 10-second wait. Preserve clipboard formatting parity.

**Review gate.** Review the interaction before merge.

- [ ] Provide the operator with labelled copy, library, failure, and narrow screenshots plus `UX-4-review.mp4`, a 30 to 60 second video. Obtain the independent verdict at the same patch.

**Merge.**

- [ ] Require protected CI, exact-patch review, and applicable user authority. Do not add a second clipboard serializer or new storage names.

## Explain Chat handoff without adding another workflow (UX-5)

**Depends on.** UX-4.

**Files.**

- [ ] Edit `frontend/src/views/SessionChatView.tsx` and the current handoff callback wiring only where navigation or labels require it.
- [ ] Extend `frontend/src/views/SessionChatView.test.tsx`, controller chat-submission and recovery tests, and `e2e/specs/chat-to-note.e2e.mjs`.
- [ ] Read `frontend/src/app/sessionChat.noteHandoff.ts` and `crates/qa-scribe-core/src/services/session_service/chat_submission.rs` as preservation boundaries. Do not rewrite the append transaction.

**Build.**

- [ ] Replace ambiguous Submit wording with Add conversation to note. State that the existing Note stays intact and the saved, role-labelled conversation is appended. State that this action does not generate test cases.
- [ ] Offer an optional read-only review of the durable completed messages. Reuse the actual transcript content and rendering. Do not preview partial output, generate a summary, or promise a pixel-exact merged document preview.
- [ ] Keep the normal eligible handoff as one action. Do not add a mandatory confirmation dialog or require opening the optional review.
- [ ] After confirmed success, make the updated Note and Start new conversation actions clear. Preserve existing conversation completion and restart semantics.
- [ ] Keep submission receipt reuse, canonical Note adoption, recovery locks, pending-write draining, and retry protections unchanged. Show recovery as recovery, not as a second append.

**You see.**

- [ ] Before handoff, the user understands what is added and where. After handoff, the existing Note and appended messages are present exactly once, and the next step is clear.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Run SessionChatView, chat-submission, and chat-recovery tests plus `cargo test -p qa-scribe-core --test chat_storage`. Assert literal message content, preserved existing Note, uncertain-result recovery, and no duplicate append.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head are bounded scenario labels under the boot recipe.

- [ ] Lane 1. Finish a deterministic fixture conversation. Save `chat-completed.png`. Pass when the next action clearly identifies the Session Note destination.
- [ ] Lane 2. Expand the optional review. Save `chat-review.png`. Pass when durable completed messages retain their roles and literal user content.
- [ ] Lane 3. Collapse the review and add the conversation. Save `chat-added.png`. Pass when no extra confirmation or AI request is required.
- [ ] Lane 4. Open the updated Note. Save `note-after-chat.png`. Pass when existing content remains and the expected messages appear once.
- [ ] Lane 5. Start a new conversation after success. Save `chat-restart.png`. Pass when the previously added history remains in the Note.
- [ ] Lane 6. Retain an unsent composer message. Save `chat-unsent.png`. Pass when the existing eligibility rule blocks handoff with an understandable reason.
- [ ] Lane 7. Leave a response or permission request unresolved. Save `chat-pending.png`. Pass when the review does not imply the conversation is ready to append.
- [ ] Lane 8. Inject a committed submission with a failed response. Save `chat-uncertain.png`. Pass when Note protection and recovery do not append again.
- [ ] Lane 9. Inject a failed canonical Note refresh. Save `chat-recovery.png`. Pass when the stale Note remains protected until recovery succeeds.
- [ ] Lane 10. Use keyboard navigation at laptop height in both themes. Save `chat-handoff-keyboard.png`. Pass when review, add, recovery, and restart actions remain reachable with visible focus.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Count provider invocations, user actions, append transactions, and completed local handoffs.
- [ ] Probe. Run the same fixture Chat-to-Note scenario on trunk first and head second. Inspect stored Note content and existing submission receipts.
- [ ] Baseline. Record the current eligible one-action submission and committed-result recovery behavior before wording or view changes.
- [ ] Rule. Require zero provider requests from review or handoff, one normal handoff action, exactly one append despite uncertain responses, and local completion within the existing 10-second wait. Do not infer a memory or battery improvement.

**Review gate.** Review the interaction before merge.

- [ ] Provide the operator with before, after, and recovery screenshots plus `UX-5-review.mp4`, a 30 to 60 second video. Obtain the independent verdict at the same patch.

**Merge.**

- [ ] Require protected CI, exact-patch review, and applicable user authority. Stop if a proposed UI change requires weakening canonical submission or recovery guarantees.

## Close the program

- [ ] Check each applicable box against its evidence. Report blocked or deferred items separately. Do not call the prototype or planning checks implementation proof.
- [ ] Run `bun run verify` and the full maintained default `bun run e2e` at the integrated final candidate. Run applicable workflow checks if workflows changed. Keep real-provider tests outside this task.
- [ ] Audit native Linux and macOS UI proof for changed interactions, both themes, and the documented viewport scope. Do not claim a comprehensive accessibility audit from keyboard checks alone.
- [ ] Provide a release readiness report with user-visible changes, CI, known limits, and the recommended next version. Prepare the maintained version bump and changelog only if release is requested.
- [ ] If release is authorized, use the project's existing CI process after merge checks pass. Let that process create the new tag. Verify public assets, checksums, signatures, and APT metadata. Do not create tags manually or bypass protection.
- [ ] Leave no task-owned editor, desktop, watcher, or polling process running. Preserve baseline, failed, and final receipts. Do not delete unrelated artifacts.

## Appendix A. Prototype evidence

The inspected source is branch `migration/tsc-rs-only` at `e0f9536b1a247046e69e70413fe22fef05a5a7e7`, released as v0.8.15 after the earlier merge. Revalidate against fresh trunk at implementation start.
The native review receipt is `artifacts/ux-review-v0815/review-receipt.json`. The final walkthrough captured 16 screens in both themes at actual 1280 by 860, 1280 by 720, and 1024 by 768 viewports.
At 1280 by 720, Send starts below the viewport at approximately y 756 and new-record Edit at y 747. At 1024 pixels wide, Summarize extends to approximately x 1037. These are initial-layout observations, not claims that scrolling cannot reach the controls.
The first review attempt failed from an invalid WebDriver selector. Corrected walkthroughs remain separate. No product defect is inferred from that harness error.

The throwaway native prototype is `artifacts/ux-plan-v0815/prototype.e2e.mjs`. It modifies only the disposable rendered DOM and injected CSS. No application source, model state contract, or production branch was changed.
Compare these actual 1280 by 720 captures. These are local task artifacts, retained outside the committed source.

- Baseline dialog at `artifacts/ux-plan-v0815/prototype/04-preflight.png`.
- Variant A at `artifacts/ux-plan-v0815/prototype/prototype-a-compressed-all-details.png`.
- Variant B at `artifacts/ux-plan-v0815/prototype/prototype-b-task-first-collapsed.png`.
- Expanded Variant B at `artifacts/ux-plan-v0815/prototype/prototype-b-details-expanded.png`.

Variant A retains repeated metadata and still gives little room to test design. Variant B exposes Output, Depth, all nine technique cards, and the fixed confirmation action while retaining expandable details. Additional guidance still requires scrolling.
The prototype establishes layout feasibility on the local Linux desktop. It does not establish React state preservation, warning behavior, model-popover behavior, keyboard trapping, macOS parity, minimum-size support, speed, or long-session resource use. Those remain explicit phase checks.
New-record selection, library copy, and Chat handoff feasibility come from existing source owners. They have not been implemented or verified by this prototype.

## Appendix B. Alternatives rejected

- Rebrand the app or replace the UI framework. The observed defects concern action reachability and workflow clarity. Keep existing tokens, typography, components, and themes.
- Shrink text and controls until everything fits. Variant A preserves the information burden and reduces readability.
- Hide provider warnings with routine details. A blocked action needs a visible reason and recovery step.
- Remove execution provenance or silently change CLI defaults. The user must still know what runs and where settings apply.
- Autosave every record as part of direct editing. This changes persistence semantics and exceeds the observed creation problem.
- Edit all library content in place. Direct copy solves reuse without creating a second editing workspace or competing unsaved state.
- Rename every Testware type to Test cases. `CONTEXT.md` defines Testware as a broader domain term. Align visible collection labels without a storage migration.
- Generate a Chat summary during handoff. The current operation appends the completed transcript. A summary would change content, cost, and failure modes.
- Add a mandatory Chat preview confirmation. Keep review optional because the existing transcript is already visible and handoff is recoverable through the maintained path.
- Create a new benchmark or release gate framework. Reuse the existing native harness, bounded scenarios, and repository CI.

## Appendix C. Risks

- UX-1 changes nested scrolling. Test long Notes, evidence, errors, and cleanup notices. A sticky action region must not hide the final content or steal keyboard access.
- UX-1 must preserve the production 320-pixel minimum or explicitly revisit that product constraint later. The earlier review only established behavior down to 1024 pixels.
- UX-2 can focus the wrong record after a delayed creation or filtered refresh. Carry stable record and session identity rather than a global editing boolean.
- UX-3 can include hidden controls in the current custom Tab trap. Add native keyboard proof for both disclosure states.
- UX-3 moves a model popover currently configured to open upward. Verify its visible menu and clipping rather than assuming a new container works.
- UX-4 can copy a stale or wrong Session payload when titles repeat. Keep full record identity and assert the actual clipboard result.
- UX-5 must distinguish saved messages, partial output, committed append, and recovery. Preserve the backend transaction and existing receipt protocol.
- Linux proof is not macOS proof. Missing supported platform access limits the support claim rather than passing by source inspection.
- Five phases can expand into unrelated cleanup. Keep each PR within its acceptance criteria. Run focused checks per phase and the full integrated gate once at the final candidate, in addition to required hosted CI.

## Appendix D. Links and reading list

Read [CONTEXT.md](../CONTEXT.md), [the development guide](development.md), [the existing UI polish plan](ui-polish-plan.md), [the sidebar and preflight plan](sidebar-preflight-ui-plan.md), and [the Chat plan](session-chat-plan.md).
Read [SessionEditorView](../frontend/src/views/SessionEditorView.tsx), [RecordCollectionView](../frontend/src/views/RecordCollectionView.tsx), [generationPreflight](../frontend/src/workflows/generationPreflight.tsx), [OutputLibraryView](../frontend/src/views/OutputLibraryView.tsx), and [SessionChatView](../frontend/src/views/SessionChatView.tsx) before editing each owner.
Use the installed `how` skill to trace each affected flow. Use `architect` before changing shared creation intent or library-copy interfaces. Use `interrogate` only if a real design objection remains unresolved.
Apply Experience First by prioritizing visible task actions. Apply Subtract Before You Add by reducing repeated execution details before adding handoff controls. Apply Sequence Work into Verifiable Units through the five independent gates. Apply Prove It Works through actual desktop and clipboard checks.
Keep the decision trail local at `artifacts/ux-improvements/decisions.tsv`. Keep historical plans and failed verification evidence intact.
