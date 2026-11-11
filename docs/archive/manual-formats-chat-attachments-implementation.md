# Implement manual formats and chat images

The operator approved the design and screenshots on 2026-10-24 and requested implementation followed by a CI release. That request authorizes publication after verification. It supersedes the design plan's earlier stop at merge-ready.

## Definition of done

Manual creation offers the five existing testware formats and Structured finding or Blank. Format changes preserve authored content until confirmed. Save, Copy, prefill, and generation use the selected structure.

Chat accepts pasted or chosen images, preserves text while attachments change, and shows a paperclip immediately left of Send. Unsent images survive restart. Sent images survive retry and history replay. Add to Note preserves screenshots. Supported provider adapters receive actual image content. Unsupported image capability produces an actionable error without losing the composer.

The maintained checks and isolated built-app workflows pass. Independent review finds no unresolved release blockers. The protected CI process publishes a new version and matching tag with the expected assets.

## Workflow

1. Ground the existing creation, chat, attachment, and release workflows. Compare extending managed attachments with a separate chat image store before changing durable ownership.
2. Implement F1 in an isolated worktree. Verify formats, replacement confirmation, metadata, prefill, Save, and Copy. Integrate only after inspecting the diff and focused results.
3. Implement A1 as a coherent persistence and provider change. Start with migration and lifecycle tests. Verify composer ownership, atomic send, retry, replay, submission, and deletion guards before adding controls.
4. Implement A2 against that contract. Verify paste, file selection, previews, removal, image-only send, text preservation, keyboard behavior, and layout in the isolated native app.
5. Review the final patch independently. Run the full local gate and maintained built-app tests. Record exact gaps instead of inferring native paste or vision from a thumbnail.
6. Bump the release version through `bun run bump`, write release notes, and submit a reviewed PR. Require protected CI success. Merge through the repository's authorized process. Let the merge-triggered Release workflow create the tag and publish artifacts.

Each unit ends with a check before the next depends on it. The parent owns integration, commits, external writes, and release. Workers cannot publish.

## Throughput checkpoint

The work has three feature units. F1 is mostly frontend state and editor behavior. A1 crosses SQLite, Rust domain types, Tauri commands, and three provider protocols. A2 crosses composer persistence and native clipboard behavior. A1 carries the highest risk because a visible attachment does not establish correct retention or provider delivery.

The accepted design already settles the visual direction. There is no second visual design exercise. The remaining architecture comparison checks durable ownership. Worktree isolation prevents concurrent source edits. Native app control and final broad checks run serially.

The canonical decision trail is `docs/design/manual-formats-chat-attachments/decisions.tsv`.

## Recover image ownership

The first composer changes assumed that one recovery read settled an uncertain operation. Independent review disproved that assumption with delayed Send responses and failed preview reads.

The revised composer retains a starting or uncertain Send until a successful canonical read reconciles consumed images. Text remains editable during recovery. Image edits and another Send wait for reconciliation. A failed recovery read preserves the unresolved state for Recheck status or settlement.

An uncertain import retains its original revision, prior attachment IDs, and exact image data. Retry checks new managed images against those bytes before another import. A failed preview read remains unresolved. When the canonical composer contains no new image candidate, Retry can import again and Remove failed can clear the failure. An advanced revision alone does not imply that an image remains attached. Candidates whose preview cannot be read remain unresolved until verification or removal.

The regression census is `frontend/src/app/useAppController.chat.images.test.ts`. It compares local images, canonical images, and backend import counts. The two added recovery cases failed before this state change and passed afterward.

## Delivery and qualification

The three feature units ship as ordered commits in one release PR. This keeps schema 15, generated bindings, and the composer controls in one installable change. Their separate implementation and review checkpoints remain recorded.

The managed image store is shared with Notes. Chat owns ordered composer and message relationships. Copilot image starts are rejected before persistence until its initialized peer can negotiate capability before consuming a draft. Text-only Copilot Chat remains available. Claude image payloads have fixture coverage; authenticated live Claude vision was unavailable on this host. Codex 0.164.0 identified the colors in an actual pasted 3840 by 2160 synthetic screenshot.

Native macOS picker, cancellation, preview, Escape, ordinary Enter, Cmd+Enter, and Cmd+V were checked in an isolated build without the WebDriver plugin. The plugin replaces WKUIDelegate and cannot prove the operating-system file chooser. Maintained WebDriver coverage proves the DOM input contract, managed bytes, persistence, replay, handoff, and native window geometry separately.

Visual review found excessive finding metadata height, missing attachment readiness text, a tablet-width paperclip wrap, and a hidden latest reply. The fixes reuse existing field and title styles, add a quiet readiness label, keep the send controls together, and follow the active desktop or page scroll owner. Primary actions use the same deep-blue fill and white text in both themes. Disabled controls retain their muted state.

Screenshots returned by native computer control contained JPEG bytes. Their suffixes now match those bytes. The unsuccessful narrow-resize capture is explicitly named as a desktop capture. Native window geometry in the maintained visual matrix is the source for narrow-width claims.
