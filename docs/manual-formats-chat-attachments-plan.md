# Add manual formats and chat images plan

Delegation, lifecycle, isolation, history, and capability fallbacks follow the [installed runtime contract](/Users/vriesd/.codex/plugins/cache/pstack-for-codex-local/pstack-for-codex/0.4.0/skills/poteto-mode/references/codex-agent-runtime.md).

Give testers the same test-case structures during manual writing and AI generation.
Let testers paste or choose screenshots, inspect them, and send their pixels to the selected AI provider.
Keep the existing typography, colors, editor, Note workflow, and explicit Save behavior.
Phase 0 contains design evidence only. Implement F1, A1, and A2 in that order after design review.
These IDs name proposed PRs. No implementation PR exists yet.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

Run the [Feature playbook](/Users/vriesd/.codex/plugins/cache/pstack-for-codex-local/pstack-for-codex/0.4.0/skills/poteto-mode/playbooks/feature.md) for implementation and the [Opening a PR playbook](/Users/vriesd/.codex/plugins/cache/pstack-for-codex-local/pstack-for-codex/0.4.0/skills/poteto-mode/playbooks/opening-a-pr.md) for publication.
The operator reviews screenshots and video and merges each PR. Stop each owner at merge-ready.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [x] Read the Principles section and inspect the current source. Evidence is the source map in Appendix D.
- [x] Produce throwaway visual prototypes before implementation. Evidence is in Appendix A.
- [ ] Review the design with the operator. Record the accepted direction in `docs/design/manual-formats-chat-attachments/decisions.tsv`.
- [ ] Start implementation only after the operator requests it. This turn authorizes a plan and mockups.
- [ ] Skip create a goal and an hourly audit heartbeat for this design task. The runtime contract requires explicit lifecycle authorization. No recurring task was requested.
- [ ] Read the playbooks from their installed paths at implementation start. Do not run `git show origin/main:skills/poteto-mode/playbooks/feature.md` here. This application repository does not contain the skill bundle.
- [ ] Apply how and architect before production code. Compare extending managed attachments against a separate chat file store. Choose from durable ownership and transport evidence.
- [ ] Keep a queue table in the decision log only if implementation later becomes a continuing program.

### Spawn owners

- [ ] Give F1 to one owner. Start it from `main` in an isolated worktree after design review.
- [ ] Give A1 to one owner after F1. A1 has no functional dependency on F1, but sequential ownership avoids shared bridge and test edits.
- [ ] Give A2 to one owner after A1. Base A2 on merged A1, or its exact branch tip for an explicitly requested stack.
- [ ] Hold the file boundaries listed under each PR. Parent owns integration and publication.
- [ ] Keep F1, A1, and A2 review-gated. A1 requires migration and provider-payload review before merge even though its public controls arrive in A2.
- [ ] Revalidate available models through the live capability catalog. Do not treat a named profile as installed without evidence.

### PR mechanics, for every PR

- [ ] Resolve the repository through `gh`. Record the repository and base SHA in each verification receipt.
- [ ] Run focused checks during editing and `bun run verify` before completed-change handoff. Add maintained built-app E2E for each affected workflow.
- [ ] Run deslop before commit and no-comments before review. Apply technical-writing and unslop to PR text.
- [ ] Parent opens each authorized PR through supported tools. Register its full URL with T3 `link_pull_request` immediately.
- [ ] Rebase at merge preparation. Preserve evidence only when it still applies to the final patch.

### Verdict and merge, for every PR

- [ ] Run the ten named live scenarios at the exact PR head. Native app scenarios use isolated data, never the user's installed database.
- [ ] Use independent review for persistence, provider inputs, and cleanup. Inspect artifacts rather than accepting an owner summary.
- [ ] Mark a scenario missing when a platform, CLI authentication, or control capability is unavailable. Missing live evidence blocks that support claim.
- [ ] Parent gives a verdict against the head SHA. Operator merges only after the review gate passes.

### Boot recipe, for every live lane

Each live lane uses an isolated checkout and an isolated native application data directory at the PR head.
Ten scenarios may run in bounded waves. Serialize native desktop control. Do not open ten competing app windows on the user's display.

- [ ] Install with `bun install --cwd frontend --frozen-lockfile`. Use the repository's pinned Tauri CLI setup from `docs/development.md`.
- [ ] Use the maintained `bun run e2e` wrappers with `QA_SCRIBE_E2E_SPEC`. Let the wrappers set data isolation and artifact paths.
- [ ] On Linux, run the native app with `GDK_BACKEND=x11 xvfb-run -a bun run e2e`. Use the documented macOS runner on macOS.
- [ ] Drive the real Tauri app through WebdriverIO Tauri control. Use native app control for actual clipboard and file dialog proof. Do not substitute a browser DOM paste event for operating-system clipboard proof.
- [ ] Use read-only SQL inspection and provider fixture transcripts to diagnose ownership and payloads. Never print image base64 or user secrets.
- [ ] Save screenshots under `artifacts/design-verification/<pr-id>/lane-<n>/`. Return exact paths and the runner's JSON receipt.

## Choose a format while writing manual drafts (F1)

**Depends on.** None. A0 design review precedes implementation.

**Files.**

- [ ] Edit `frontend/src/app/creationIntent.ts`, `creationActions.ts`, and `creationSourceActions.ts`.
- [ ] Edit `frontend/src/views/CreationComposer.tsx`, `CreationTools.tsx`, and `frontend/src/workflows/prefillTemplates.ts`.
- [ ] Edit `frontend/src/testware/generationPreferences.ts`, `shared/creation-starters.json`, and parity tests against `crates/qa-scribe-core/src/generation/preferences.rs`.
- [ ] Create a small shared creation format registry and focused format tests beside the owning modules.
- [ ] Edit the affected creation and copy tests and `e2e/specs/creation-composer.e2e.mjs`.

**Build.**

- [ ] Name the shape first. Add a discriminated `CreationFormat` with a testware output ID or a finding template ID. Keep storage `bodyFormat` separate.
- [ ] Use a format registry to provide labels, descriptions, and RichEditorDocument starters. Reuse the five existing testware output IDs and labels.
- [ ] Put Output format after Title in test cases. Put Template after Finding type, Severity, and Status in findings. Use the existing select styling and rich editor.
- [ ] Offer Structured finding and Blank for findings. Keep finding Kind independent. Do not invent additional AI finding formats.
- [ ] Pin all five deterministic starters to the Rust output-format guidance. QA cases use scenario and case headings, preconditions, test data, steps, expected result, and optional coverage notes. Checklist uses empty executable checks with expected-result hints. Gherkin uses Feature, Scenario, Given, When, and Then. Charters use mission, scope, risks, setup and data, timebox, and observations. Coverage outline uses an empty coverage map and concrete-case sections. Keep guidance labels separate from the existing UI labels. Never copy the prototype checkout examples into a product starter.
- [ ] Change an untouched starter immediately. If the body is authored or has images, keep the current content until an explicit Apply format confirmation succeeds. Keep title and metadata unchanged.
- [ ] Distinguish authored body content from meaningful draft changes. Compare the document with the selected starter for body replacement. Ignore only the manual-format metadata key when deciding whether an otherwise untouched starter needs settlement. Retain title, Finding type, severity, and status changes as meaningful user work for navigation settlement. The current metadataJson shortcut must not make format selection alone count as authored. Treat placeholders as unsaved editor hints. Preserve uncertain-save snapshots.
- [ ] Pass the selected output format into AI preflight and the matching prefill path. Preserve the existing AI success, failure, and cancellation contract.
- [ ] Store manual selection under versioned creation metadata. Preserve unknown metadata keys. Do not label manual records as an AI Run or fabricate testwareGeneration settings.
- [ ] Keep JSON and rendered HTML consistent on Save and Copy. Keep existing records readable. Do not transform existing saved records automatically.

**You see.**

- [ ] Choose Gherkin and see Feature, Scenario, Given, When, and Then in the ordinary editor.
- [ ] Choose Structured finding and see the generated finding sections while Finding type, Severity, and Status retain their values.
- [ ] Cancel a format change and see the exact authored body and images still present.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add literal expected structures for every format, untouched versus authored detection, retained metadata, preflight preference handoff, and prefill behavior. Run `bun run frontend:test -- src/app/creationActions.test.ts src/app/creationSourceActions.test.ts` plus the new focused files.
- [ ] Cover Save, Copy, discard, and uncertain-save retry with a selected format. Run `bun run frontend:test -- src/app/AppShell.copy.test.tsx src/editor/clipboardExport.test.ts`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe. Select that profile from the live catalog before execution.

- [ ] Lane 1. Choose each of the five testware formats in a new draft. Save `artifacts/design-verification/F1/lane-1/result.png`. Pass when every selection renders its named structure without an AI call.
- [ ] Lane 2. Edit a Gherkin body, choose Checklist, and select Keep editing. Save `artifacts/design-verification/F1/lane-2/result.png`. Pass when the edited text, title, and selected Gherkin value remain.
- [ ] Lane 3. Apply another format after authoring and adding an image. Save `artifacts/design-verification/F1/lane-3/result.png`. Pass when replacement occurs only after confirmation and no stale local image is retained.
- [ ] Lane 4. Create a Structured finding and change severity and status. Save `artifacts/design-verification/F1/lane-4/result.png`. Pass when the body sections and all structured metadata save correctly.
- [ ] Lane 5. Choose Blank for a finding. Save `artifacts/design-verification/F1/lane-5/result.png`. Pass when the editor starts empty and still accepts ordinary writing.
- [ ] Lane 6. Prefill a selected testware format from the saved Note. Save `artifacts/design-verification/F1/lane-6/result.png`. Pass when source text enters the selected structure and the Note remains unchanged.
- [ ] Lane 7. Open Generate with AI after selecting Gherkin and then cancel. Save `artifacts/design-verification/F1/lane-7/result.png`. Pass when preflight starts on Gherkin and cancellation preserves the draft.
- [ ] Lane 8. Save, reopen, edit, and copy each format. Save `artifacts/design-verification/F1/lane-8/result.png`. Pass when both rich HTML and plain copy preserve the expected structure.
- [ ] Lane 9. Navigate away from an untouched alternate starter and from an authored starter. Save `artifacts/design-verification/F1/lane-9/result.png`. Pass when settlement warns only for authored content and preserves it on cancellation.
- [ ] Lane 10. Drive the format controls by keyboard in both themes at 1024 and 1280 pixels. Save `artifacts/design-verification/F1/lane-10/result.png`. Pass when labels, focus, confirmation, and Save remain visible and usable.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Format selection to painted starter latency, and preservation of the current editor frame.
- [ ] Probe. Use the browser or WebView performance trace around a select change with an empty starter and a 5,000-word draft. Run 20 interleaved selections on trunk and head.
- [ ] Baseline. Record trunk editor paint latency before adding the selector. Record the exact hardware, build, and template size.
- [ ] Rule. Fail when p95 starter update exceeds 100 ms or adds more than 50 ms against trunk editor updates. Confirm no content loss regardless of timing.

**Review gate.** The operator reviews before merge.

- [ ] Post the lane screenshots and a 30 to 60 second native video under `artifacts/design-verification/F1/review/`.
- [ ] Wait at merge-ready for the operator's design review. Include the exact head SHA and known gaps.

**Merge.**

- [ ] Parent verdict is clean at the exact head SHA and every claimed platform has native evidence.
- [ ] Operator merges after review. Record the PR URL, final head SHA, and checks.

## Persist chat images and deliver them to providers (A1)

**Depends on.** F1 in the proposed delivery order. No product dependency on its formats.

**Files.**

- [ ] Edit `crates/qa-scribe-core/src/domain/chat.rs`, chat storage, schema migrations, and `services/session_service/chat.rs`.
- [ ] Edit attachment retention in `services/session_service/attachments.rs` and chat handoff in `chat_submission.rs`.
- [ ] Edit `crates/qa-scribe-core/src/chat/mod.rs` and `ai/chat_protocol/{claude,codex,copilot}.rs`.
- [ ] Edit `src-tauri/src/commands/chat/`, provider capability handling, and the typed bridge. Regenerate bindings through the repository workflow.
- [ ] Add storage, migration, protocol fixture, recovery, and handoff tests. Extend the maintained native fixture scenario without adding a public composer control.

**Build.**

- [ ] Name the shapes first. Represent a user turn as ordered text and image parts with managed ChatAttachment references. Carry that shape through composer save, ChatStartRequest, lifecycle preparation, replay, ChatProtocol construction, and all three provider stdin encoders. Keep assistant output text-only. A String prompt alone cannot represent an image-only user turn.
- [ ] Reuse session-owned managed attachment files and preview commands. Add database relationships for composer ownership and message ownership. Keep bytes out of composer text, replay strings, and normal logs.
- [ ] Bump SCHEMA_VERSION above 13 and rebuild chat_messages transactionally to replace its nonempty-text constraint. Add ordered image relationships and extend submitted-chat immutability to those rows. Preserve IDs, indexes, foreign keys, receipts, revisions, and all old text-only messages. Enforce nonempty text or a valid image part at the service transaction boundary. Do not put a cross-table subquery in a SQLite CHECK. Prove migration failure leaves the old database usable and forward versions remain rejected.
- [ ] Validate ownership, file decoding, media type, pixel bounds, provider support, count, and bytes at the Rust boundary. Reject cross-Session references and arbitrary file paths.
- [ ] Use the existing 25 MiB encoded attachment import ceiling as an outer bound. For v1, propose four images, 10 MiB per source, 20 MiB total, and 40 megapixels per decoded image. Apply lower provider limits before sending.
- [ ] Accept PNG, JPEG, and WebP when the selected transport supports them. Normalize decoded content as needed. Leave documents, SVG, animated image behavior, and remote URL fetches outside v1.
- [ ] Save composer text and attachment order under the same revision. Atomically move the send snapshot into a user message. Allow image-only input. Keep revision conflict, retry, cancellation, and interruption behavior explicit.
- [ ] Extend attachment_is_referenced_on to include unsent, sent, archived, and submitted chat ownership. Removing one reference cannot delete an image still used elsewhere. Make failed import and crash cleanup bounded.
- [ ] Build app-owned replay with historical image association intact. Describe the message each image belongs to. Preserve prior image inputs on later turns and retries without flattening images into filenames.
- [ ] Bound the total image count and encoded bytes across replayed history separately from composer and text budgets. Block an over-budget turn with a recovery path instead of silently dropping prior screenshots.
- [ ] Account for base64 expansion, protocol message limits, and providers that echo image inputs. Qualify behavior against the existing 1 MiB stdout line budget in chat_duplex.rs. Reject or normalize before starting the turn instead of broadly raising output limits.
- [ ] Send Claude image content blocks, Codex localImage inputs, and Copilot ACP image blocks. Negotiate ACP image support using the protocol version actually implemented. Do not use SDK documentation as proof that the installed CLI supports the same path.
- [ ] When model or transport support is absent or unknown, retain the draft and explain the unsupported state before starting a turn. Do not silently omit images or send text only.
- [ ] Append managed screenshot references to the Session Note during Add conversation to note. Preserve existing Note content and handoff recovery receipts.
- [ ] Keep arbitrary tool permissions unchanged. Image input is explicit content, not authorization for the provider to read unrelated local files.

**You see.**

- [ ] A native fixture turn stores an image reference and the protocol receipt shows the expected image content shape.
- [ ] Restarting the app retains an unsent screenshot and a sent screenshot under the correct conversation.
- [ ] Add conversation to note appends the screenshot without replacing the existing Note.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add migration, attachment ownership, ordering, image-only input, retry deduplication, archived retention, and handoff cases. Run `cargo test -p qa-scribe-core --test chat_storage` and focused attachment and chat tests.
- [ ] Assert real payload structure for all three adapters with literal expected image blocks. Run `cargo test -p qa-scribe-core ai::chat_protocol` and `cargo test -p qa-scribe-tauri --bin qa-scribe-tauri commands::chat`.
- [ ] Run `bun run bindings:check` and `bun run tauri:commands:check`. Check existing text-only fixtures still pass.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe. Select that profile from the live catalog before execution.

- [ ] Lane 1. Open an old schema-13 text-only database through an isolated native fixture. Save `artifacts/design-verification/A1/lane-1/result.png`. Pass when the version advances above 13, new ownership tables exist, image-only rows can commit with valid images, empty rows without images are rejected, submitted attachment mutations fail, forward versions are rejected, and old transcripts and receipts survive. Save SQL assertions and the application screenshot together.
- [ ] Lane 2. Stage an image through the native fixture and restart the app. Save `artifacts/design-verification/A1/lane-2/result.png`. Pass when the unsent image reference and managed file still resolve.
- [ ] Lane 3. Send an image-only fixture message. Save `artifacts/design-verification/A1/lane-3/result.png`. Pass when one user message and its ordered attachment commit together.
- [ ] Lane 4. Retry an interrupted image turn. Save `artifacts/design-verification/A1/lane-4/result.png`. Pass when no duplicate message or attachment appears and the identical image is replayed.
- [ ] Lane 5. Run a Claude turn using a synthetic image with a unique visual marker. Save `artifacts/design-verification/A1/lane-5/result.png`. Pass when the native transport receipt proves correctly encoded image blocks and a separate authenticated qualification receipt records whether the model identifies the marker. Keep transport success and vision success as distinct results. Vision support requires both.
- [ ] Lane 6. Run a Codex turn using the visual marker. Save `artifacts/design-verification/A1/lane-6/result.png`. Pass when separate receipts prove that the installed app-server accepts localImage, can read the managed file under its actual sandbox, and the selected model identifies the marker. Report transport and vision verdicts independently.
- [ ] Lane 7. Run a Copilot turn with ACP image support, then with it absent. Save `artifacts/design-verification/A1/lane-7/result.png`. Pass when ACP v1 capability negotiation and image payload fixtures pass, unsupported input is blocked without data loss, and a separate installed-CLI qualification proves image understanding before support is advertised.
- [ ] Lane 8. Continue a conversation after a prior screenshot and ask about that screenshot. Save `artifacts/design-verification/A1/lane-8/result.png`. Pass when deterministic replay receipts preserve the prior image association. Record model understanding separately and require it before advertising history vision support.
- [ ] Lane 9. Append a screenshot conversation to an existing Note and restart. Save `artifacts/design-verification/A1/lane-9/result.png`. Pass when the Note text and image survive with one handoff receipt.
- [ ] Lane 10. Remove an unsent reference, archive a conversation, and test a cross-Session reference. Save `artifacts/design-verification/A1/lane-10/result.png`. Pass when only unreferenced files are eligible for cleanup and cross-Session input is rejected.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Attachment import latency, decoded memory growth, and text-only turn preparation latency.
- [ ] Probe. Use synthetic 1 MiB and 10 MiB images plus one four-image batch. Record process memory and local preparation timing without provider response time. Interleave unchanged text turns on trunk and head.
- [ ] Baseline. Record schema-13 text-only turn preparation and native managed-image import on trunk before editing.
- [ ] Rule. Fail when text-only p95 preparation regresses by more than 20 percent and 20 ms, when one-image preparation exceeds 1 second, or when pending decoded buffers grow after repeated removal. Record peak memory against the pixel limit.

**Review gate.** The operator reviews before merge.

- [ ] Post migration SQL receipts, provider payload receipts, screenshots, and a native fixture video under `artifacts/design-verification/A1/review/`.
- [ ] Wait for the operator to review the schema migration and qualification limits before merge.

**Merge.**

- [ ] Parent verdict is clean at the exact head SHA and every claimed platform has native evidence.
- [ ] Operator merges after review. Record the PR URL, final head SHA, and checks.

## Paste and attach images in the chat composer (A2)

**Depends on.** A1. Use its durable references, validation, and provider transport.

**Files.**

- [ ] Edit `frontend/src/views/SessionChatView.tsx`, `ChatMessageList.tsx`, and `frontend/src/styles.css`.
- [ ] Edit `frontend/src/app/sessionChat.types.ts`, `sessionChat.actions.ts`, and the chat hook wiring.
- [ ] Reuse clipboard detection in `frontend/src/app/attachmentActions.ts`. Extend `src-tauri/src/commands/files.rs` and its tests for a chat-specific clipboard budget before reusing readClipboardImageDataUrl.
- [ ] Add focused composer and lifecycle tests and a maintained native chat attachment E2E spec.
- [ ] Update `docs/getting-started.md` and `docs/ai-providers.md` with supported inputs and provider qualification receipts.

**Build.**

- [ ] Name the shape first. Use ChatComposerAttachment states for importing, ready, and failed. Use the persisted A1 composer snapshot plus transient operation IDs to reject late results after navigation.
- [ ] Place an accessible Attach images paperclip directly left of Send. Open an image picker. Keep provider choice and Add conversation to note in their existing areas.
- [ ] Handle Ctrl+V on Linux and Cmd+V on macOS inside the Message composer. Prefer DOM image files and use the native fallback where the WebView omits pixels. Keep ordinary text paste intact.
- [ ] Split clipboard decode bounds from encoded import bounds. MAX_CLIPBOARD_IMAGE_RGBA_BYTES currently limits decoded pixels to 25 MiB, or 6,553,600 pixels. It rejects a 3840 by 2160 screenshot, which needs 33,177,600 RGBA bytes. Add an explicit bounded chat policy that supports this screenshot and aligns with the proposed 40-megapixel maximum without weakening unrelated callers silently. Native clipboard pixels become PNG before encoded-file and provider limits apply. Normalize or reject oversize PNG output with a clear error.
- [ ] Show removable image cards above the typed message with a thumbnail, filename, and status. Keep text and attachment order on removal or picker cancellation. Report image budget failures separately from the existing text transcript counter.
- [ ] Allow text with images and images without text. Keep empty sends disabled. Keep Send blocked while importing, saving, invalid, or unsupported.
- [ ] Expose retry and remove controls for failed imports. Explain size or capability failures beside the attachment. Do not clear the composer when a send fails.
- [ ] Render sent screenshots in the user transcript with accessible names and a larger preview. Preserve them after reload, retry, and handoff.
- [ ] Keep Enter for a new line and Ctrl/Cmd+Enter to send. Preserve existing cancellation, retry, permission attention, provider recovery, and Note recovery controls.
- [ ] Use existing theme variables, border radii, spacing, and focus rings. Make thumbnail rows wrap at narrow desktop widths without covering Send.
- [ ] Qualify actual clipboard images and real provider visual understanding on macOS and Linux before claiming support. Run `bun run verify` once at the final source and the maintained native attachment spec.

**You see.**

- [ ] Paste a screenshot and see its preview above the message. The paperclip sits immediately left of Send.
- [ ] Remove a screenshot and keep the authored text. Restart and recover unsent images.
- [ ] Send a screenshot and see it in the user turn while the AI responds to its actual contents.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Cover image-only enablement, mixed paste, normal text paste, removing one of several images, import errors, chooser cancellation, late async results, and exact paperclip order. Run `bun run frontend:test -- src/views/SessionChatView.test.tsx` plus new attachment tests.
- [ ] Cover debounced save races, scope revisions, send failure, retry, restart, Note recovery, and model changes with retained attachments. Run `bun run frontend:test -- src/app/useAppController.chat.persistence.test.ts src/app/useAppController.chat.lifecycle.test.ts`.
- [ ] Run the permission and model-selection regression tests and `bun run verify`. Use the repository wrapper to run the new native attachment E2E spec.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe. Select that profile from the live catalog before execution.

- [ ] Lane 1. Copy a real 3840 by 2160 screenshot and press Cmd+V in the macOS Tauri composer. Save `artifacts/design-verification/A2/lane-1/result.png`. Pass when one preview appears and the actual pixels reach a qualified provider.
- [ ] Lane 2. Copy a real 3840 by 2160 screenshot and press Ctrl+V in the Linux Tauri composer. Save `artifacts/design-verification/A2/lane-2/result.png`. Pass when one preview appears and the actual pixels reach a qualified provider.
- [ ] Lane 3. Paste ordinary multiline text with Ctrl+V or Cmd+V. Save `artifacts/design-verification/A2/lane-3/result.png`. Pass when the exact text enters the textarea without an attachment or native clipboard error.
- [ ] Lane 4. Pick an image through the paperclip, then cancel a second picker. Save `artifacts/design-verification/A2/lane-4/result.png`. Pass when the first preview and typed message remain unchanged.
- [ ] Lane 5. Add several images and remove the middle one. Save `artifacts/design-verification/A2/lane-5/result.png`. Pass when the remaining image order and typed message persist across restart.
- [ ] Lane 6. Paste an oversized, unsupported, or corrupt image. Save `artifacts/design-verification/A2/lane-6/result.png`. Pass when an actionable error appears and Send cannot silently omit the failed image.
- [ ] Lane 7. Send only an image, then test an empty composer. Save `artifacts/design-verification/A2/lane-7/result.png`. Pass when image-only Send succeeds and an empty Send is disabled.
- [ ] Lane 8. Fail or cancel a turn and retry, then switch Sessions during an import. Save `artifacts/design-verification/A2/lane-8/result.png`. Pass when retry retains the sent images and no late image enters another Session.
- [ ] Lane 9. Use keyboard-only focus, both themes, and narrow desktop widths. Save `artifacts/design-verification/A2/lane-9/result.png`. Pass when attachment removal is labelled and reachable and the paperclip remains directly left of Send.
- [ ] Lane 10. Receive a tool permission request during an image conversation and then add the conversation to the Note. Save `artifacts/design-verification/A2/lane-10/result.png`. Pass when permission controls remain usable and Note handoff preserves text and screenshots.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Clipboard-to-ready-preview latency and composer interaction responsiveness.
- [ ] Probe. Measure native paste using the same synthetic images and timestamp import start, durable readiness, and painted thumbnail. Interleave trunk Note-image paste and head Chat-image paste on each platform.
- [ ] Baseline. Record native Note-image paste and text-only chat typing on trunk. Do not include model response time.
- [ ] Rule. Fail when a 1 MiB screenshot preview exceeds 500 ms p95, when text input gains more than 50 ms p95, or when removing repeated thumbnails leaves retained preview URLs or growing image buffers.

**Review gate.** The operator reviews before merge.

- [ ] Post the lane screenshots and a 30 to 60 second native video under `artifacts/design-verification/A2/review/`.
- [ ] Wait at merge-ready for the operator's design review. Include the exact head SHA and known gaps.

**Merge.**

- [ ] Parent verdict is clean at the exact head SHA and every claimed platform has native evidence.
- [ ] Operator merges after review. Record the PR URL, final head SHA, and checks.

## Close the program

- [ ] Check every implementation box only after its evidence exists. Keep failed or unavailable scenarios unchecked.
- [ ] Update user docs, provider support receipts, and the decision log to match delivered behavior.
- [ ] Hand back PR URLs, screenshots, video, verification results, and remaining support limits.
- [ ] Check T3 `list_thread_pull_requests` and link any missing PR from this work.

## Appendix A. Prototype evidence

Phase 0 was completed on local branch `main` at source SHA `30a9ea555d971e46f00596c64fac0b492c55850d`. Production source is unchanged.
The prototype is throwaway vanilla HTML, CSS, and JavaScript. Its first working copy is `/tmp/qa-scribe-design-20261024/index.html`.
A review copy is [prototype.html](design/manual-formats-chat-attachments/prototype.html), with the existing synthetic checkout evidence image beside it.
Run `python3 -m http.server 5177 --bind 127.0.0.1 --directory docs/design/manual-formats-chat-attachments` and open `http://localhost:5177/prototype.html`.
The three buttons switch test cases, findings, and chat. A theme switch permits light-theme inspection.

- [Manual test cases](design/manual-formats-chat-attachments/01-manual-test-cases.png) places the output dropdown between Title and the formatting toolbar.
- [Manual finding](design/manual-formats-chat-attachments/02-manual-finding.png) keeps structured fields separate from the template choice.
- [Chat attachments](design/manual-formats-chat-attachments/03-chat-attachments.png) shows the preview card and paperclip directly left of Send.
- [Gherkin](design/manual-formats-chat-attachments/04-gherkin.png) demonstrates an alternate starter without a different editor.

Native Chrome control verified QA cases to Gherkin selection, authored-content confirmation, and Keep editing restoration. The initial attachment removal check used unchanged sample text and did not prove edited-message preservation. Review reproduced that reset defect. The correction and retest are recorded in the observation receipt.
The [observation receipt](design/manual-formats-chat-attachments/interaction-receipt.json) distinguishes those observations from unproven product behavior.
Headless renders at 1280 pixels showed no console errors. Saved [728-pixel](design/manual-formats-chat-attachments/05-chat-narrow.png) and [360-pixel light-theme](design/manual-formats-chat-attachments/06-chat-light-narrow.png) renders kept the attachment and Send controls visible. Their console and dimension records are in [render-receipts.json](design/manual-formats-chat-attachments/render-receipts.json).
The design preview toolbar is outside the application concept. Do not ship that toolbar.

The prototype does not prove native clipboard import, real file import, persistence, image-only sending, provider capability negotiation, or model image understanding.
Its paperclip opens a local picker, but selecting a file restores the fixture thumbnail. Its Send button changes only local sample content.
Do not treat these simulated actions as implementation evidence. Placeholder text and sample data are illustrative.
The full-page screenshots show scrollable collection layouts. Production must retain the existing sticky chat composer and scroll regions so Send remains visible in a short native window.

The installed app is older than the checkout. It was inspected for appearance only.
Opening its manual editor created a blank Untitled test case in the Session Rich copy check. Discard left that record intact.
No cleanup deletion was performed. Do not use that installed database for subsequent tests.

## Appendix B. Alternatives rejected

A separate form builder would introduce a second editing model. Reuse the rich editor and its Save and Copy behavior.
Separate manual format labels would drift from generation. Reuse the existing five output IDs and labels.
Depth and test-design techniques control AI generation. Do not add those controls to manual writing without a separate product need.
Finding kinds are classifications, not output formats. Keep Bug, Question, Risk, Follow-up, and Note in the existing Kind field.
Silently replacing authored content would lose work. Apply an untouched starter immediately and confirm an authored replacement.
A paperclip at the left edge of the composer conflicts with the requested position. Place it directly left of Send.
Serializing screenshot filenames into a text prompt would not provide vision input. Send typed image content and verify recognizable pixels.
A separate chat file store would duplicate managed attachment ownership. Prefer the existing store with explicit chat relationships.

## Appendix C. Risks

F1 must preserve current draft settlement, inline images, unknown metadata, and uncertain-save snapshots.
F1 cannot derive all manual structures from prompt strings. Define deterministic starters and keep a parity check against the format catalog.
A1 changes durable storage. Use an isolated schema-13 database and prove migration, rollback safety before first write, forward-version rejection, and retained text-only histories.
A1 must update cleanup references before importing chat-owned files. Otherwise images can disappear while a conversation still uses them.
A1 must preserve image association during app-owned replay. Each turn starts a provider process, so a prior provider conversation cannot be assumed to remember screenshots.
A1 must cap decoded images as well as encoded bytes. Model limits differ by provider and selected model. Historical replay needs its own cumulative image budget. Provider-echoed images may hit the current stdout line budget even when the upload itself is accepted.
A1 cannot infer Copilot ACP support from Copilot SDK support. Negotiate the actual adapter capability and qualify the installed CLI version.
A2 needs real macOS WKWebView and Linux WebView clipboard proof. Browser-only renders cannot close those checks.
A2 must preserve images and text on provider failure, unsupported model changes, navigation, permission recovery, and Note recovery.
Actual Linux native control and all provider authentication must be checked during execution. Missing access blocks those support claims.
The proposed image limits and v1 image-only scope are defaults for implementation review. They are not existing product behavior.
No performance baseline was measured in this design task. Performance thresholds above are proposed acceptance budgets, not speed claims.

## Appendix D. Links and reading list

Read these application entry points before editing.

- [CreationIntent and creationIsAuthored](../frontend/src/app/creationIntent.ts).
- [Creation composer](../frontend/src/views/CreationComposer.tsx), [creation tools](../frontend/src/views/CreationTools.tsx), and [save lifecycle](../frontend/src/app/creationActions.ts).
- [Generated output format catalog](../frontend/src/testware/generationPreferences.ts), [Rust preferences](../crates/qa-scribe-core/src/generation/preferences.rs), and [shared starters](../shared/creation-starters.json).
- [Chat composer](../frontend/src/views/SessionChatView.tsx), [chat actions](../frontend/src/app/sessionChat.actions.ts), and [chat domain](../crates/qa-scribe-core/src/domain/chat.rs).
- [Chat transport](../src-tauri/src/commands/chat/transport.rs), [protocol adapters](../crates/qa-scribe-core/src/ai/chat_protocol), and [attachment retention](../crates/qa-scribe-core/src/services/session_service/attachments.rs).
- [Theme tokens](../frontend/src/styles/base.css), [collection layout](../frontend/src/styles/collections.css), and [development and native E2E workflow](development.md).

Exa found current provider documentation. Ref checked clipboard and app-server API documentation on 24 October 2026.
These sources establish documented formats. They do not certify the installed CLI versions.

- [Tauri readImage](https://tauri.app/reference/javascript/clipboard-manager/#readimage) documents native clipboard image access. QA Scribe already wraps native clipboard reads, so reuse its command rather than adding a duplicate plugin.
- [Codex app-server turn inputs](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) documents text, image URL, and localImage input variants. Use managed local files for the Codex adapter.
- [Claude streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode) documents user message content arrays with base64 image blocks. Verify that shape through the app's actual CLI stream-json transport.
- [ACP image content](https://agentclientprotocol.com/protocol/v1/content) requires an image prompt capability. Match the specification to the negotiated protocol version.
- [ACP v2 initialization](https://agentclientprotocol.com/protocol/v2/initialization) uses nested session prompt capability fields. Do not copy this shape into an adapter that negotiates v1.
- [Copilot SDK image inputs](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/image-input) documents capability-dependent image limits. This is background, not proof for the application's ACP CLI path.

Apply [how](/Users/vriesd/.codex/plugins/cache/pstack-for-codex-local/pstack-for-codex/0.4.0/skills/how/SKILL.md) to F1, A1, and A2. Use architect before production boundary changes.
Apply interrogate to A1 if storage or replay design remains contested.
Keep the decision trail under [decisions.tsv](design/manual-formats-chat-attachments/decisions.tsv), following [show-me-your-work](/Users/vriesd/.codex/plugins/cache/pstack-for-codex-local/pstack-for-codex/0.4.0/skills/show-me-your-work/SKILL.md).

Experience First drove the decision to reuse the current editor and put the paperclip where the user requested it.
Model the Domain drove the format registry and explicit attachment lifecycle in the plan.
Redesign from First Principles drove image ownership through persistence, replay, cleanup, and Note handoff.
Sequence Work into Verifiable Units drove the F1, A1, A2 order and per-PR evidence.
Prove It Works kept browser mockup evidence separate from native clipboard and real provider proof.
Build the Lever drove the small rerunnable artifact verification script beside the prototype.

## Appendix E. Runtime and review receipt

One read-only architecture investigator completed on Codex `gpt-6.1-sol`, reasoning high, service tier priority.
The generic role received the portable Poteto prompt. The parent owned every writable design and plan artifact.
No implementation owner, goal, recurring task, commit, push, or PR was created.
T3 collaborative browser snapshot timed out twice. Native Chrome control supplied interaction evidence. T3 HTML preview supplied clean full-page screenshots.
The parent inspected the source findings, screenshot files, and actual mockup interactions.
The [plan checker receipt](design/manual-formats-chat-attachments/plan-check.txt) reports three PR sections and zero problems.
The [artifact receipt](design/manual-formats-chat-attachments/artifact-check.txt) records seven valid PNGs, render metadata, a native observation receipt, and agreement with the current five-format catalog.
The [review response](design/manual-formats-chat-attachments/review-response.md) records accepted findings and the narrowed metadata recommendation. Independent review completed on `grok-4.7` with reasoning high. Six findings identified plan gaps and one real prototype reset defect. The parent checked the named source, amended the plan, reproduced the defect, and corrected the prototype. This is a response to that review, not a second independent approval. No comment deletions or suppression changes were needed.
The first seven decision rows were written together at 06:28:15 UTC. They are a retrospective batch, not individual action timestamps. Append-only corrections distinguish that batch from later decisions.
The plan checker validates document structure only. The artifact checker validates catalog IDs and PNG files only. Neither proves migration, clipboard import, or model vision.
